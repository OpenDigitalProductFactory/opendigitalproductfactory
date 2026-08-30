// apps/web/lib/ai-inference.ts
// Shared inference module — plain server-only module (NOT "use server").
// Server actions in actions/*.ts can import from here freely.

import { prisma } from "@dpf/db";
import { computeTokenCost, computeComputeCost } from "@/lib/ai-provider-types";
import {
  aiInferenceDuration,
  aiInferenceTokens,
  aiInferenceErrors,
  aiInferenceCostUsd,
  aiCacheCreationTokens,
  aiCacheReadTokens,
} from "@/lib/metrics";
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
import type { RoutedExecutionPlan } from "../routing/recipe-types";
import { resolveDefaultExecutionAdapter } from "../routing/execution-plan";
import { getExecutionAdapter } from "../routing/execution-adapter-registry";
import { resolveExecutionAdapter } from "../routing/resolve-execution-adapter";
import {
  parseExecutionAdapterSelector,
  type ExecutionAdapterSelector,
} from "../routing/execution-adapter-types";
import { writeAdapterTelemetry } from "../routing/adapter-telemetry-writer";
import { getCliPoolStatus } from "../routing/cli-pool-status";
import {
  classifyProviderCapacity,
  type ProviderCapacityClassification,
} from "../routing/provider-capacity";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
} from "../routing/provider-capacity/store";
import "../routing/chat-adapter"; // side-effect: registers "chat" adapter
import "../routing/responses-adapter"; // side-effect: registers "responses" adapter
import "../routing/image-gen-adapter"; // EP-INF-009c: registers "image_gen" adapter
import "../routing/embedding-adapter"; // EP-INF-009c: registers "embedding" adapter
import "../routing/transcription-adapter"; // EP-INF-009c: registers "transcription" adapter
import "../routing/async-adapter"; // EP-INF-009d: registers "async" adapter
import "../routing/cli-adapter"; // anthropic-sub: registers "claude-cli" adapter
import "../routing/codex-cli-adapter"; // codex: registers "codex-cli" adapter
import {
  acquireInferenceSlot,
  currentInferenceOrigin,
  engineKeyForProvider,
} from "./inference-admission";
import { assertProviderDispatchCapacity } from "@/lib/routing/local-provider-capacity";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Anthropic-style content blocks for structured tool-calling messages */
export type ContentBlock =
  | { type: "text"; text: string }
  /**
   * Image input for multimodal models. Carried in OpenAI Chat Completions wire
   * form (`image_url` with a data: URL or http(s) URL); converted to the
   * Anthropic `image` source block by formatMessageForAnthropic. Enables vision
   * models (e.g. local Gemma 4 via Docker Model Runner) to receive screenshots.
   */
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  /**
   * Audio input for multimodal models (ASR / diarization / audio understanding).
   * OpenAI Chat Completions wire form (`input_audio` with base64 data + format).
   * Verified on-machine (2026-06-15): local Gemma 4 12B transcribes a wav via
   * Docker Model Runner through this exact block. Anthropic has no audio-input
   * block, so this is OpenAI-compatible only — routing sends audio to an
   * audio-capable endpoint via the `audioInput` floor, never to Anthropic.
   */
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

/** True when content carries only text/image blocks — the subset both the OpenAI
 *  AND Anthropic formatters can pass through (Anthropic has no audio block). */
function isMultimodalInputContent(content: ContentBlock[]): boolean {
  return content.length > 0 && content.every((b) => b.type === "text" || b.type === "image_url");
}

/** True when content carries only model-facing input blocks the OpenAI Chat
 *  Completions API accepts natively (text / image / audio). Superset of the
 *  Anthropic predicate — used only by the OpenAI formatter passthrough. */
function isOpenAIInputContent(content: ContentBlock[]): boolean {
  return (
    content.length > 0 &&
    content.every((b) => b.type === "text" || b.type === "image_url" || b.type === "input_audio")
  );
}

