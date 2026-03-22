// apps/web/lib/ai-inference.ts
// Shared inference module — plain server-only module (NOT "use server").
// Server actions in actions/*.ts can import from here freely.

import { prisma } from "@dpf/db";
import { computeTokenCost, computeComputeCost } from "@/lib/ai-provider-types";
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
import type { RoutedExecutionPlan } from "./routing/recipe-types";
import { getExecutionAdapter } from "./routing/execution-adapter-registry";
import "./routing/chat-adapter"; // side-effect: registers "chat" adapter
import "./routing/image-gen-adapter"; // EP-INF-009c: registers "image_gen" adapter
import "./routing/embedding-adapter"; // EP-INF-009c: registers "embedding" adapter
import "./routing/transcription-adapter"; // EP-INF-009c: registers "transcription" adapter
import "./routing/async-adapter"; // EP-INF-009d: registers "async" adapter

// ─── Types ───────────────────────────────────────────────────────────────────

/** Anthropic-style content blocks for structured tool-calling messages */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

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
};

// ─── Error Types ─────────────────────────────────────────────────────────────

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "auth" | "rate_limit" | "model_not_found" | "provider_error",
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
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

  if (status === 401 || status === 403) {
    return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status, headers);
  }
  if (status === 429) {
    return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status, headers);
  }
  if (status === 404) {
    return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status, headers);
  }
  return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 300)}`, "provider_error", providerId, status, headers);
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
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

// ─── callProvider ────────────────────────────────────────────────────────────

export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
): Promise<InferenceResult> {
  // 1. Resolve provider (DB lookup + auth headers)
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) throw new InferenceError("Provider not found", "provider_error", providerId);
  const baseUrl = provider.baseUrl ?? provider.endpoint;
  if (!baseUrl) throw new InferenceError("No base URL configured", "provider_error", providerId);
  const headers = await buildAuthHeaders(providerId, provider.authMethod, provider.authHeader);

  // 2. Build minimal plan if none provided (backward compat)
  const effectivePlan: RoutedExecutionPlan = plan ?? {
    providerId,
    modelId,
    recipeId: null,
    contractFamily: "unknown",
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
  };

  // 3. Dispatch to adapter
  const adapter = getExecutionAdapter(effectivePlan.executionAdapter);
  const result = await adapter.execute({
    providerId,
    modelId,
    plan: effectivePlan,
    provider: { baseUrl, headers },
    messages,
    systemPrompt,
    tools,
  });

  // 4. Map AdapterResult → InferenceResult
  return {
    content: result.text,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    inferenceMs: result.inferenceMs,
    ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
  };
}

// ─── Token Usage Logging ─────────────────────────────────────────────────────

export async function logTokenUsage(input: {
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

  await prisma.tokenUsage.create({
    data: {
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
