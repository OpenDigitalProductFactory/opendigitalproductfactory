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
}

/** Normalized output from an execution adapter */
export interface AdapterResult {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
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
