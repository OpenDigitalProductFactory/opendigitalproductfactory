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
import type {
  RouteDecision,
  EndpointManifest,
  PolicyRuleEval,
  EndpointOverride,
} from "@/lib/routing/types";
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { RequestContract } from "@/lib/routing/request-contract";
import {
  loadEndpointManifests,
  loadPolicyRules,
  loadOverrides,
  invalidateRoutingLoaderCache,
  persistRouteDecision,
  persistFailedRouteDecision,
} from "@/lib/routing/loader";
import { withProviderReconciliationRetry } from "@/lib/inference/provider-reconciliation";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  activityHarnessOverridesFromProposalRows,
} from "@/lib/routing/activity-harness-approval-source";
import { callWithFallbackChain } from "@/lib/routing/fallback";
import { prisma } from "@dpf/db";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import { resolveDispatchPosture, type DispatchPosture } from "@/lib/golden-triangle/dispatch";
import {
  buildEffectiveRequestContract,
  buildInitialRouteContext,
} from "@/lib/inference/route-contract-builder";
import { logTokenUsage } from "@/lib/ai-inference";
import type { RouteAndCallOptions } from "./routed-inference-options";
import { applyCallerExecutionPlanOverrides } from "./routed-inference-plan-overrides";
import {
  applyObservedRouterEvidence,
  attachProviderSuitabilityReceipt,
  prepareProviderSuitabilityRuntime,
  type ProviderSuitabilityRuntime,
} from "@/lib/routing/provider-suitability/runtime";
import type { ScreenInferencePayloadInput } from "@/lib/inference/data-screening/screen-inference-payload";
import {
  createRoutedInferenceScreen,
  rescreenRoutedInferencePayload,
  rescreenRoutedInferenceWithoutTools,
  routedRehydrationHandle,
} from "@/lib/inference/data-screening/routed-screening";
import { screenedLocalOnlyBlockReason } from "@/lib/inference/data-screening/blocked-route-explanation";
import { soleCapabilityFloorFailure } from "@/lib/inference/routing-exclusion-attribution";
import { createRoutingTraceId } from "@/lib/routing/routing-trace";
import { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/routing/routing-architecture-version";
import type { EndpointPreferences } from "@/lib/routing/preference-finalization";
import { describeLocalFallback, type DowngradeCause } from "./downgrade-explanation";
export type { RouteAndCallOptions } from "./routed-inference-options";
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
  /**
   * WHY this turn left the preferred route: "provider-unavailable" = a real
   * dispatch failed; "not-eligible" = ranking ruled every configured route out
   * before dispatch and nothing was down. Owner-facing copy MUST branch on this
   * rather than on `downgraded`, which conflated the two and let one reply
   * assert both at once. See ./downgrade-explanation.ts (BI-F4D3B9E9d).
   */
  downgradeReason: "provider-unavailable" | "not-eligible" | null;
  /** The constraint the banner named, so copy below it cannot contradict it (BI-FB184D69). */
  downgradeCause?: DowngradeCause | null;
  /** True when tools were stripped due to capability degradation (local model). */
  toolsStripped: boolean;
  /**
   * True when the provider stopped generation at the output-token ceiling
   * (Anthropic max_tokens / OpenAI length / Gemini MAX_TOKENS / Responses
   * incomplete). The agentic loop continues generation on a truncated turn
   * rather than returning the partial as a final answer (BI-1D144CC1).
   */
  truncated?: boolean;
  /** Responses API: the response ID for chaining subsequent calls. */
  responseId?: string;
  /** The V2 route decision that selected this endpoint (for audit/metadata). */
  routeDecision: RouteDecision;
  /** EP-INF-009d: Set when interactionMode is "background". Poll via pollAsyncOperation(). */
  asyncOperationId?: string;
  /** Opaque handle for the later actor/surface-authorized rehydration gate. */
  rehydrationHandle?: string;
  /** Resolved endpoint's context window (tokens) when known; null for local /
   *  unknown. The agentic loop learns this from the first dispatch to size
   *  compaction + the context-pressure gauge to the real window (BI-9679EB1A). */
  resolvedMaxContextTokens?: number | null;
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

// ─── Route preparation (shared by routeAndCall + previewRoute) ───────────────

interface PreparedRoute {
  contract: RequestContract;
  decision: RouteDecision;
  manifests: EndpointManifest[];
  policies: PolicyRuleEval[];
  overrides: EndpointOverride[];
  taskType: string;
  /** Ephemeral, non-persisted input used to re-screen the actual dispatch payload. */
  screenInput: ScreenInferencePayloadInput;
  rehydrationHandle?: string;
  /** EP-GOLDEN-TRIANGLE: the resolved posture applied to this route (null = none/Balanced). */
  posture: DispatchPosture | null;
  suitability: ProviderSuitabilityRuntime | null;
}

function endpointPreferencesFromOptions(
  options: RouteAndCallOptions | undefined,
): EndpointPreferences {
  return {
    ...(options?.preferredProviderId
      ? { preferredProviderId: options.preferredProviderId }
      : {}),
    ...(options?.preferredModelId
      ? { preferredModelId: options.preferredModelId }
      : {}),
  };
}

/**
 * The routing half of routeAndCall: contract inference → routing-data load →
 * V2 endpoint selection. Produces the RouteDecision WITHOUT dispatching. Both
 * the live path (routeAndCall) and the side-effect-free preview (previewRoute)
 * go through here, so a prediction can never drift from what actually runs.
 *
 * `skipRecipe` (preview) makes routeEndpointV2 deterministic and skips the
 * challenger Math.random() roll; the live path leaves it false so the
 * executionPlan is built for dispatch.
 */
async function prepareRoute(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity,
  options: RouteAndCallOptions | undefined,
  prep?: { skipRecipe?: boolean },
): Promise<PreparedRoute> {
  const taskType = options?.taskType ?? "conversation";

  // Local-only inference (cloud disabled): the operator-set platform switch.
  // When ON, force residencyPolicy=local_only for EVERY call so routing never
  // selects a cloud endpoint — it routes local or fails loudly below. This is
  // authoritative over a task requirement's residency, and the guarantee the
  // "disable cloud" admin toggle promises (no silent per-phase cloud fallback).
  // Computed in prepareRoute so the per-phase preview (previewRoute) reflects it too.
  const localOnlyInference = await getLocalOnlyInference();

  // EP-GOLDEN-TRIANGLE Slice 3: resolve the saved Cost/Quality/Time posture and
  // feed it into routing as DEFAULTS (caller options + the local-only sovereignty
  // switch below still win). Fail-open + Balanced-inert: null when no non-Balanced
  // default is set, so this is byte-identical to flag-off until a posture is chosen.
  // The calling coworker's own posture (if any) layers above org/platform, so a
  // per-coworker priority actually tunes that coworker's runs. Single-org install
  // → null org id; non-coworker runs pass null agentId (platform default).
  const posture = await resolveDispatchPosture(options?.agentId ?? null, taskType);
  const initialRouteContext = buildInitialRouteContext({
    sensitivity,
    options,
    posture,
    localOnlyInference,
  });
  const { screenInput, screen, rehydrationHandle } = createRoutedInferenceScreen({
    messages,
    systemPrompt,
    systemPromptInstructionSpans: options?.systemPromptInstructionSpans,
    tools: options?.tools,
    taskType,
    routeContext: initialRouteContext,
    activityContract: options?.activityContract,
    policyVersionSource: options?.inferencePolicyVersionSource,
    sensitiveDetailUse: options?.sensitiveDetailUse,
    responseRehydration: options?.responseRehydration,
  });

  // 1. Infer contract
  let contract = await buildEffectiveRequestContract({
    taskType,
    messages: screenInput.messages,
    tools: screenInput.tools,
    options,
    routeContext: {
      ...initialRouteContext,
      sensitivity: screen.routeContext.sensitivity,
      // EP-GOLDEN-TRIANGLE reconciliation: the posture (the everyday Cost/Quality
      // lever) OWNS budgetClass. AgentModelConfig.budgetClass (which defaults to
      // "balanced" and is always sent) applies only as the fallback when no
      // non-Balanced posture is set — so dragging the triangle toward Cost or
      // Quality is never silently overridden by the Assignments default. (Tier is
      // already reconciled: AgentModelConfig.minimumTier acts as a floor via the
      // per-dimension max-merge in inferContract, which the posture can raise but
      // not drop below. See docs/design/2026-06-25-coworker-work-orchestration.md.)
      allowedProviders: screen.routeContext.allowedProviders,
      deniedProviders: screen.routeContext.deniedProviders,
      residencyPolicy: screen.routeContext.residencyPolicy,
      // EP-MODEL-TIER-ROUTING: a "local"-tier call forces local_only (keep
      // small/simple work on-box) even when the global switch is off; "robust"
      // leaves routing free to prefer a frontier endpoint. The global local-only
      // switch still wins for every call (the sovereign master toggle).
    },
  });

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

  let suitability: PreparedRoute["suitability"] = null;
  if (options?.activityContract) {
    const preparedSuitability = await prepareProviderSuitabilityRuntime({
      contract,
      activity: options.activityContract,
      goldenTrianglePosture: posture?.routeContext,
    });
    contract = preparedSuitability.contract;
    suitability = preparedSuitability.suitability;
  }

  const activityHarnessConfidenceOverrides =
    options?.activityContract && !prep?.skipRecipe
      ? activityHarnessOverridesFromProposalRows(
          await prisma.agentActionProposal.findMany({
            where: {
              actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
              status: { in: ["approve", "approved", "executed"] },
            },
            orderBy: { decidedAt: "desc" },
            take: 40,
            select: {
              proposalId: true,
              actionType: true,
              parameters: true,
              status: true,
              decidedById: true,
              decidedAt: true,
            },
          }),
        )
      : [];

  const decision = await routeEndpointV2(manifests, contract, policies, overrides, {
    skipRecipe: prep?.skipRecipe,
    activityContract: options?.activityContract,
    activityHarnessConfidenceOverrides,
    preferences: endpointPreferencesFromOptions(options),
  });
  decision.inferenceDataScreenReceipt = screen.receipt;
  if (!decision.policyRulesApplied.includes("inference-dispatch")) {
    decision.policyRulesApplied = [...decision.policyRulesApplied, "inference-dispatch"];
  }

  return {
    contract,
    decision,
    manifests,
    policies,
    overrides,
    taskType,
    screenInput,
    rehydrationHandle,
    posture,
    suitability,
  };
}

/** Result of a side-effect-free routing dry-run. */
export interface RoutePreview {
  /** The endpoint the live router would select first (selectedEndpoint=null → none eligible). */
  decision: RouteDecision;
  /** Full manifest of the selected endpoint, for provider-tier / context inspection. */
  selectedManifest: EndpointManifest | null;
  /** The inferred request contract (taskType, sensitivity, budgetClass, …). */
  contract: RequestContract;
}

/**
 * Side-effect-free dry-run of V2 routing: resolves the endpoint that WOULD be
 * selected for a given task contract, without dispatching, persisting a route
 * decision, rolling the challenger arm, or building an executionPlan.
 *
 * This is the primitive the Model Selection & Runtime Health resolver uses to
 * predict, per build phase, which provider/model the live routeAndCall path
 * will pick — answering "local or cloud, per phase?" BEFORE a run rather than
 * discovering it after the GPU has sat idle. It mirrors routeAndCall's routing
 * inputs (taskType, sensitivity, budgetClass, tools→requiresTools) so the
 * predicted winner matches the live one.
 *
 * Throws NoEligibleEndpointsError when no providers are configured at all —
 * callers should catch and surface that as a configuration gap.
 */
export async function previewRoute(
  messages: ChatMessage[],
  sensitivity: RouteSensitivity = "internal",
  options?: RouteAndCallOptions,
): Promise<RoutePreview> {
  const { contract, decision, manifests } = await prepareRoute(
    messages,
    options?.screeningSystemPrompt ?? "",
    sensitivity,
    options,
    { skipRecipe: true },
  );
  const selectedManifest = decision.selectedEndpoint
    ? manifests.find((m) => m.id === decision.selectedEndpoint) ?? null
    : null;
  return { decision, selectedManifest, contract };
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Route and execute an LLM inference call through the V2 pipeline.
 *
 * This is the sole inference entry point after EP-INF-009b: contract,
 * manifests, V2 routing, then fallback dispatch.
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
  return withProviderReconciliationRetry(
    () => routeAndCallAttempt(messages, systemPrompt, sensitivity, options),
    invalidateRoutingLoaderCache,
  );
}

async function routeAndCallAttempt(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity,
  options: RouteAndCallOptions | undefined,
): Promise<RoutedInferenceResult> {
  // 1-3. Contract inference, routing-data load, and V2 endpoint selection —
  // shared with previewRoute() via prepareRoute() so a model-selection
  // prediction can never drift from what this live path actually picks. The
  // live path keeps recipe selection (skipRecipe defaults false) so the
  // executionPlan is built for dispatch below.
  const prepared = await prepareRoute(messages, systemPrompt, sensitivity, options);
  const { contract, manifests, policies, overrides, taskType } = prepared;
  messages = prepared.screenInput.messages;
  systemPrompt = prepared.screenInput.systemPrompt;
  let decision = prepared.decision;
  let dispatchScreenInput = prepared.screenInput;
  const traceId = createRoutingTraceId();
  let toolsStripped = false;

  // EP-INF-013: Inject effort into the execution plan so adapters can translate it
  // to provider-specific parameters (Anthropic thinking, OpenAI reasoning_effort).
  // Effort is injected here — after routing but before dispatch — so it flows
  // through callWithFallbackChain into every adapter in the fallback chain.
  // Caller-set effort wins; otherwise the resolved posture's effort applies
  // (EP-GOLDEN-TRIANGLE Slice 3). Balanced/no posture leaves effort untouched.
  if (decision.executionPlan) {
    decision.executionPlan = applyCallerExecutionPlanOverrides(decision.executionPlan, {
      effort: options?.effort ?? prepared.posture?.effort,
      toolChoice: options?.toolChoice,
      terminalWriterToolName: options?.terminalWriterToolName,
    });
  }

  // BI-F4D3B9E9(c): persist the failed route decision BEFORE throwing so the
  // excludedTrace survives for diagnosis (see persistFailedRouteDecision).
  const persistFailedDecision = () => persistFailedRouteDecision(decision, options);

  // EP-AGENT-CAP-002: Agent capability floor — hard block, no graceful degradation.
  // Only throw if the routing evidence shows the capability floor was the ACTUAL cause
  // of failure. If endpoints were excluded for sensitivity, status, rate-limit, or
  // other reasons, fall through to the existing error/degradation path instead —
  // surfacing "no tool-capable endpoint" when tools aren't the problem is misleading.
  if (!decision.selectedEndpoint && options?.minimumCapabilities) {
    const floorFailure = soleCapabilityFloorFailure(decision.candidates);
    if (floorFailure) {
      const missingCap = floorFailure.missingCapability;
      persistFailedDecision();
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
      const fix = contract.residencyPolicy === "local_only"
        ? `Local-only inference is ON (cloud disabled), so routing will not fall back to a cloud provider. ` +
          `Enable a tool-capable LOCAL model (or run the build through the opencode engine, which supplies the tool loop), ` +
          `or turn off local-only inference in Admin > AI > Providers & Routing.`
        : `Configure a tool-capable provider (OpenAI, Anthropic, Gemini) or check that existing providers are active.`;
      persistFailedDecision();
      throw new NoEligibleEndpointsError(
        taskType,
        `No tool-capable endpoint available. Build Studio requires tool support — cannot fall back to generic chat. ${fix}`,
        decision.excludedCount,
      );
    }
    const allToolExclusions = decision.candidates.every(
      (c) => c.excluded && c.excludedReason?.includes("toolUse"),
    );
    if (allToolExclusions || decision.candidates.some(c => c.excludedReason?.includes("toolUse"))) {
      console.log(`[routing] Retrying without tools requirement for '${taskType}'`);
      const relaxedContract = { ...contract, requiresTools: false };
      decision = await routeEndpointV2(
        manifests,
        relaxedContract,
        policies,
        overrides,
        { preferences: endpointPreferencesFromOptions(options) },
      );
      const strippedScreen = rescreenRoutedInferenceWithoutTools(prepared.screenInput);
      dispatchScreenInput = strippedScreen.screenInput;
      decision.inferenceDataScreenReceipt = strippedScreen.receipt;
      if (!decision.policyRulesApplied.includes("inference-dispatch")) {
        decision.policyRulesApplied = [...decision.policyRulesApplied, "inference-dispatch"];
      }
      if (decision.selectedEndpoint) {
        toolsStripped = true;
      }
    }
  }

  if (!decision.selectedEndpoint) {
    persistFailedDecision();
    const contextDetail = decision.excludedReasons
      .filter((reason) => /context window too small/i.test(reason))
      .join("; ");
    const decisionReason = contextDetail
      ? `${decision.reason} ${contextDetail}`
      : decision.reason;
    // Local-only inference: fail LOUDLY and specifically rather than letting the
    // generic "no eligible endpoints" mask the real cause (cloud is disabled and
    // no local model qualified for this task's tier/capability/context).
    if (contract.residencyPolicy === "local_only") {
      const screenedBlockReason = screenedLocalOnlyBlockReason(decision, taskType);
      throw new NoEligibleEndpointsError(
        taskType,
        screenedBlockReason ??
          `No eligible LOCAL model for task '${taskType}' (sensitivity '${sensitivity}'). ` +
          `Local-only inference is ON, so cloud providers are excluded and routing will NOT silently fall back to cloud. ` +
          `Pull or enable a local model that meets this task's requirements (tool support, context window, quality tier), ` +
          `raise the model's context window in Build Runtime, or turn off local-only inference in Admin > AI > Providers & Routing. ` +
          `Router detail: ${decisionReason}`,
        decision.excludedCount,
      );
    }
    throw new NoEligibleEndpointsError(
      taskType,
      decisionReason,
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
      // `=== true` deliberately: this list is a user-facing "switch to one of
      // these" suggestion, so only KNOWN tool-capable endpoints belong in it —
      // an unknown (null) endpoint is routable but must not be recommended.
      .filter((m) => m.supportsToolUse === true && m.status === "active")
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

    const degradedScreen = rescreenRoutedInferencePayload(dispatchScreenInput, {
      messages,
      systemPrompt,
      tools: undefined,
    });
    dispatchScreenInput = degradedScreen.screenInput;
    decision.inferenceDataScreenReceipt = degradedScreen.receipt;

    console.log(`[routing] Tools stripped for ${name} — using degraded identity prompt`);
  }

  if (prepared.suitability) {
    attachProviderSuitabilityReceipt(decision, manifests, prepared.suitability);
  }
  decision.traceId = traceId;
  decision.designRevision = AI_ROUTING_ARCHITECTURE_VERSION;

  // 4. Persist route decision (fire-and-forget unless disabled)
  let routeDecisionLogId: Promise<string | null> = Promise.resolve(null);
  if (options?.persistDecision !== false) {
    routeDecisionLogId = persistRouteDecision(decision, {
      actor: options?.routingActor ?? (options?.agentId ? { kind: "agent", id: options.agentId } : { kind: "system", id: "routed-inference" }),
      agentMessageId: options?.agentMessageId ?? null,
      routeContext: options?.routeContext ?? null,
    }).catch((err) => {
      console.error("[routeAndCall] Failed to persist route decision:", err);
      return null;
    });
  }

  // 5. Dispatch — background (async) or foreground (sync)
  if (options?.interactionMode === "background") {
    // EP-INF-009d: Start async operation, return immediately
    const result = await callWithFallbackChain(
      decision,
      messages,
      systemPrompt,
      toolsStripped ? undefined : dispatchScreenInput.tools,
      decision.executionPlan,
      options?.previousResponseId,
      options?.mcpSession,
      { traceId, agentId: options?.agentId ?? null, agentMessageId: options?.agentMessageId ?? null, buildId: options?.buildId ?? null },
      dispatchScreenInput,
    );
    applyObservedRouterEvidence(decision, result.routingEvidence, routeDecisionLogId);

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
        downgradeReason: null,
        toolsStripped,
        routeDecision: decision,
        asyncOperationId: asyncOpId,
        ...routedRehydrationHandle(prepared.rehydrationHandle),
      };
    }

    // Every adapter dispatch persists TokenUsage (BI-28858D2F).
    void persistRoutedTokenUsage({
      traceId,
      agentId: options?.agentId ?? "unknown",
      providerId: result.providerId,
      contextKey: options?.threadId ?? options?.taskType ?? "routed-call",
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      inferenceMs: result.inferenceMs,
    });

    return {
      providerId: result.providerId,
      modelId: result.modelId,
      content: result.content,
      toolCalls: result.toolCalls,
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      downgraded: result.downgraded,
      downgradeMessage: result.downgradeMessage,
      // Background path: only a real dispatch failure downgrades here.
      downgradeReason: result.downgraded ? "provider-unavailable" : null,
      toolsStripped,
      truncated: result.truncated ?? false,
      routeDecision: decision,
      ...routedRehydrationHandle(prepared.rehydrationHandle),
    };
  }

  // 5b. Foreground: standard sync dispatch via fallback chain
  const result = await callWithFallbackChain(
    decision,
    messages,
    systemPrompt,
    toolsStripped ? undefined : dispatchScreenInput.tools,
    decision.executionPlan,
    options?.previousResponseId,
    options?.mcpSession,
    { traceId, agentId: options?.agentId ?? null, agentMessageId: options?.agentMessageId ?? null, buildId: options?.buildId ?? null },
    dispatchScreenInput,
  );
  applyObservedRouterEvidence(decision, result.routingEvidence, routeDecisionLogId);

  // 5c. Local-fallback signal.
  //
  // Runtime fallback marks i>0 as downgraded. Ranking can select bundled at
  // i=0 after excluding configured endpoints, so detect that case here.
  const selectedManifest = decision.selectedEndpoint
    ? manifests.find((m) => m.id === decision.selectedEndpoint)
    : null;
  const selectedTier = selectedManifest?.providerTier;
  const hasUserConfiguredActive = manifests.some(
    (m) => m.providerTier === "user_configured" && (m.status === "active" || m.status === "degraded"),
  );
  const fellToLocal = selectedTier === "bundled" && hasUserConfiguredActive && !result.downgraded;
  // fellToLocal requires an ACTIVE paid provider (no outage) — it was merely ineligible for this request, not unavailable (BI-9DFAFB4A).
  //
  // BI-F4D3B9E9(d): the banner used to GUESS the cause and to assert the provider
  // "is active" — wrong whenever a stronger provider is disabled and a weaker one
  // is not. Both facts are already in scope, so ./downgrade-explanation.ts reads
  // them instead of guessing.
  const localFallback = fellToLocal
    ? describeLocalFallback({
      manifests,
      candidates: decision.candidates,
      sensitivity: decision.sensitivity,
      matchProvenance: decision.inferenceDataScreenReceipt?.matchProvenance,
      messageCount: messages.length,
    })
    : null;
  const localFallbackBanner = localFallback?.banner ?? null;

  // 6. Persist TokenUsage row for the cost ledger (Phase J).
  // Fire-and-forget because metering must not block the response. A loud log
  // on failure is the floor; the bus-check enforcement detector (separate
  // follow-up) is the durable guarantee that drift surfaces.
  void persistRoutedTokenUsage({
    traceId,
    agentId: options?.agentId ?? "unknown",
    providerId: result.providerId,
    contextKey: options?.threadId ?? options?.taskType ?? "routed-call",
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    inferenceMs: result.inferenceMs,
  });

  // 7. Normalize result to RoutedInferenceResult
  return {
    providerId: result.providerId,
    modelId: result.modelId,
    content: result.content,
    toolCalls: result.toolCalls,
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    downgraded: result.downgraded || fellToLocal,
    downgradeMessage: result.downgradeMessage ?? localFallbackBanner,
    // Opposite causes; never both for one turn (BI-F4D3B9E9d).
    downgradeReason: result.downgraded
      ? "provider-unavailable"
      : fellToLocal
        ? "not-eligible"
        : null,
    downgradeCause: localFallback?.cause ?? null,
    toolsStripped,
    truncated: result.truncated ?? false,
    routeDecision: decision,
    responseId: result.responseId,
    resolvedMaxContextTokens: selectedManifest?.maxContextTokens ?? null,
    ...routedRehydrationHandle(prepared.rehydrationHandle),
  };
}