/** Convert an OpenAI-style image_url (data: URL) to an Anthropic image source block. */
function imageUrlToAnthropicBlock(url: string): Record<string, unknown> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (m) {
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }
  // Anthropic also accepts URL image sources.
  return { type: "image", source: { type: "url", url } };
}

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  /** Tool calls the assistant made (present when role=assistant and model called tools) */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** For role=tool messages: which tool call this result responds to */
  toolCallId?: string;
};

export type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** Responses API: chain subsequent calls with this ID for conversation state. */
  responseId?: string;
  /** True when the provider stopped at the output-token ceiling (BI-1D144CC1). */
  truncated?: boolean;
  /**
   * Verbatim provider response body (matches AdapterResult.raw). Optional —
   * adapters may leave it undefined when nothing useful exists beyond `content`.
   *
   * Populated for callers that need shape-specific fields the projected
   * InferenceResult doesn't expose. The transcription path (Voice Slice 1,
   * spec §6.5) reads `raw.segments[].avg_logprob` from Whisper-family
   * providers to normalize confidence to 0-1; chat callers can ignore it.
   */
  raw?: unknown;
};

// ─── Error Types ─────────────────────────────────────────────────────────────

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "auth" | "rate_limit" | "overloaded" | "model_not_found" | "provider_error" | "transient" | "billing" | "request_too_large",
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
    public readonly rawBody?: string,
    public readonly capacity?: ProviderCapacityClassification,
  ) {
    super(message);
    this.name = "InferenceError";
  }
}

