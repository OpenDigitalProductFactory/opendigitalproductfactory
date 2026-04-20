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
  /** Responses API: the response ID for chaining subsequent calls. */
  responseId?: string;
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
    /** EP-AGENT-CAP-002: Which capability the agent required but no endpoint satisfied. */
    public readonly missingCapability?: string,
    /** EP-AGENT-CAP-002: The agent that triggered the error (for admin UI correlation). */
    public readonly agentId?: string,
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
  /** Prefer a specific provider (hard override when set by agent config). */
  preferredProviderId?: string;
  /** Prefer a specific model ID (swaps within provider candidates). */
  preferredModelId?: string;
  /** Specialized capability requirements. */
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
  /** Budget posture override. */
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  /** Minimum dimension scores (0-100) models must meet. Models below any threshold are excluded. */
  minimumDimensions?: Record<string, number>;
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
  /**
   * When true, tool stripping is forbidden. If no tool-capable endpoint is
   * available, throw NoEligibleEndpointsError instead of silently degrading
   * to generic no-tool chat. Use for Build Studio and other tool-dependent
   * workflows where removing tools changes the task semantics.
   */
  requireTools?: boolean;
  /**
   * EP-AGENT-CAP-002: Agent-level minimum capability floor.
   * When set, endpoints that don't satisfy all declared capabilities are
   * excluded BEFORE graceful tool-stripping. Use DEFAULT_MINIMUM_CAPABILITIES
   * ({ toolUse: true }) for standard coworkers.
   */
  minimumCapabilities?: import("@/lib/routing/agent-capability-types").AgentMinimumCapabilities;
  /**
   * EP-AGENT-CAP-002: Minimum context window tokens required by the agent (for RAG).
   * Merged with task-level minContextTokens — the stricter value wins.
   * Null = system default (16000 tokens). Read from AgentModelConfig.minimumContextTokens.
   */
  agentMinimumContextTokens?: number;
  /**
   * EP-AGENT-CAP-002: Agent identifier for error correlation.
   * Set from agentId in agentic-loop.ts so NoEligibleEndpointsError can surface
   * which agent triggered the capability floor violation.
   */
  agentId?: string;
  /**
   * EP-INF-013: Reasoning effort hint for the selected model.
   *   low    — no extended thinking; fast and cheap (default when omitted)
   *   medium — moderate thinking budget (~8k tokens for Anthropic)
   *   high   — extended thinking (~32k tokens; recommended for code-gen / Build Studio)
   *   max    — maximum budget (~64k tokens; Opus-only)
   * Translated per-provider: Anthropic → thinking.budget_tokens, OpenAI → reasoning_effort.
   * Ignored by providers that do not support extended reasoning.
   */
  effort?: "low" | "medium" | "high" | "max";
  /** Responses API: chain to a previous response for conversation state. */
  previousResponseId?: string;
  /**
   * Display name of the coworker invoking this call (e.g. "AI Ops Engineer").
   * When tools are stripped due to model capability limits, this name is
   * preserved in the degraded system prompt so the model can identify itself
   * and explain its limited state — rather than becoming a generic assistant.
   */
  agentDisplayName?: string;
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

  // Inject minimum dimension thresholds into contract
  if (options?.minimumDimensions) {
    contract.minimumDimensions = options.minimumDimensions;
  }

  // EP-AGENT-CAP-002: Inject agent capability floor into contract
  if (options?.minimumCapabilities !== undefined) {
    contract.minimumCapabilities = options.minimumCapabilities;
  }
  if (options?.agentMinimumContextTokens !== undefined) {
    // Use the stricter of task-level and agent-level context minimums
    const agentMin = options.agentMinimumContextTokens;
    if (contract.minContextTokens === undefined || agentMin > (contract.minContextTokens ?? 0)) {
      contract.minContextTokens = agentMin;
    }
  }

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

  // EP-INF-013: Inject effort into the execution plan so adapters can translate it
  // to provider-specific parameters (Anthropic thinking, OpenAI reasoning_effort).
  // Effort is injected here — after routing but before dispatch — so it flows
  // through callWithFallbackChain into every adapter in the fallback chain.
  if (options?.effort && decision.executionPlan) {
    decision.executionPlan = {
      ...decision.executionPlan,
      providerSettings: {
        ...decision.executionPlan.providerSettings,
        effort: options.effort,
      },
    };
  }

  // EP-AGENT-CAP-002: Agent capability floor — hard block, no graceful degradation.
  // Only throw if the routing evidence shows the capability floor was the ACTUAL cause
  // of failure. If endpoints were excluded for sensitivity, status, rate-limit, or
  // other reasons, fall through to the existing error/degradation path instead —
  // surfacing "no tool-capable endpoint" when tools aren't the problem is misleading.
  if (!decision.selectedEndpoint && options?.minimumCapabilities) {
    const floorExclusions = decision.candidates.filter(
      (c) => c.excluded && c.excludedReason?.includes("EP-AGENT-CAP-002"),
    );
    if (floorExclusions.length > 0) {
      // Identify which capability was the blocker from the first exclusion reason
      const missingCap = floorExclusions[0]?.excludedReason?.match(/capability '(\w+)'/)?.[1];
      throw new NoEligibleEndpointsError(
        taskType,
        `No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). ` +
        `Missing: ${missingCap ?? "unknown"}. ` +
        `Configure a capable provider at Platform > AI > Model Assignment.`,
        decision.excludedCount,
        missingCap,
        options?.agentId,
      );
    }
  }

  // Graceful degradation: if all endpoints were excluded because they lack tool
  // support, retry without the tools requirement. The model can still converse —
  // it just won't have tool calling. This is critical for Ollama-only setups
  // where the coworker injects tools but the local model can't use them.
  //
  // EXCEPTION: When requireTools is set (Build Studio, coding agents), tool
  // stripping destroys task semantics. Fail fast instead of silently degrading.
  if (!decision.selectedEndpoint && contract.requiresTools) {
    if (options?.requireTools) {
      throw new NoEligibleEndpointsError(
        taskType,
        `No tool-capable endpoint available. Build Studio requires tool support — ` +
        `cannot fall back to generic chat. Configure a tool-capable provider (OpenAI, Anthropic, Gemini) ` +
        `or check that existing providers are active.`,
        decision.excludedCount,
      );
    }
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
    const name = options?.agentDisplayName ?? "AI Assistant";
    const modelId = decision.selectedModelId ?? "";
    const providerIds = decision.candidates.map((c) => c.providerId);
    // Only the chatgpt subscription backend (chatgpt.com) lacks custom tool support.
    // The codex provider (api.openai.com/v1/responses) now supports custom tools.
    const isCodexBackend = providerIds.some((p) => p === "chatgpt");

    // Build the "how to fix" suggestion from actually-configured tool-capable
    // endpoints rather than hardcoded model names.
    const toolCapableEndpoints = manifests
      .filter((m) => m.supportsToolUse && m.status === "active")
      .map((m) => m.name)
      .slice(0, 3); // cap at 3 to keep the message concise
    const toolCapableSuggestion = toolCapableEndpoints.length > 0
      ? `Switch to one of your configured tool-capable models: ${toolCapableEndpoints.join(", ")}.`
      : `Configure a tool-capable provider (standard OpenAI API, Anthropic, or a local model with tool support) and assign it via Platform > AI > Model Assignment.`;

    const whyLimited = isCodexBackend
      ? `The active model (${modelId || "Codex"}) uses the ChatGPT/Codex backend, which only supports Codex's built-in tools — not the platform's custom function tools.`
      : `The active model (${modelId || "current model"}) does not support custom function calling.`;

    const howToFix = isCodexBackend
      ? `To enable tools, use a standard API-key-based provider instead of the ChatGPT subscription. ${toolCapableSuggestion}`
      : `Go to Platform > AI > Model Assignment and assign a tool-capable model. ${toolCapableSuggestion}`;

    systemPrompt = [
      `You are ${name}.`,
      whyLimited,
      `You are in limited mode: you can read and discuss, but cannot take actions or use any tools.`,
      `When the user asks you to do something that requires a tool, explain the above clearly and concisely.`,
      howToFix,
      `Keep replies concise. Do not repeat the explanation unless asked.`,
    ].join(" ");

    // Also strip chat history to just the current message — old messages from
    // capable-model conversations contain tool calls and context that confuse
    // local models. Semantic memory recall is in the system prompt (now replaced)
    // but old assistant messages in the history are equally toxic.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      messages = [lastUserMsg];
    }

    console.log(`[routing] Tools stripped for ${name} — using degraded identity prompt`);
  }

  // 3b. If a preferred provider was requested, force it as the selected endpoint.
  // This is a hard override — agents and admin-configured preferences always win
  // over cost-per-success ranking. The V2-selected endpoint becomes first fallback.
  if (options?.preferredProviderId && decision.selectedEndpoint !== options.preferredProviderId) {
    // Match by endpointId (CUID) OR providerId (slug like "gemini", "chatgpt")
    const preferredCandidate = decision.candidates.find(
      c => (c.endpointId === options.preferredProviderId || c.providerId === options.preferredProviderId) && !c.excluded,
    );
    const excludedForProvider = decision.candidates.filter(c => c.providerId === options.preferredProviderId && c.excluded);
    const allProviderIds = [...new Set(decision.candidates.filter(c => !c.excluded).map(c => c.providerId))];
    if (!preferredCandidate) {
      const excludeDetail = excludedForProvider.length > 0
        ? `(excluded: ${excludedForProvider.map(c => `${c.modelId}: ${c.excludedReason}`).slice(0, 3).join("; ")})`
        : "(no models from this provider in candidate pool — is it active?)";
      console.warn(
        `[routing] Pinned provider "${options.preferredProviderId}" not available ${excludeDetail}. ` +
        `Falling back to V2-selected: ${decision.selectedEndpoint}/${decision.selectedModelId}. ` +
        `Active providers: [${allProviderIds.join(", ")}]`,
      );
      // Annotate the decision so the caller can surface this to the user
      decision.reason = `WARNING: Pinned provider "${options.preferredProviderId}" not available ${excludeDetail}. ` +
        `Fell back to ${decision.selectedEndpoint}/${decision.selectedModelId}. ${decision.reason}`;
    }
    if (preferredCandidate) {
      const origSelected = decision.selectedEndpoint;
      decision.selectedEndpoint = preferredCandidate.endpointId;
      decision.selectedModelId = preferredCandidate.modelId;
      decision.reason = `Agent preference override: ${options.preferredProviderId} (was: ${origSelected}). ${decision.reason}`;
      // Keep original + existing chain as fallbacks, excluding the preferred provider's
      // endpoints so the chain has provider diversity (different providers as fallbacks).
      const preferredEndpointIds = new Set(
        decision.candidates
          .filter(c => c.providerId === options.preferredProviderId && !c.excluded)
          .map(c => c.endpointId),
      );
      decision.fallbackChain = [
        ...(origSelected ? [origSelected] : []),
        ...decision.fallbackChain.filter(id => !preferredEndpointIds.has(id) && id !== origSelected),
      ];
    }
  }

  // 3c. If a preferred model was requested, swap within the selected provider's candidates.
  if (options?.preferredModelId && decision.selectedModelId !== options.preferredModelId) {
    const modelCandidate = decision.candidates.find(
      c => c.modelId === options.preferredModelId && !c.excluded,
    );
    if (modelCandidate) {
      decision.selectedEndpoint = modelCandidate.endpointId;
      decision.selectedModelId = options.preferredModelId;
      decision.reason = `Model preference override: ${options.preferredModelId}. ${decision.reason}`;
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
      options?.previousResponseId,
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
    options?.previousResponseId,
  );

  // 5c. Local-fallback signal.
  //
  // The fallback chain sets downgraded=true when i>0 (we skipped the winner
  // due to failure). That covers the "preferred provider rate-limited, fell
  // to local" case. But when the pipeline's STAGE-5b tier sort lands on
  // bundled because all user_configured endpoints were already excluded
  // (status=unconfigured/disabled, hard-constraint violations, etc.), i=0
  // and downgraded stays false — so the user has no signal that the turn
  // ran on the local model. Patch that gap here so the observability is
  // correct regardless of whether we fell through at ranking or runtime.
  // `decision.selectedEndpoint` is a string id — look up the corresponding
  // manifest to read its tier. `manifests` is already in scope.
  const selectedManifest = decision.selectedEndpoint
    ? manifests.find((m) => m.id === decision.selectedEndpoint)
    : null;
  const selectedTier = selectedManifest?.providerTier;
  const hasUserConfiguredActive = manifests.some(
    (m) => m.providerTier === "user_configured" && (m.status === "active" || m.status === "degraded"),
  );
  const fellToLocal = selectedTier === "bundled" && hasUserConfiguredActive && !result.downgraded;
  const localFallbackBanner = fellToLocal
    ? `This turn ran on the bundled local model because configured paid providers were unavailable. Tool calls and complex reasoning may be unreliable on local — retry in a moment, or check provider status in Admin > AI.`
    : null;

  // 6. Normalize result to RoutedInferenceResult
  return {
    providerId: result.providerId,
    modelId: result.modelId,
    content: result.content,
    toolCalls: result.toolCalls,
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    downgraded: result.downgraded || fellToLocal,
    downgradeMessage: result.downgradeMessage ?? localFallbackBanner,
    toolsStripped,
    routeDecision: decision,
    responseId: result.responseId,
  };
}
