// apps/web/lib/routing/chat-adapter.ts

/**
 * EP-INF-008b: Default "chat" execution adapter.
 *
 * Extracts the per-provider HTTP dispatch logic from callProvider() into a
 * standalone adapter implementing the ExecutionAdapterHandler interface.
 *
 * Supports three provider branches:
 *   1. Anthropic  — POST {baseUrl}/messages
 *   2. Gemini     — POST {baseUrl}/models/{modelId}:generateContent
 *   3. OpenAI-compatible (everything else) — POST {apiBase}/v1/chat/completions
 */

import type { ToolCallEntry } from "./chat-message-types";
import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "./inference-error";
import {
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  extractTextualToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
  formatMessageForResponses,
} from "./provider-message-format";
import { isAnthropic } from "./provider-utils";
import { isLocalProviderId } from "./provider-locality";
import { formatMessagesForGemini } from "./gemini-messages";
import { captureAnthropicWeeklyQuota } from "./cli-pool-status";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { extractToolCalls as extractTextualToolUse } from "./extract-tool-calls";
import { toWireSampling } from "./sampling-profile";
import { localToolThinkingKwargs } from "./local-tool-thinking";
import { captureLocalNativeContinuation, type LocalContinuationBinding } from "./local-native-continuation";
import { prepareLocalNativeChatReplay } from "./local-native-chat-replay";
import { buildAnthropicSystem } from "./anthropic-cache";
import { parseOpenRouterRoutingEvidence } from "./provider-suitability/openrouter-policy";
import { resolveOpenAiCompatibleApiBase } from "./openai-base";
import {
  createInferenceTimeoutSignal,
  resolveInferenceRuntimePolicy,
} from "./local-inference-runtime-policy";
import { isRecord } from "@/lib/shared/coerce";
import { assertGovernedInferenceAuthority, currentGovernedInferenceDeadline,
  currentInferenceSignal } from "./governed-inference-deadline";

// Compatibility export for existing callers; callProvider now owns local
// admission, so this adapter never acquires the lane itself.
export { withLocalInferenceLock } from "@/lib/queue/resource-lane";

// ─── Inference HTTP timeouts ──────────────────────────────────────────────────
// The runtime-policy module separates the governed, deliberately slower 27B
// reviewer from generic local models. Both operator overrides and defaults stay
// bounded; a server-bound parent deadline supplies the governed exception.

// ─── Gemini part types ───────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  thoughtSignature?: string;
  executableCode?: { language: string; code: string };
  codeExecutionResult?: { outcome: string; output: string };
}

type ResponsesMessagePart = {
  type?: string;
  text?: string;
};

function extractResponsesText(
  output: Array<{
    type?: string;
    content?: ResponsesMessagePart[];
  }> | undefined,
  outputText?: string,
): string {
  const text = (output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text ?? "")
    .join("");

  return text || outputText || "";
}

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$defs",
  "$id",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "definitions",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "deprecated",
  "else",
  "examples",
  "if",
  "not",
  "patternProperties",
  "propertyNames",
  "readOnly",
  "then",
  "unevaluatedProperties",
  "uniqueItems",
  "writeOnly",
]);

/**
 * Collapse a JSON Schema union type to the scalar Gemini's proto accepts.
 *
 * `type: ["string", "null"]` is ordinary JSON Schema and every other provider
 * takes it. Gemini's functionDeclarations are proto-backed, where `type` is a
 * singular field, so a list is rejected outright:
 *
 *   Invalid JSON payload received. Unknown name "type" at
 *   'tools[0].function_declarations[15].parameters.properties[9].value':
 *   Proto field is not repeating, cannot start list.
 *
 * Returns the first non-null member as the type, and whether "null" was among
 * them so the caller can set `nullable`. First-member choice is deliberate:
 * a union's leading entry is the one authors write as the real type, with
 * "null" appended, so it is the closest single type to the author's intent.
 */