export function classifyHttpError(
  status: number,
  providerId: string,
  body: string,
  responseHeaders?: Headers,
): InferenceError {
  // Extract rate-limit-relevant headers
  const rateLimitHeaders: Record<string, string> | undefined = responseHeaders
    ? Object.fromEntries(
        [...responseHeaders.entries()].filter(
          ([k]) =>
            k.startsWith("x-ratelimit") ||
            k.startsWith("anthropic-ratelimit") ||
            k === "retry-after",
        ),
      )
    : undefined;

  const headers = rateLimitHeaders && Object.keys(rateLimitHeaders).length > 0
    ? rateLimitHeaders
    : undefined;
  const capacity = classifyProviderCapacity({
    providerId,
    statusCode: status,
    headers: responseHeaders ?? headers,
    bodyText: body,
    now: new Date(),
  });

  if (status === 401 || status === 403) {
    return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status, headers, body, capacity);
  }
  if (status === 402 || capacity.state === "billing_action_required" || capacity.state === "unsupported_plan") {
    return new InferenceError(`Billing error on ${providerId}: ${body.slice(0, 200)}`, "billing", providerId, status, headers, body, capacity);
  }
  if (status === 413) {
    return new InferenceError(`Request too large for ${providerId}: ${body.slice(0, 200)}`, "request_too_large", providerId, status, headers, body, capacity);
  }
  if (status === 429) {
    return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status, headers, body, capacity);
  }
  if (status === 529 || /\b529\b|overloaded/i.test(body)) {
    return new InferenceError(`Provider overloaded on ${providerId}: ${body.slice(0, 300)}`, "overloaded", providerId, status, headers, body, capacity);
  }
  if (status === 404) {
    return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status, headers, body, capacity);
  }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return new InferenceError(`Transient error (${status}) from ${providerId}: ${body.slice(0, 200)}`, "transient", providerId, status, headers, body, capacity);
  }
  return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 300)}`, "provider_error", providerId, status, headers, body, capacity);
}

// ─── Build Auth Headers ──────────────────────────────────────────────────────

async function buildAuthHeaders(
  providerId: string,
  authMethod: string | null,
  authHeader: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getProviderExtraHeaders(providerId),
  };

  if (authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (!cred?.secretRef || !authHeader) throw new InferenceError("No credential configured", "auth", providerId);
    headers[authHeader] = authHeader === "Authorization" ? `Bearer ${cred.secretRef}` : cred.secretRef;
  } else if (authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  } else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
  // "none" auth (e.g., local Ollama) — no auth headers needed

  return headers;
}

async function resolveExecutionBaseUrl(
  providerId: string,
  provider: { authMethod: string | null; baseUrl: string | null; endpoint: string | null },
): Promise<string | null> {
  // Route codex through the ChatGPT backend (flat-rate subscription billing).
  // The Responses API SSE parser now handles function call events.
  if (providerId === "codex" && provider.authMethod === "oauth2_authorization_code") {
    const chatgptProvider = await prisma.modelProvider.findUnique({
      where: { providerId: "chatgpt" },
      select: { baseUrl: true, endpoint: true },
    });
    return chatgptProvider?.baseUrl ?? chatgptProvider?.endpoint ?? "https://chatgpt.com/backend-api";
  }
  return provider.baseUrl ?? provider.endpoint;
}

// ─── Tool Call Extraction Helpers ─────────────────────────────────────────────

/** Extract tool calls from Anthropic content blocks, preserving IDs */
export function extractAnthropicToolCalls(
  contentBlocks: Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return contentBlocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      id: b.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: b.name!,
      arguments: b.input ?? {},
    }));
}

/** Extract tool calls from OpenAI-compatible tool_calls array, preserving IDs */
export function extractOpenAIToolCalls(
  rawToolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return rawToolCalls
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: tc.function!.name!,
      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
    }));
}

/**
 * Extract tool calls embedded as text when the model runner doesn't translate
 * them to structured `tool_calls`. Handles two formats:
 *
 * 1. Standard Gemma/Llama JSON:  <tool_call>{"name":"fn","arguments":{...}}</tool_call>
 * 2. Gemma template variant:     <|tool_call>call: fn{key: "value"}<tool_call|>
 *
 * Returns { toolCalls, cleanText } where cleanText has the markers stripped.
 */
export function extractTextualToolCalls(
  text: string,
): { toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; cleanText: string } {
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  let cleanText = text;

  // Format 1: <tool_call>{"name":"fn","arguments":{...}}</tool_call>
  const jsonPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  cleanText = cleanText.replace(jsonPattern, (_, inner) => {
    try {
      const parsed = JSON.parse(inner.trim()) as { name?: string; arguments?: Record<string, unknown> };
      if (parsed.name) {
        toolCalls.push({
          id: `text_${Math.random().toString(36).slice(2, 9)}`,
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        });
      }
    } catch {
      // malformed — skip
    }
    return "";
  });

  // Format 2: <|tool_call>call: fn{key: "value", ...}<tool_call|>
  // Also covers <|tool_call>fn({"key":"value"})<tool_call|> variants.
  const templatePattern = /<\|tool_call\>(?:call:\s*)?(\w+)\s*[\({]([\s\S]*?)[\)}]?\s*<tool_call\|>/g;
  cleanText = cleanText.replace(templatePattern, (_, name: string, argsRaw: string) => {
    try {
      // argsRaw may be JS-like object literal — attempt JSON parse after key-quoting
      const jsonified = argsRaw
        .trim()
        // Add quotes around unquoted keys: word: → "word":
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
        // Ensure leading brace
        .replace(/^([^{])/, '{$1')
        .replace(/([^}])$/, '$1}');
      const args = JSON.parse(jsonified) as Record<string, unknown>;
      toolCalls.push({
        id: `text_${Math.random().toString(36).slice(2, 9)}`,
        name,
        arguments: args,
      });
    } catch {
      // fallback: treat entire argsRaw as a single "query" param
      toolCalls.push({
        id: `text_${Math.random().toString(36).slice(2, 9)}`,
        name,
        arguments: { query: argsRaw.trim() },
      });
    }
    return "";
  });

  // Strip any leftover <eos> tokens from local models
  cleanText = cleanText.replace(/<eos>/g, "").trim();

  return { toolCalls, cleanText };
}

// ─── Message Formatting Helpers ──────────────────────────────────────────────

/** Format a ChatMessage for the Anthropic Messages API */
export function formatMessageForAnthropic(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → Anthropic uses role=user with tool_result content block
  if (msg.role === "tool" && msg.toolCallId) {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" }],
    };
  }
  // Assistant messages with tool calls → content block array with text + tool_use blocks
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    const textContent = typeof msg.content === "string" ? msg.content : "";
    return {
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...msg.toolCalls.map((tc) => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.arguments })),
      ],
    };
  }
  // Multimodal user input (text + image blocks) → Anthropic content array.
  if (Array.isArray(msg.content) && isMultimodalInputContent(msg.content)) {
    return {
      role: msg.role,
      content: msg.content.map((b) => {
        if (b.type === "image_url") return imageUrlToAnthropicBlock(b.image_url.url);
        // isMultimodalInputContent guarantees the only other member is text.
        return { type: "text", text: b.type === "text" ? b.text : "" };
      }),
    };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

/** Format a ChatMessage for the OpenAI Chat Completions API */
export function formatMessageForOpenAI(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → role=tool with tool_call_id
  if (msg.role === "tool" && msg.toolCallId) {
    return { role: "tool", tool_call_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" };
  }
  // Assistant messages with tool calls → tool_calls field
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : "",
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id, type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  // Multimodal user input (text + image_url + input_audio blocks) → pass through
  // as-is; this is already the OpenAI Chat Completions multimodal wire format.
  if (Array.isArray(msg.content) && isOpenAIInputContent(msg.content)) {
    return { role: msg.role, content: msg.content };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

/** Format a ChatMessage for the OpenAI Responses API input array */
export function formatMessageForResponses(msg: ChatMessage): Array<Record<string, unknown>> {
  const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

  if (msg.role === "tool" && msg.toolCallId) {
    return [{ type: "function_call_output", call_id: msg.toolCallId, output: textContent }];
  }

  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return [
      ...(textContent ? [{ role: "assistant", content: textContent }] : []),
      ...msg.toolCalls.map((tc) => ({
        type: "function_call",
        call_id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    ];
  }

  return [{ role: msg.role, content: textContent }];
}

// ─── callProvider ────────────────────────────────────────────────────────────

export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
  previousResponseId?: string,
  mcpSession?: import("@/lib/routing/adapter-types").AdapterMcpSession,
  attribution?: {
    traceId?: string | null;
    agentId?: string | null;
    threadId?: string | null;
    skillId?: string | null;
    agentMessageId?: string | null;
    buildId?: string | null;
  },
): Promise<InferenceResult> {
  // Host capacity is a dispatch constraint, not a routing hint. Enforce it at
  // the shared adapter boundary so direct, agentic, evaluation and fallback
  // callers cannot start a local model while governed local CI owns the host.
  await assertProviderDispatchCapacity(providerId);

  // 0. EP-COST-001 Phase 2 — pre-call budget gate.
  // Check the agent's daily token budget before dispatching. If the agent has
  // consumed ≥100% of its registry limit today, throw a billing error so the
  // caller can surface a clear "budget exceeded" message rather than burning
  // more tokens. At 80–95% log a warning; at ≥95% also write a budget event.
  // The check is non-blocking: any DB error is swallowed so a budget-gate DB
  // failure never breaks inference.
  if (attribution?.agentId) {
    try {
      const { checkAgentBudgetFromRegistry, writeBudgetEvent } = await import("@/lib/inference/budget-gate");
      const budget = await checkAgentBudgetFromRegistry(attribution.agentId);

      if (budget.status === "rejected") {
        void writeBudgetEvent({
          agentId: attribution.agentId,
          eventKind: "rejected",
          actualTokens: budget.actualTokens,
          limitTokens: budget.limitTokens,
          modelId,
          providerId,
        });
        throw new InferenceError(
          `Daily token budget exceeded for agent "${attribution.agentId}" ` +
          `(${budget.actualTokens.toLocaleString()} / ${budget.limitTokens.toLocaleString()} tokens used today)`,
          "billing",
          providerId,
        );
      }

      if (budget.status === "warning_95" || budget.status === "warning_80") {
        console.warn(
          "[budget-gate] Agent approaching daily token limit:",
          { agentId: attribution.agentId, ratioPercent: budget.ratioPercent, status: budget.status },
        );
        if (budget.status === "warning_95") {
          void writeBudgetEvent({
            agentId: attribution.agentId,
            eventKind: "warning_95",
            actualTokens: budget.actualTokens,
            limitTokens: budget.limitTokens,
            modelId,
            providerId,
          });
        }
      }
    } catch (err) {
      // Re-throw billing errors; swallow everything else (budget gate is advisory)
      if (err instanceof InferenceError && err.code === "billing") throw err;
      console.warn("[budget-gate] Budget check failed (non-fatal):", { agentId: attribution.agentId }, err);
    }
  }

  // 1. Resolve provider (DB lookup + auth headers)
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) throw new InferenceError("Provider not found", "provider_error", providerId);

  // 2. Build minimal plan if none provided (backward compat)
  const effectivePlan: RoutedExecutionPlan = plan ?? {
    providerId,
    modelId,
    recipeId: null,
    contractFamily: "unknown",
    executionAdapter: resolveDefaultExecutionAdapter(providerId),
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: (tools?.length ?? 0) > 0 ? { toolChoice: "auto" } : {},
    responsePolicy: {},
  };

  // Phase A6: route the executionAdapter through the structured selector +
  // capability-aware resolver. Legacy string values for CLI/chat kinds round-trip
  // through parseExecutionAdapterSelector; legacy strings outside the structured
  // taxonomy (responses, embedding, image_gen, async, transcription) fall through
  // to the registry directly so existing routes are unchanged.
  const executionAdapterRaw = effectivePlan.executionAdapter;
  let selector: ExecutionAdapterSelector | null;
  try {
    selector = parseExecutionAdapterSelector(executionAdapterRaw);
  } catch (e) {
    if (typeof executionAdapterRaw !== "string") {
      // Object input that failed validation — propagate.
      throw e;
    }
    selector = null;
  }

  // CLI adapters (anthropic-sub, codex) resolve their own auth and spawn CLI
  // binaries — they do not need HTTP base URL or auth headers.
  const isCliAdapter =
    selector !== null &&
    (selector.kind === "claude-code-cli" || selector.kind === "codex-cli");
  const soleToolFunction = tools?.length === 1 ? tools[0]?.["function"] : undefined;
  const soleToolName = soleToolFunction && typeof soleToolFunction === "object" && !Array.isArray(soleToolFunction)
    ? (soleToolFunction as Record<string, unknown>)["name"]
    : undefined;
  const callerGuardsSoleTerminalWriter = Boolean(
    mcpSession
    && typeof soleToolName === "string"
    && effectivePlan.responsePolicy.terminalWriterToolName === soleToolName,
  );
  if (effectivePlan.toolPolicy.toolChoice === "required" && isCliAdapter && !callerGuardsSoleTerminalWriter) {
    throw new InferenceError(
      `Execution adapter ${selector?.kind ?? String(executionAdapterRaw)} cannot enforce required tool choice.`,
      "provider_error",
      providerId,
    );
  }
  if (effectivePlan.toolPolicy.toolChoice === "required" && isCliAdapter) {
    console.info(
      `[ai-inference] Delegating exact terminal-writer completion enforcement to the caller policy for ${String(soleToolName)}.`,
    );
  }

  // EP-COST Phase 4: consult CliPoolStatus before dispatching a CLI-backed call.
  // If the pool is known-exhausted (resetAt is in the future), throw rate_limit
  // so routed-inference.ts falls back to the next provider in the priority list
  // rather than firing into an already-saturated CLI pool.
  if (isCliAdapter && selector !== null) {
    const cliAdapterType = selector.kind === "claude-code-cli" ? "claude-cli" : "codex-cli";
    const poolState = await getCliPoolStatus(cliAdapterType);
    if (poolState?.isExhausted) {
      const waitSecs = poolState.secondsUntilReset ?? "unknown";
      throw new InferenceError(
        `${cliAdapterType} pool exhausted — resets in ~${waitSecs}s (EP-COST pool check)`,
        "rate_limit",
        providerId,
      );
    }
  }

  const baseUrl = isCliAdapter ? "cli://local" : await resolveExecutionBaseUrl(providerId, provider);
  if (!baseUrl) throw new InferenceError("No base URL configured", "provider_error", providerId);
  const headers = isCliAdapter ? {} : await buildAuthHeaders(providerId, provider.authMethod, provider.authHeader);

  // 3. Dispatch to adapter (instrumented for Prometheus metrics)
  const adapter =
    selector !== null
      ? await resolveExecutionAdapter(selector, effectivePlan.capabilityRequirements)
      : getExecutionAdapter(executionAdapterRaw as string);
  const endTimer = aiInferenceDuration.startTimer({ provider: providerId, model: modelId, agent: "unknown" });
  const telemetryStartedAt = new Date();
  // Phase A7: telemetry kind derived from the structured selector when
  // present; legacy-string paths land as "legacy:<adapter>" so analytics can
  // distinguish unrouted traffic from structured-selector traffic.
  const telemetryAdapterKind =
    selector !== null
      ? selector.kind
      : `legacy:${typeof executionAdapterRaw === "string" ? executionAdapterRaw : "unknown"}`;
  // Admission gate: bound concurrent inference per engine so a fleet of
  // autonomous coworkers can't overload a scarce backend (local model ≈ 1-2
  // concurrent before latency collapses; remote = provider rate limit / cost).
  // Interactive turns take priority over autonomous/background work, so a human
  // waiting on a reply never queues behind a scheduled brief. Held only across
  // the actual inference call, released in `finally`. See inference-admission.ts.
  const engineKey = engineKeyForProvider(providerId);
  const releaseInferenceSlot = await acquireInferenceSlot(engineKey, currentInferenceOrigin(), {
    providerId,
    modelId,
  });
  let result;
  try {
    result = await adapter.execute({
      providerId,
      modelId,
      plan: effectivePlan,
      provider: { baseUrl, headers },
      messages,
      systemPrompt,
      tools,
      previousResponseId,
      mcpSession,
    });
    endTimer();
  } catch (err) {
    endTimer();
    const errorType = err instanceof InferenceError ? err.code : "unknown";
    aiInferenceErrors.inc({ provider: providerId, error_type: errorType });
    // Phase A7: telemetry write before re-throw. Fire-and-forget — the writer
    // swallows its own errors so we never mask the original throw.
    const finishedAt = new Date();
    void writeAdapterTelemetry({
      traceId: attribution?.traceId ?? undefined,
      adapterKind: telemetryAdapterKind,
      adapterVersion: selector?.version ?? "unknown",
      providerId,
      modelId,
      executionMode: "single",
      startedAt: telemetryStartedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - telemetryStartedAt.getTime(),
      status: "error",
      errorClass: err instanceof InferenceError ? err.code : "unknown",
      httpStatus: err instanceof InferenceError ? err.statusCode : undefined,
      refusalReason: err instanceof InferenceError
        ? (err.rawBody ?? err.message)
        : (err instanceof Error ? err.message : undefined),
      agentId: attribution?.agentId ?? undefined,
      threadId: attribution?.threadId ?? undefined,
      buildId: attribution?.buildId ?? undefined,
      skillId: attribution?.skillId ?? undefined,
      agentMessageId: attribution?.agentMessageId ?? undefined,
    });
    if (err instanceof InferenceError && err.capacity) {
      void recordProviderCapacityStatus({
        providerId,
        classification: err.capacity,
        source: "api",
        rawSnippet: err.rawBody ?? err.message,
      }).catch((capacityErr) => {
        console.warn("[ai-inference] Failed to record provider capacity:", capacityErr);
      });
    }
    throw err;
  } finally {
    releaseInferenceSlot();
  }

  void clearProviderCapacityStatus({ providerId, source: "api" }).catch((capacityErr) => {
    console.warn("[ai-inference] Failed to clear provider capacity:", capacityErr);
  });

  // 4. Record token and cost metrics
  aiInferenceTokens.inc({ provider: providerId, model: modelId, direction: "input" }, result.usage.inputTokens);
  aiInferenceTokens.inc({ provider: providerId, model: modelId, direction: "output" }, result.usage.outputTokens);
  if (result.usage.cacheCreationInputTokens) {
    aiCacheCreationTokens.inc({ provider: providerId, model: modelId }, result.usage.cacheCreationInputTokens);
  }
  if (result.usage.cacheReadInputTokens) {
    aiCacheReadTokens.inc({ provider: providerId, model: modelId }, result.usage.cacheReadInputTokens);
  }

  // Phase A7: success-path telemetry row. Fire-and-forget so a DB outage
  // can't break the user's reply.
  const telemetryFinishedAt = new Date();
  void writeAdapterTelemetry({
    traceId: attribution?.traceId ?? undefined,
    adapterKind: telemetryAdapterKind,
    adapterVersion: selector?.version ?? "unknown",
    providerId,
    modelId,
    executionMode: "single",
    startedAt: telemetryStartedAt,
    finishedAt: telemetryFinishedAt,
    durationMs: telemetryFinishedAt.getTime() - telemetryStartedAt.getTime(),
    status: "success",
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
    toolCallsTotal: result.toolCalls.length,
    agentId: attribution?.agentId ?? undefined,
    threadId: attribution?.threadId ?? undefined,
    buildId: attribution?.buildId ?? undefined,
    skillId: attribution?.skillId ?? undefined,
    agentMessageId: attribution?.agentMessageId ?? undefined,
  });

  // 5. Map AdapterResult → InferenceResult
  return {
    content: result.text,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    inferenceMs: result.inferenceMs,
    ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    responseId: result.responseId,
    truncated: result.truncated ?? false,
    // Adapters may set result.raw (e.g. transcription adapter for Whisper
    // verbose_json segments). Passed through verbatim; undefined when absent.
    ...(result.raw !== undefined && { raw: result.raw }),
  };
}

// ─── Token Usage Logging ─────────────────────────────────────────────────────

export async function logTokenUsage(input: {
  traceId?: string | null;
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: input.providerId } });

  let costUsd = 0;
  if (provider) {
    if (provider.costModel === "compute" && input.inferenceMs !== undefined) {
      costUsd = computeComputeCost(
        input.inferenceMs,
        provider.computeWatts ?? 150,
        provider.electricityRateKwh ?? 0.12,
      );
    } else if (provider.costModel === "token") {
      costUsd = computeTokenCost(
        input.inputTokens,
        input.outputTokens,
        provider.inputPricePerMToken ?? 0,
        provider.outputPricePerMToken ?? 0,
      );
    }
  }

  // Record cost metric for Prometheus
  if (costUsd > 0) {
    aiInferenceCostUsd.inc({ provider: input.providerId }, costUsd);
  }

  await prisma.tokenUsage.create({
    data: {
      traceId:      input.traceId ?? null,
      agentId:      input.agentId,
      providerId:   input.providerId,
      contextKey:   input.contextKey,
      inputTokens:  input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.inferenceMs !== undefined && { inferenceMs: input.inferenceMs }),
      costUsd,
    },
  });
}
