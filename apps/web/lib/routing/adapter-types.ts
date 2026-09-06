// apps/web/lib/routing/adapter-types.ts

/**
 * EP-INF-008a: Execution adapter interface types.
 */

import type { RoutedExecutionPlan } from "./recipe-types";
import type { ChatMessage } from "../ai-inference";

/** Named type for tool call entries (matches InferenceResult.toolCalls shape) */
export type ToolCallEntry = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** Pre-resolved provider connection info — callProvider resolves before dispatch */
export interface ResolvedProvider {
  baseUrl: string;
  headers: Record<string, string>;
}

/**
 * Optional MCP session context — populated by the agentic loop when calling
 * routed inference. Adapters that need to mint short-lived MCP credentials
 * (currently only the Claude CLI execution adapter, for `--mcp-config`)
 * read this. Other adapters ignore it.
 */
export interface AdapterMcpSession {
  userId: string;
  agentId?: string | null;
  threadId?: string | null;
  routeContext?: string | null;
}

/** Input to an execution adapter */
export interface AdapterRequest {
  providerId: string;
  modelId: string;
  plan: RoutedExecutionPlan;
  provider: ResolvedProvider;
  /**
   * Server-owned provider transport. HTTP adapters must use this instead of
   * process-global fetch so long-lived inference never re-enters the libuv
   * getaddrinfo queue. CLI adapters accept the common request shape but do not
   * use this field.
   */
  fetchImpl: typeof fetch;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  /** Responses API: chain to a previous response for multi-turn conversation state. */
  previousResponseId?: string;
  /**
   * Optional caller context for adapters that need to mint MCP credentials
   * (`apps/web/lib/mcp/session-token.ts`). Only the Claude CLI adapter
   * consumes this today. Absent for tests and non-coworker callsites —
   * those keep the legacy text-described tool path.
   */
  mcpSession?: AdapterMcpSession;
}

/**
 * Provider-owned identity returned when an adapter accepts a long-running
 * operation. The platform creates its own durable AsyncInferenceOp identity
 * from this value; keeping the two names distinct prevents callers from
 * accidentally treating a provider handle as the platform record id.
 */
export interface AsyncOperationStartResult {
  status: "accepted";
  providerOperationId: string;
}

/** Normalized output from an execution adapter */
export interface AdapterResult {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Tokens written into the Anthropic prompt cache this call (billed at write rate). */
    cacheCreationInputTokens?: number;
    /** Tokens read from the Anthropic prompt cache this call (billed at read rate). */
    cacheReadInputTokens?: number;
  };
  inferenceMs: number;
  /** Present only when this dispatch started a provider-side async operation. */
  asyncOperation?: AsyncOperationStartResult;
  raw?: Record<string, unknown>;
  /** Responses API: the response ID for chaining subsequent calls. */
  responseId?: string;
  /**
   * True when the provider stopped generation because it hit the output-token
   * ceiling (Anthropic `stop_reason: "max_tokens"`, OpenAI `finish_reason:
   * "length"`, Gemini `finishReason: "MAX_TOKENS"`, Responses `status:
   * "incomplete"` with `max_output_tokens`). The agentic loop MUST NOT treat a
   * truncated reply as a natural end_turn — it continues generation rather than
   * returning the fragment (BI-1D144CC1). Absent/false means a clean stop.
   */
  truncated?: boolean;
  /**
   * The model's own reasoning/scratchpad for this turn, when the provider emits
   * it as a channel SEPARATE from the answer — llama.cpp / Docker Model Runner
   * send `reasoning_content`, some OpenAI-compatible providers send `reasoning`.
   *
   * Verified on the canonical runtime 2026-08-16 against Qwen3.8-27B: a single
   * turn produced 249 chars of `reasoning_content` against 50 chars of
   * `content`, so this is the bulk of what a thinking model spends its time on
   * and the only honest source for a progress surface. (BI-1E77BEE3.)
   *
   * MUST NOT be substituted for `text`. It is scratchpad, not a considered
   * position — real samples read like "likely say no... Need be concise" — so
   * any surface rendering it has to frame it as working-out, subordinate to the
   * answer, and never quote it as the coworker's conclusion.
   *
   * Absent when the provider emits no separate reasoning channel, which is the
   * common case; consumers must treat undefined as "not offered", not "none".
   */
  reasoning?: string;
}

/** Contract every execution adapter implements */
export interface ExecutionAdapterHandler {
  type: string;
  execute(request: AdapterRequest): Promise<AdapterResult>;
}