function collapseGeminiUnionType(value: unknown): { type: unknown; nullable: boolean } | null {
  if (!Array.isArray(value)) return null;
  const members = value.filter((entry): entry is string => typeof entry === "string");
  const concrete = members.filter((entry) => entry !== "null");
  const nullable = members.length !== concrete.length;
  // An all-null union carries no type at all; leaving it out is the only honest
  // rendering, and Gemini treats a missing type as unconstrained.
  if (concrete.length === 0) return nullable ? { type: undefined, nullable: true } : null;
  return { type: concrete[0], nullable };
}

function sanitizeGeminiSchemaNode(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiSchemaNode(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!propertyMap && GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    // BI-3907AF35: a union `type` reaches Gemini as a list and fails the whole
    // request, so every coworker holding such a tool cannot run at all — not
    // just for that tool. Collapse it here rather than asking every tool author
    // to avoid ordinary JSON Schema.
    if (!propertyMap && key === "type") {
      const collapsed = collapseGeminiUnionType(child);
      if (collapsed) {
        if (collapsed.type !== undefined) sanitized[key] = collapsed.type;
        if (collapsed.nullable) sanitized.nullable = true;
        continue;
      }
    }
    sanitized[key] = sanitizeGeminiSchemaNode(child, !propertyMap && key === "properties");
  }
  return sanitized;
}


function toGeminiFunctionDeclarations(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tools
    .filter((t) => t.type === "function" && t.function)
    .map((t) => {
      const fn = t.function as Record<string, unknown>;
      return {
        name: fn.name,
        description: fn.description,
        parameters: sanitizeGeminiSchemaNode(fn.parameters),
      };
    });
}

/** Exported for test: the union collapse is the whole point of the fix. */
export const __testing = { sanitizeGeminiSchemaNode, toGeminiFunctionDeclarations };

// ─── Chat Adapter ────────────────────────────────────────────────────────────