// ─── Phase J: routed-call token usage persistence ──────────────────────────
//
// Every routed inference call must produce a `TokenUsage` row regardless of
// which adapter served it. Before this fix, only the direct HTTP path
// (`callProvider` in `ai-inference.ts`) wrote metering — the CLI subprocess
// adapters (claude-cli, codex-cli) silently bypassed it. The result was a
// $0 cost tally for ~100% of subscription-served traffic on a typical install.
//
// This wrapper is the *convenience* enforcement; the durable enforcement is
// the OutcomeEvent-bus detector "outcome event without metering row" listed
// in the routing-architecture spec §10.2. That bus check makes new dispatch
// paths (future adapters) loud about forgetting to meter; this wrapper makes
// it easy to satisfy by default.
//
// Errors are logged but never thrown — metering must never block the response.
async function persistRoutedTokenUsage(input: {
  traceId?: string | null;
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  // BI-105E8A1E: carry the adapter's measured latency so logTokenUsage's
  // `compute` cost model can fire — it is the cost signal for a fully-local
  // install, and was previously dropped here, leaving inferenceMs ~99% empty.
  inferenceMs?: number;
}): Promise<void> {
  // Skip rows with zero tokens both ways. A successful call always reports at
  // least the input prompt tokens; zero/zero usually means the adapter
  // returned an error or stub. The audit row would be misleading.
  if (input.inputTokens === 0 && input.outputTokens === 0) {
    return;
  }
  try {
    await logTokenUsage(input);
  } catch (err) {
    console.error(
      `[routed-inference] token usage persistence failed: provider=${input.providerId} ` +
      `agent=${input.agentId} in=${input.inputTokens} out=${input.outputTokens}`,
      err,
    );
  }
}
