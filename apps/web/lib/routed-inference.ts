/**
 * EP-INF-009b: Unified V2 routing + inference dispatch.
 *
 * `routeAndCall()` replaces `callWithFailover()` as the single entry point
 * for all LLM inference. It wraps: contract inference → V2 routing →
 * fallback chain dispatch, providing a simple interface for callers while
 * ensuring every call goes through capability filtering, execution recipes,
 * champion/challenger, rate tracking, and outcome telemetry.
 */

import type { ChatMessage } from "@/lib/ai-inference";
import type { RouteDecision } from "@/lib/routing/types";
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { ModelClass } from "@/lib/routing/model-card-types";
import { inferContract } from "@/lib/routing/request-contract";
import {
  loadEndpointManifests,
  loadPolicyRules,
  loadOverrides,
  persistRouteDecision,
} from "@/lib/routing/loader";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import { callWithFallbackChain } from "@/lib/routing/fallback";

// ─── Result type ────────────────────────────────────────────────────────────

/** Unified inference result — flat token fields, V2 metadata included. */
export interface RoutedInferenceResult {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
  downgraded: boolean;
  downgradeMessage: string | null;
  /** True when tools were stripped due to capability degradation (local model). */
  toolsStripped: boolean;
  /** The V2 route decision that selected this endpoint (for audit/metadata). */
  routeDecision: RouteDecision;
  /** EP-INF-009d: Set when interactionMode is "background". Poll via pollAsyncOperation(). */
  asyncOperationId?: string;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export class NoEligibleEndpointsError extends Error {
  constructor(
    public readonly taskType: string,
    public readonly reason: string,
    public readonly excludedCount: number,
  ) {
    super(
      `No eligible endpoints for task '${taskType}': ${reason}` +
      (excludedCount > 0 ? ` (${excludedCount} endpoint(s) excluded)` : ""),
    );
    this.name = "NoEligibleEndpointsError";
  }
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface RouteAndCallOptions {
  /** Tools to provide to the model. Also sets requiresTools on the contract. */
  tools?: Array<Record<string, unknown>>;
  /** Task type override. Defaults to "conversation". */
  taskType?: string;
  /** Prefer a specific provider (biases ranking, does not hard-pin). */
  preferredProviderId?: string;
  /** Specialized capability requirements. */
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
  /** Budget posture override. */
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  /** EP-INF-009c: Route to a specific model class (e.g., "image_gen", "embedding"). */
  requiredModelClass?: ModelClass;
  /** EP-INF-009d: "background" starts async operation, returns immediately with asyncOperationId. */
  interactionMode?: "sync" | "background";
  /** EP-INF-009d: Thread ID for SSE progress events (required for background mode). */
  threadId?: string;
  /** EP-INF-009d: Max duration for async operations (ms). Default: 15 minutes. */
  maxDurationMs?: number;
  /** Persist the route decision to the audit log. Default: true. */
  persistDecision?: boolean;
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Route and execute an LLM inference call through the V2 pipeline.
 *
 * This is the sole entry point for inference after EP-INF-009b.
 * It replaces `callWithFailover` by running:
 *   1. Contract inference (from task type + messages)
 *   2. Endpoint manifest loading
 *   3. V2 routing (capability filter, cost-per-success ranking, recipes)
 *   4. Fallback chain dispatch
 *
 * Throws `NoEligibleEndpointsError` if no endpoints qualify — no silent
 * degradation to a different routing mechanism.
 */
export async function routeAndCall(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity = "internal",
  options?: RouteAndCallOptions,
): Promise<RoutedInferenceResult> {
  const taskType = options?.taskType ?? "conversation";

  // 1. Infer contract
  const contract = await inferContract(
    taskType,
    messages,
    options?.tools,
    undefined, // outputSchema
    {
      sensitivity,
      interactionMode: options?.interactionMode,
      requiresCodeExecution: options?.requiresCodeExecution,
      requiresWebSearch: options?.requiresWebSearch,
      requiresComputerUse: options?.requiresComputerUse,
      budgetClass: options?.budgetClass,
      requiredModelClass: options?.requiredModelClass,
    },
  );

  // 2. Load routing data
  const [manifests, policies, overrides] = await Promise.all([
    loadEndpointManifests(),
    loadPolicyRules(),
    loadOverrides(taskType),
  ]);

  if (manifests.length === 0) {
    throw new NoEligibleEndpointsError(
      taskType,
      "No active endpoint manifests found. Configure at least one AI provider with a profiled model.",
      0,
    );
  }

  // 3. V2 routing
  let decision = await routeEndpointV2(manifests, contract, policies, overrides);
  let toolsStripped = false;

  // Graceful degradation: if all endpoints were excluded because they lack tool
  // support, retry without the tools requirement. The model can still converse —
  // it just won't have tool calling. This is critical for Ollama-only setups
  // where the coworker injects tools but the local model can't use them.
  if (!decision.selectedEndpoint && contract.requiresTools) {
    const allToolExclusions = decision.candidates.every(
      (c) => c.excluded && c.excludedReason?.includes("toolUse"),
    );
    if (allToolExclusions || decision.candidates.some(c => c.excludedReason?.includes("toolUse"))) {
      console.log(`[routing] Retrying without tools requirement for '${taskType}'`);
      const relaxedContract = { ...contract, requiresTools: false };
      decision = await routeEndpointV2(manifests, relaxedContract, policies, overrides);
      if (decision.selectedEndpoint) {
        toolsStripped = true;
      }
    }
  }

  if (!decision.selectedEndpoint) {
    throw new NoEligibleEndpointsError(
      taskType,
      decision.reason,
      decision.excludedCount,
    );
  }

  // 3a. When tools are stripped, REPLACE the system prompt entirely.
  // The original prompt lists tools by name ("create_backlog_item", etc.) and
  // describes authorities. Small local models can't handle "ignore the tools
  // listed below" — they latch onto the tool names and hallucinate calls.
  // A clean, simple prompt is the only reliable approach.
  if (toolsStripped) {
    systemPrompt = `You are a helpful assistant. Respond naturally to the user. Keep replies short.`;

    // Also strip chat history to just the current message — old messages from
    // capable-model conversations contain tool calls and context that confuse
    // local models. Semantic memory recall is in the system prompt (now replaced)
    // but old assistant messages in the history are equally toxic.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      messages = [lastUserMsg];
    }

    // Tools stripped — prompt replaced, history trimmed, no nudging
  }

  // 3b. If a preferred provider was requested, check if the decision matches.
  // If not, and the preferred provider is in the fallback chain, reorder so
  // it's tried first (soft preference, not a hard pin).
  if (options?.preferredProviderId && decision.selectedEndpoint !== options.preferredProviderId) {
    const preferredInChain = decision.fallbackChain.includes(options.preferredProviderId);
    if (preferredInChain) {
      // Move preferred to front of fallback chain
      decision.fallbackChain = [
        options.preferredProviderId,
        ...decision.fallbackChain.filter(id => id !== options.preferredProviderId),
      ];
      // Swap selectedEndpoint to the preferred
      const origSelected = decision.selectedEndpoint;
      const preferredCandidate = decision.candidates.find(
        c => c.endpointId === options.preferredProviderId && !c.excluded,
      );
      if (preferredCandidate) {
        decision.selectedEndpoint = options.preferredProviderId;
        decision.selectedModelId = preferredCandidate.modelId;
        // Keep original as first fallback
        if (!decision.fallbackChain.includes(origSelected!)) {
          decision.fallbackChain = [origSelected!, ...decision.fallbackChain];
        }
      }
    }
  }

  // 4. Persist route decision (fire-and-forget unless disabled)
  if (options?.persistDecision !== false) {
    persistRouteDecision(decision).catch((err) =>
      console.error("[routeAndCall] Failed to persist route decision:", err),
    );
  }

  // 5. Dispatch — background (async) or foreground (sync)
  if (options?.interactionMode === "background") {
    // EP-INF-009d: Start async operation, return immediately
    const result = await callWithFallbackChain(
      decision,
      messages,
      systemPrompt,
      toolsStripped ? undefined : options?.tools,
      decision.executionPlan,
    );

    // If the adapter returned an operation ID (async adapter), create tracking record
    const operationId = (result as any).raw?.operationId as string | undefined;
    if (operationId) {
      const { createAsyncOperation } = await import("@/lib/async-inference");
      const asyncOpId = await createAsyncOperation({
        providerId: result.providerId,
        modelId: result.modelId,
        operationId,
        contractFamily: contract.contractFamily,
        requestContext: { taskType, sensitivity, messages: messages.length },
        threadId: options?.threadId,
        maxDurationMs: options?.maxDurationMs,
      });

      return {
        providerId: result.providerId,
        modelId: result.modelId,
        content: "",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        downgraded: false,
        downgradeMessage: null,
        toolsStripped,
        routeDecision: decision,
        asyncOperationId: asyncOpId,
      };
    }

    // Adapter didn't return operation ID — treat as sync result
    return {
      providerId: result.providerId,
      modelId: result.modelId,
      content: result.content,
      toolCalls: result.toolCalls,
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      downgraded: result.downgraded,
      downgradeMessage: result.downgradeMessage,
      toolsStripped,
      routeDecision: decision,
    };
  }

  // 5b. Foreground: standard sync dispatch via fallback chain
  const result = await callWithFallbackChain(
    decision,
    messages,
    systemPrompt,
    toolsStripped ? undefined : options?.tools,
    decision.executionPlan,
  );

  // 6. Normalize result to RoutedInferenceResult
  return {
    providerId: result.providerId,
    modelId: result.modelId,
    content: result.content,
    toolCalls: result.toolCalls,
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    downgraded: result.downgraded,
    downgradeMessage: result.downgradeMessage,
    toolsStripped,
    routeDecision: decision,
  };
}