export const chatAdapter: ExecutionAdapterHandler = {
  type: "chat",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools } = request;
    const { baseUrl, headers } = provider;
    let requestHeaders = headers;
    const total = plan.completionAllowance;
    if (total !== undefined && (!Number.isSafeInteger(total) || total <= 0 || plan.maxTokens !== total)) {
      throw new Error("Invalid activity total completion allowance");
    }
    const boundedThinking = (budget: number): number => {
      if (total === undefined) return budget;
      const reserve = Math.max(2048, Math.ceil(total / 4));
      if (!Number.isSafeInteger(budget) || budget < 1024 || total - reserve < 1024) {
        throw new Error("Activity allowance cannot accommodate provider thinking budget");
      }
      return Math.min(budget, total - reserve);
    };

    // Build provider-specific request
    let chatUrl: string;
    let body: Record<string, unknown>;

    if (isAnthropic(providerId)) {
      // ── Anthropic ──────────────────────────────────────────────────────
      chatUrl = `${baseUrl}/messages`;
      body = {
        model: modelId,
        max_tokens: plan.maxTokens,
        // BI-79A5C00F: emit a cache_control breakpoint on the stable system
        // prefix (split on SYSTEM_PROMPT_DYNAMIC_BOUNDARY); plain string when
        // no boundary is present, so non-assembled prompts are unchanged.
        system: buildAnthropicSystem(systemPrompt),
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => formatMessageForAnthropic(m)),
      };

      // EP-INF-013: Map effort → extended thinking for Anthropic.
      // effort="low" (or absent) → no thinking parameter (default, fast).
      // effort="medium/high/max" → enable thinking with a token budget.
      // Explicit providerSettings.thinking takes precedence over effort.
      const effortBudgets: Record<string, number> = { medium: 8_000, high: 32_000, max: 64_000 };
      const effort = plan.providerSettings?.effort as string | undefined;
      if (plan.providerSettings?.thinking) {
        // Explicit thinking config overrides effort
        (body as Record<string, unknown>).thinking = plan.providerSettings.thinking;
        // Ensure max_tokens accommodates the explicitly set budget
        const explicitBudget = (plan.providerSettings.thinking as { budget_tokens?: number }).budget_tokens ?? 0;
        if (total !== undefined && (plan.providerSettings.thinking as { type?: string }).type === "enabled") {
          (body as Record<string, unknown>).thinking = { ...(plan.providerSettings.thinking as object), budget_tokens: boundedThinking(explicitBudget) };
        }
        body.max_tokens = total ?? Math.max(plan.maxTokens, explicitBudget + 2_048);
        // Anthropic rejects temperature when thinking is enabled
        delete (body as Record<string, unknown>).temperature;
      } else if (effort && effort !== "low" && effortBudgets[effort]) {
        const budget = boundedThinking(effortBudgets[effort]!);
        (body as Record<string, unknown>).thinking = { type: "enabled", budget_tokens: budget };
        // max_tokens must be >= budget_tokens; add 2 048 for output headroom
        body.max_tokens = total ?? Math.max(plan.maxTokens, budget + 2_048);
        // Anthropic rejects temperature when thinking is enabled
        delete (body as Record<string, unknown>).temperature;
      }

      // Apply temperature (only when thinking is NOT enabled — handled above)
      if (plan.temperature !== undefined && !(body as Record<string, unknown>).thinking) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }

      // Anthropic tools: convert OpenAI format → Anthropic format
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => {
          const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
          return fn ? { name: fn.name, description: fn.description, input_schema: fn.parameters } : t;
        });
        if (plan.toolPolicy.toolChoice) {
          body.tool_choice = {
            type: plan.toolPolicy.toolChoice === "required"
              ? "any"
              : plan.toolPolicy.toolChoice,
          };
        }
      }

      // Merge providerTools (e.g. computer use) into tools array
      const providerTools = plan.providerSettings?.providerTools as Array<Record<string, unknown>> | undefined;
      if (providerTools && providerTools.length > 0) {
        body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), ...providerTools];
      }

    } else if (providerId === "gemini") {
      // ── Gemini ─────────────────────────────────────────────────────────
      chatUrl = `${baseUrl}/models/${modelId}:generateContent`;

      const contents: ReturnType<typeof formatMessagesForGemini> = [];
      if (systemPrompt) {
        contents.push({ role: "user", parts: [{ text: systemPrompt }] });
        contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
      }
      contents.push(...formatMessagesForGemini(messages, modelId));

      body = { contents };

      // Apply generation config
      if (plan.maxTokens) {
        (body as Record<string, unknown>).generationConfig = {
          ...((body as Record<string, unknown>).generationConfig as Record<string, unknown> ?? {}),
          maxOutputTokens: plan.maxTokens,
        };
      }
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).generationConfig = {
          ...((body as Record<string, unknown>).generationConfig as Record<string, unknown> ?? {}),
          temperature: plan.temperature,
        };
      }
      // BI-1F5DAABC / BI-DBAFEC10: the rest of the resolved sampling, plus the
      // thinking budget. Gemini's generationConfig is camelCase, and before this
      // it received neither top_p/top_k nor thinkingConfig at all — reasoning
      // depth was computed for every call and then discarded here.
      {
        const extra: Record<string, unknown> = {};
        const values = plan.sampling?.values;
        if (values?.topP !== undefined) extra.topP = values.topP;
        if (values?.topK !== undefined) extra.topK = values.topK;
        const thinkingConfig = plan.providerSettings?.thinkingConfig;
        if (thinkingConfig) extra.thinkingConfig = thinkingConfig;
        if (Object.keys(extra).length > 0) {
          (body as Record<string, unknown>).generationConfig = {
            ...((body as Record<string, unknown>).generationConfig as Record<string, unknown> ?? {}),
            ...extra,
          };
        }
      }

      // Convert OpenAI-format function tools to Gemini functionDeclarations format
      if (tools && tools.length > 0) {
        const functionDeclarations = toGeminiFunctionDeclarations(tools);
        if (functionDeclarations.length > 0) {
          body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), { functionDeclarations }];
          if (plan.toolPolicy.toolChoice) {
            body.toolConfig = {
              functionCallingConfig: {
                mode: plan.toolPolicy.toolChoice === "required"
                  ? "ANY"
                  : plan.toolPolicy.toolChoice.toUpperCase(),
                ...(plan.toolPolicy.toolChoice === "required"
                  ? { allowedFunctionNames: functionDeclarations.map((tool) => String(tool.name)) }
                  : {}),
              },
            };
          }
        }
      }

      // Merge providerTools (e.g. code_execution, google_search_retrieval)
      const providerTools = plan.providerSettings?.providerTools as Array<Record<string, unknown>> | undefined;
      if (providerTools && providerTools.length > 0) {
        body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), ...providerTools];
      }

    } else if (providerId === "chatgpt") {
      // ── ChatGPT Subscription (Responses API via chatgpt.com/backend-api) ─
      chatUrl = `${baseUrl}/codex/responses`;

      // Responses API format: input array + instructions (system prompt)
      const input = messages.flatMap((m) => formatMessageForResponses(m));

      body = {
        model: modelId,
        input,
        store: false,
        stream: true,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
      };

      // Apply temperature
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }
      // Convert OpenAI Chat Completions format tools to Responses API format
      // Responses API expects: tools: [{ type: "function", name, description, parameters }]
      if (tools && tools.length > 0) {
        body.tools = tools.map((t: Record<string, unknown>) => {
          if (t.type === "function" && t.function) {
            const fn = t.function as Record<string, unknown>;
            return { type: "function", name: fn.name, description: fn.description, parameters: fn.parameters };
          }
          return t;
        });
        if (plan.toolPolicy.toolChoice) body.tool_choice = plan.toolPolicy.toolChoice;
      }

    } else {
      // ── OpenAI-compatible ──────────────────────────────────────────────
      const selectedBaseUrl = providerId === "openrouter" && plan.openRouterPolicy?.requiredBaseUrl
        ? plan.openRouterPolicy.requiredBaseUrl
        : baseUrl;
      const apiBase = resolveOpenAiCompatibleApiBase(selectedBaseUrl);
      chatUrl = `${apiBase}/chat/completions`;

      const allMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m) => formatMessageForOpenAI(m)),
      ];

      body = {
        model: modelId,
        messages: allMessages,
        max_tokens: plan.maxTokens,
        keep_alive: -1,
      };
      if (plan.providerSettings.thinking_budget_tokens !== undefined) {
        const budget = plan.providerSettings.thinking_budget_tokens;
        if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0 || budget >= plan.maxTokens) {
          throw new Error("Invalid local thinking allowance");
        }
        (body as Record<string, unknown>).thinking_budget_tokens = budget;
      }

      if (providerId === "openrouter" && plan.openRouterPolicy) {
        // One construction point makes the typed policy load-bearing for every
        // OpenRouter chat/completions call; callers cannot separately construct
        // an unbounded body after suitability has compiled the plan.
        body.provider = plan.openRouterPolicy.providerSettings;
        requestHeaders = {
          ...headers,
          "X-OpenRouter-Metadata": "enabled",
        };
      }

      // Apply temperature
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }
      // BI-1F5DAABC: the rest of the resolved sampling. Vendor-published values
      // for the served model — running at engine defaults instead is the
      // documented cause of repetition loops on Qwen3 and DeepSeek-R1.
      for (const [key, value] of Object.entries(toWireSampling({
        values: plan.sampling?.values ?? {},
        provenance: {},
        dropped: [],
        mode: plan.sampling?.mode ?? "default",
      }))) {
        if (key === "temperature") continue; // already applied above
        (body as Record<string, unknown>)[key] = value;
      }
      // BI-5C48438C: constrain decoding when the contract says the response must
      // satisfy a schema. `responsePolicy.strictSchema` was carried on the plan
      // and never sent to any provider, so a schema-bound turn was asked for
      // structure in the prompt and nothing else. Ollama and the OpenAI-compatible
      // providers all honour response_format, and a constrained decode makes
      // malformed JSON mechanically impossible rather than merely unlikely.
      if (plan.responsePolicy?.strictSchema) {
        (body as Record<string, unknown>).response_format = { type: "json_object" };
      }
      // Apply reasoning_effort (explicit setting takes precedence over effort)
      // EP-INF-013: fall back to deriving from effort when not explicitly set.
      // OpenAI o-series models support "low"/"medium"/"high"; max → "high".
      if (plan.providerSettings?.reasoning_effort) {
        (body as Record<string, unknown>).reasoning_effort = plan.providerSettings.reasoning_effort;
      } else if (plan.providerSettings?.effort) {
        const effortMap: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };
        const mapped = effortMap[plan.providerSettings.effort as string];
        if (mapped) (body as Record<string, unknown>).reasoning_effort = mapped;
      }
      // Apply tool_choice
      if (plan.toolPolicy?.toolChoice && tools && tools.length > 0) {
        (body as Record<string, unknown>).tool_choice = plan.toolPolicy.toolChoice;
      }
      // Pass tools through in OpenAI format, stripping non-standard fields
      // (e.g. annotations) that some models reject or mishandle.
      if (tools && tools.length > 0) {
        body.tools = tools.map((t: Record<string, unknown>) => {
          if (t.type === "function" && t.function) {
            const fn = t.function as Record<string, unknown>;
            return { type: "function", function: { name: fn.name, description: fn.description, parameters: fn.parameters } };
          }
          return t;
        });
        // A local tool turn that opens <think> spends the answer budget before
        // the tool call. The template only skips that when the request says so.
        const thinkingKwargs = localToolThinkingKwargs(providerId, tools.length);
        if (thinkingKwargs) {
          (body as Record<string, unknown>).chat_template_kwargs = thinkingKwargs;
        }
      }
    }

    // ── Dispatch ────────────────────────────────────────────────────────────
    const startMs = Date.now();
    let continuationBinding: LocalContinuationBinding | undefined;
    let nativeReplay = false;
    let res: Response;
    try {
      // callProvider owns admission; governed queue wait consumes the parent budget.
      await assertGovernedInferenceAuthority(currentInferenceSignal());
      if (plan.providerSettings.thinking_budget_tokens !== undefined) {
        const expected = plan.localThinkingBudgetEvidence;
        if (!isLocalProviderId(providerId) || !expected) throw new Error("Local thinking runtime evidence unavailable");
        const root = baseUrl.replace(/\/(engines\/)?v1\/?$/, "");
        const actual = await request.readLocalThinkingBudgetEvidence?.(root, modelId, request.fetchImpl);
        if (!actual || ["dialect", "modelDigest", "engineIdentity", "templateDigest", "configDigest"].some(
          key => actual[key as keyof typeof actual] !== expected[key as keyof typeof expected],
        )) throw new Error("Local thinking runtime evidence changed or unavailable");
        await assertGovernedInferenceAuthority(currentInferenceSignal());
      }
      const continuation = await prepareLocalNativeChatReplay(request, chatUrl);
      if (continuation) {
        continuationBinding = continuation.binding;
        nativeReplay = continuation.replayed;
        body.messages = continuation.messages;
        await assertGovernedInferenceAuthority(currentInferenceSignal());
      }
      const execution = currentGovernedInferenceDeadline();
      const signal = currentInferenceSignal(execution?.signal);
      const timeout = createInferenceTimeoutSignal(resolveInferenceRuntimePolicy(providerId, modelId, {
        defaultTimeoutMs: process.env.DPF_INFERENCE_TIMEOUT_MS,
        localTimeoutMs: process.env.DPF_LOCAL_INFERENCE_TIMEOUT_MS,
      }, execution ? { deadlineAt: execution.deadlineAt, now: Date.now() } : undefined).effectiveTimeoutMs);
      res = await request.fetchImpl(chatUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (e) {
      currentInferenceSignal()?.throwIfAborted();
      // A busy GPU is a capacity deferral. Wrapping it as "network" makes the
      // fallback chain treat the local model as broken instead of waiting.
      if (e instanceof Error && ["LocalProviderCapacityDeferredError", "GovernedInferenceDeadlineError"].includes(e.name)) throw e;
      throw new InferenceError(
        nativeReplay ? `Network error calling ${providerId}: private dispatch details omitted`
          : `Network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
        "network",
        providerId,
      );
    }
    const inferenceMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const error = classifyHttpError(res.status, providerId, errBody, res.headers);
      // A server may echo the request. Keep its typed status/capacity decision,
      // but never carry a private continuation into durable failure diagnostics.
      if (nativeReplay) {
        const retry = error.headers?.["retry-after"];
        const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? retry : error.capacity?.retryAfterSeconds;
        throw new InferenceError(
          `${error.message.split(":", 1)[0]}: private dispatch details omitted`,
          error.code, error.providerId, error.statusCode,
          seconds === undefined ? undefined : { "retry-after": String(seconds) }, undefined, error.capacity,
        );
      }
      throw error;
    }

    // Topology-free REAL weekly-quota capture: a subscription/OAuth Anthropic
    // response carries anthropic-ratelimit-unified-7d-* headers with the true
    // remaining weekly allocation. Persist them for the capacity-drain policy.
    // No-op when absent (API-key traffic isn't on the weekly meter).
    if (isAnthropic(providerId)) {
      void captureAnthropicWeeklyQuota(providerId, res.headers);
    }

    // ChatGPT Responses API requires stream:true — collect SSE into final response
    let data: Record<string, unknown>;
    if (providerId === "chatgpt") {
      const rawText = await res.text();
      // SSE format: lines starting with "data: " followed by JSON, ending with "data: [DONE]"
      // The last event before [DONE] with type "response.completed" contains the full response
      const lines = rawText.split("\n");
      let lastCompleted: Record<string, unknown> | null = null;
      let lastDelta = "";
      let parsedEventCount = 0;
      const eventTypes = new Set<string>();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
          parsedEventCount++;
          if (typeof parsed.type === "string") eventTypes.add(parsed.type);
          if (parsed.type === "response.completed" && parsed.response) {
            lastCompleted = parsed.response as Record<string, unknown>;
          }
          // Collect text deltas as fallback
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            lastDelta += parsed.delta;
          }
        } catch { /* skip malformed lines */ }
      }
      if (!lastCompleted && !lastDelta) {
        console.warn(`[chat-adapter] ChatGPT SSE: ${lines.length} lines, ${parsedEventCount} parsed events, types=[${[...eventTypes].join(",")}], rawLen=${rawText.length}, first200=${rawText.slice(0, 200)}`);
      }
      data = lastCompleted ?? { output: [{ type: "message", content: [{ type: "output_text", text: lastDelta }] }] };
    } else {
      try {
        data = await res.json() as Record<string, unknown>;
      } catch (error) {
        if (nativeReplay) throw new InferenceError(
          `Invalid response from ${providerId}: private dispatch details omitted`, "provider_error", providerId,
        );
        throw error;
      }
    }

    const openRouterRoutingEvidence = providerId === "openrouter"
      ? parseOpenRouterRoutingEvidence(data.openrouter_metadata)
      : undefined;
    if (
      plan.openRouterPolicy?.requireUnderlyingProviderEvidence &&
      openRouterRoutingEvidence?.underlyingProviderEvidence !== "returned"
    ) {
      throw new InferenceError(
        "Restricted OpenRouter response did not return underlying-provider metadata; the result was withheld.",
        "provider_error",
        providerId,
      );
    }

    // ── Extract text, tool calls, and usage ──────────────────────────────
    let text: string;
    let toolCalls: ToolCallEntry[] = [];
    let inputTokens: number;
    let outputTokens: number;
    let cacheCreationInputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;
    // Provider stop signal → normalized truncation flag. The agentic loop reads
    // this to avoid returning a max_tokens-truncated fragment as a final answer
    // (BI-1D144CC1). Each branch below maps its provider-specific value.
    let truncated = false;
    let finishReason: string | undefined;
    /** Separate thinking channel, when the provider emits one (BI-1E77BEE3). */
    let reasoning: string | undefined;
    let nativeReasoning: string | undefined;

    if (isAnthropic(providerId)) {
      // Anthropic response
      const contentBlocks = data.content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
      text = contentBlocks?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
      toolCalls = extractAnthropicToolCalls(contentBlocks ?? []);
      truncated = data.stop_reason === "max_tokens";

      const usage = (data.usage as Record<string, number>) ?? {};
      inputTokens = usage.input_tokens ?? 0;
      outputTokens = usage.output_tokens ?? 0;
      // Prompt-cache token counts (only present when cache is active; 0 means no cache activity)
      if ((usage.cache_creation_input_tokens ?? 0) > 0) cacheCreationInputTokens = usage.cache_creation_input_tokens;
      if ((usage.cache_read_input_tokens ?? 0) > 0) cacheReadInputTokens = usage.cache_read_input_tokens;

    } else if (providerId === "gemini") {
      // Gemini response
      const candidates = data.candidates as Array<{ content?: { parts?: GeminiPart[] } }> | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];

      // Extract text from all part types (text, executableCode, codeExecutionResult)
      const textParts: string[] = [];
      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text);
        } else if (part.executableCode) {
          textParts.push(`\`\`\`${part.executableCode.language?.toLowerCase() ?? "code"}\n${part.executableCode.code}\n\`\`\``);
        } else if (part.codeExecutionResult) {
          textParts.push(`Output: ${part.codeExecutionResult.output}`);
        }
        // functionCall parts are extracted as tool calls, not text
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.id ?? `gemini_${Math.random().toString(36).slice(2, 9)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
            gemini: { modelId, ...(part.functionCall.id ? { functionCallId: part.functionCall.id } : {}),
              ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) },
          });
        }
      }
      text = textParts.join("\n");

      truncated = candidates?.[0] != null
        && (candidates[0] as { finishReason?: string }).finishReason === "MAX_TOKENS";

      const usageMetadata = (data.usageMetadata as Record<string, number>) ?? {};
      inputTokens = usageMetadata.promptTokenCount ?? 0;
      outputTokens = usageMetadata.candidatesTokenCount ?? 0;

    } else if (providerId === "chatgpt") {
      // ChatGPT Responses API response format
      // { output: [{ type: "message", content: [{ type: "output_text", text }] }] }
      const output = data.output as Array<{
        type?: string;
        content?: ResponsesMessagePart[];
      }> | undefined;
      const outputText = typeof data.output_text === "string" ? data.output_text : undefined;
      text = extractResponsesText(output, outputText);
      // Responses API signals truncation via status="incomplete" +
      // incomplete_details.reason="max_output_tokens".
      truncated = data.status === "incomplete"
        && (data.incomplete_details as { reason?: string } | undefined)?.reason === "max_output_tokens";

      const usage = typeof data.usage === "object" && data.usage !== null
        ? data.usage as Record<string, number>
        : {};
      inputTokens = (usage as Record<string, number>).input_tokens ?? 0;
      outputTokens = (usage as Record<string, number>).output_tokens ?? 0;

    } else {
      // OpenAI-compatible response
      const choice = (data.choices as Array<{
        finish_reason?: string;
        message?: {
          content?: string;
          reasoning?: string;
          /** llama.cpp / Docker Model Runner name for the separate thinking channel. */
          reasoning_content?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>)?.[0];
      const msg = choice?.message;
      finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;

      // Capture reasoning as its OWN channel (BI-1E77BEE3). Providers disagree on
      // the field name: llama.cpp / Docker Model Runner emit `reasoning_content`,
      // other OpenAI-compatible providers emit `reasoning`.
      reasoning = msg?.reasoning_content || msg?.reasoning || undefined;
      nativeReasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content : undefined;

      // Thinking without an answer is incomplete work. Keep it available for
      // progress disclosure, but never promote scratchpad into a conclusion.
      text = msg?.content ?? "";
      truncated = choice?.finish_reason === "length";

      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        // Structured tool calls (standard OpenAI format)
        try {
          toolCalls = extractOpenAIToolCalls(msg.tool_calls);
        } catch (error) {
          if (nativeReplay) throw new InferenceError(
            `Invalid tool response from ${providerId}: private dispatch details omitted`, "provider_error", providerId,
          );
          throw error;
        }
      } else if (text && (text.includes("<tool_call>") || text.includes("<|tool_call>"))) {
        // Fallback: model runner didn't translate native tool-call markers to structured format.
        // Handles Gemma/Llama template variants that leak <tool_call> or <|tool_call> as text.
        const extracted = extractTextualToolCalls(text);
        toolCalls = extracted.toolCalls;
        text = extracted.cleanText;
      } else if (text && text.includes('"tool_use"')) {
        // Fallback 2: local/Docker Model Runner (Gemma, Llama) emits the
        // canonical Anthropic-style {"type":"tool_use",...} JSON as plain
        // content rather than a structured tool_calls field. Without this
        // every tool-requiring turn that fallback-routes to local is a
        // silent dead-end: the agentic loop sees toolCalls=0 and gives up.
        // Share the CLI adapters' extractor so the behaviour is identical
        // regardless of provider.
        const textualUse = extractTextualToolUse(text);
        if (textualUse.length > 0) {
          toolCalls = textualUse;
          console.log(`[tool-trace] adapter=chat rescued=${toolCalls.length} names=${JSON.stringify(toolCalls.map(c => c.name))} provider=local-or-chat`);
        }
      }

      const usage = typeof data.usage === "object" && data.usage !== null
        ? data.usage as Record<string, number>
        : {};
      const readUsage = (...keys: string[]): number => {
        for (const key of keys) {
          const value = (usage as Record<string, unknown>)[key];
          if (typeof value === "number") return value;
        }
        return 0;
      };
      inputTokens = readUsage("input_tokens", "prompt_tokens");
      outputTokens = readUsage("output_tokens", "completion_tokens");
    }

    // Keep provider-supplied identity, never the requested model or response body.
    const returnedModel = typeof data.model === "string" && data.model.trim() ? data.model : undefined;
    const result: AdapterResult = {
      text,
      toolCalls,
      // Only present when the provider actually offered a separate channel;
      // consumers read undefined as "not offered", not "the model had none".
      ...(reasoning ? { reasoning } : {}),
      usage: { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens },
      inferenceMs,
      truncated,
      ...(finishReason !== undefined && { finishReason }),
      ...(returnedModel !== undefined || openRouterRoutingEvidence
        ? { raw: {
          ...(returnedModel !== undefined ? { model: returnedModel } : {}),
          ...(openRouterRoutingEvidence ? { openRouterRoutingEvidence } : {}),
        } }
        : {}),
    };
    if (nativeReasoning) captureLocalNativeContinuation(result, nativeReasoning, continuationBinding);
    return result;
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(chatAdapter);
