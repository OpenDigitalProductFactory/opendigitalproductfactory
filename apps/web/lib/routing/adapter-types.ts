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
  raw?: Record<string, unknown>;
  /** Responses API: the response ID for chaining subsequent calls. */
  responseId?: string;
}

/** Contract every execution adapter implements */
export interface ExecutionAdapterHandler {
  type: string;
  execute(request: AdapterRequest): Promise<AdapterResult>;
}
