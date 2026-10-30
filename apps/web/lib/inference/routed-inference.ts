/**
 * EP-INF-009b: Unified V2 routing + inference dispatch.
 *
 * `routeAndCall()` replaces `callWithFailover()` as the single entry point
 * for all LLM inference. It wraps: contract inference → V2 routing →
 * fallback chain dispatch, providing a simple interface for callers while
 * ensuring every call goes through capability filtering, execution recipes,
 * champion/challenger, rate tracking, and outcome telemetry.
 */

import { resolveLocalRoutingRuntime } from "@/lib/inference/local-model-context-reconcile";
import { currentInferenceSignal } from "./inference-admission";
import { transferLocalNativeContinuation } from "@/lib/routing/local-native-continuation";
import type { ChatMessage, ToolCallEntry } from "@/lib/routing/chat-message-types";
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
import { NoEligibleEndpointsError } from "@/lib/routing/inference-error";
export { NoEligibleEndpointsError } from "@/lib/routing/inference-error";
import { routingEligibilitySummary } from "./routing-exclusion-buckets";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import {
  loadApprovedActivityHarnessOverrides,
} from "@/lib/routing/activity-harness-approval-source";
import { callWithFallbackChain } from "@/lib/routing/fallback";
import { bindProviderAccountSuitability } from "@/lib/routing/provider-account-candidates";
import { accountAffinityKey } from "@/lib/routing/provider-account-allocation";
import { conservativeQuotaScope } from "@/lib/routing/provider-capacity/scopes";
import { prisma } from "@dpf/db";
import { getLocalOnlyInference, getLocalOnlyInferenceFresh } from "@/lib/inference/local-only";
import { resolveDispatchPosture, type DispatchPosture } from "@/lib/golden-triangle/dispatch";
import {
  buildEffectiveRequestContract,
  buildInitialRouteContext,
} from "@/lib/inference/route-contract-builder";
import { assertDurableExecutionConstraint } from "./durable-execution-constraint";
import { persistAcceptedRoutedTokenUsage, persistRoutedTokenUsage, routedContextKey } from "./routed-token-usage";
import type { RouteAndCallOptions } from "./routed-inference-options";
import { applyCallerExecutionPlanOverrides } from "./routed-inference-plan-overrides";
import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";
import { currentReassessmentExecution, currentFiniteReassessmentExecution, assertReassessmentPlan, ReassessmentExecutionError } from "@/lib/routing/reassessment-execution-scope";
import { spendAwareBudgetClass, type BudgetClass } from "./spend-aware-routing";
import { assertReassessmentNativeScreenUnchanged, reassessmentNativePlansEqual, type ReassessmentNativeRoutingFacts } from "./reassessment-native-runtime";
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
import {
  admitRoutedAsyncOperation,
  routeUsesDurableAsyncAdapter,
} from "./async-operation-routed-admission";
export type { RouteAndCallOptions } from "./routed-inference-options";
// ─── Result type ────────────────────────────────────────────────────────────
/** Unified inference result — flat token fields, V2 metadata included. */
export interface RoutedInferenceResult {
  providerId: string;
  providerConnectionId?: string;
  quotaScopeKey?: string;
  modelId: string;
  content: string;
  toolCalls: ToolCallEntry[];
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


// ─── Options ────────────────────────────────────────────────────────────────

// ─── Route preparation (shared by routeAndCall + previewRoute) ───────────────

interface PreparedRoute {
  contract: RequestContract;
  requestedBudgetClass?: BudgetClass;
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
    ...(options?.preferredModelFamily
      ? { preferredModelFamily: options.preferredModelFamily }
      : {}),
  };
}

async function prepareRoute(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity,
  options: RouteAndCallOptions | undefined,
  prep?: { skipRecipe?: boolean; reassessment?: boolean; nativeRuntime?: ReassessmentNativeRoutingFacts },
): Promise<PreparedRoute> {
  const taskType = options?.taskType ?? "conversation";

  // Local-only inference (cloud disabled): the operator-set platform switch.
  // When ON, force residencyPolicy=local_only for EVERY call so routing never
  // selects a cloud endpoint — it routes local or fails loudly below. This is
  // authoritative over a task requirement's residency, and the guarantee the
  // "disable cloud" admin toggle promises (no silent per-phase cloud fallback).
  // Computed in prepareRoute so the per-phase preview (previewRoute) reflects it too.
  const localOnlyInference = await (prep?.reassessment ? getLocalOnlyInferenceFresh() : getLocalOnlyInference());

  // Durable exact plans outrank ambient saved posture.
  const posture = options?.durableAsyncOperation?.expectedExecution
    ? null
    : await resolveDispatchPosture(options?.agentId ?? null, taskType, null, undefined, {
        workroomPriority: options?.workroomPriority ?? null,
      });
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
    messageOrigins: options?.messageOrigins,
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

  const requestedBudgetClass = contract.budgetClass;
  if (prep?.nativeRuntime) contract = { ...contract, budgetClass: spendAwareBudgetClass(contract.budgetClass, prep.nativeRuntime.budgetStatus) };
  const [loadedManifests, policies, overrides] = await Promise.all([
    prep?.nativeRuntime ? loadEndpointManifests(Date.now(), prep.nativeRuntime.reader) : prep?.reassessment ? loadEndpointManifests(Date.now()) : loadEndpointManifests(Date.now(), resolveLocalRoutingRuntime),
    loadPolicyRules(),
    loadOverrides(taskType),
  ]);

  if (loadedManifests.length === 0) {
    throw new NoEligibleEndpointsError(
      taskType,
      "No active endpoint manifests found. Configure at least one AI provider with a profiled model.",
      0,
      undefined, options?.agentId, routingEligibilitySummary(contract.sensitivity, contract.residencyPolicy, 0, []),
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
    if (prep?.reassessment && !suitability) throw new ReassessmentExecutionError("reassessment-suitability-unproven");
  }
  if (prep?.reassessment) {
    const allowed = [...new Set(loadedManifests.filter(endpoint => endpoint.providerConnectionId
      && endpoint.providerConnectionVersion && (endpoint.executionChannel === "direct-api" && ["api_key", "none"].includes(endpoint.accountAuthMethod ?? "")
        || prep.nativeRuntime && endpoint.providerId === "local" && endpoint.executionChannel === "local-runtime" && endpoint.accountAuthMethod === "none"))
      .map(endpoint => endpoint.providerConnectionId!))];
    if (allowed.length === 0) throw new ReassessmentExecutionError("reassessment-composition-unavailable");
    contract.allowedProviderConnectionIds = allowed.filter(id => contract.allowedProviderConnectionIds === undefined
      || contract.allowedProviderConnectionIds.includes(id));
  }
  const manifests = suitability?.mode === "enforced"
    ? bindProviderAccountSuitability(loadedManifests, contract.sensitivity, suitability.policy.allowedProviderConnectionIds)
    : loadedManifests;

  const activityHarnessConfidenceOverrides =
    options?.activityContract && !prep?.skipRecipe
      // Facts and legacy approved proposals (dual read, BI-C8EC05C9).
      ? await loadApprovedActivityHarnessOverrides(prisma, { take: 40 })
      : [];

  const decision = await routeEndpointV2(manifests, contract, policies, overrides, {
    skipRecipe: prep?.skipRecipe,
    activityContract: options?.activityContract,
    activityHarnessConfidenceOverrides,
    preferences: endpointPreferencesFromOptions(options),
    accountAffinityKey: accountAffinityKey(options?.agentId, options?.threadId),
  });
  decision.inferenceDataScreenReceipt = screen.receipt;
  if (!decision.policyRulesApplied.includes("inference-dispatch")) {
    decision.policyRulesApplied = [...decision.policyRulesApplied, "inference-dispatch"];
  }

  return {
    contract,
    requestedBudgetClass,
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

/** Normal V2 ranking constrained before selection to existing restricted HTTP accounts. */
export async function prepareReassessmentRoute(messages: ChatMessage[], systemPrompt: string,
  sensitivity: RouteSensitivity, options?: RouteAndCallOptions, nativeRuntime?: ReassessmentNativeRoutingFacts): Promise<RoutePreview & { executionPlan: RoutedExecutionPlan; requestedBudgetClass?: BudgetClass }> {
  if (options?.interactionMode && options.interactionMode !== "sync" || options?.durableAsyncOperation
    || options?.requiresCodeExecution || options?.requiresWebSearch || options?.requiresComputerUse) {
    throw new ReassessmentExecutionError("reassessment-composition-unsupported");
  }
  const prepared = await prepareRoute(messages, systemPrompt, sensitivity, options, { reassessment: true, nativeRuntime });
  const { contract, decision, manifests } = prepared;
  const selectedManifest = manifests.find(endpoint => endpoint.id === decision.selectedEndpoint) ?? null;
  if (!selectedManifest || !decision.executionPlan) throw new ReassessmentExecutionError("reassessment-composition-unavailable");
  const executionPlan = applyCallerExecutionPlanOverrides(decision.executionPlan, {
    maxOutputTokens: options?.activityContract?.tokenEnvelope.maxOutputTokens,
    effort: options?.effort ?? prepared.posture?.effort, toolChoice: options?.toolChoice,
    terminalWriterToolName: options?.terminalWriterToolName,
  });
  return { contract, decision, selectedManifest, executionPlan, requestedBudgetClass: prepared.requestedBudgetClass };
}

/** Source-only candidate facts; the reader explicitly preserves UNKNOWN. */
export const prepareReassessmentNativeStaticRoute = (messages: ChatMessage[], systemPrompt: string, sensitivity: RouteSensitivity,
  options: RouteAndCallOptions, nativeRuntime: ReassessmentNativeRoutingFacts) =>
  prepareRoute(messages, systemPrompt, sensitivity, options, { reassessment: true, nativeRuntime });

/** Result of a side-effect-free routing dry-run. */
export interface RoutePreview {
  /** The endpoint the live router would select first (selectedEndpoint=null → none eligible). */
  decision: RouteDecision;
  /** Full manifest of the selected endpoint, for provider-tier / context inspection. */
  selectedManifest: EndpointManifest | null;
  /** The inferred request contract (taskType, sensitivity, budgetClass, …). */
  contract: RequestContract;
}

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

export async function routeAndCall(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity = "internal",
  options?: RouteAndCallOptions,
): Promise<RoutedInferenceResult> {
  if (currentReassessmentExecution()) return routeAndCallAttempt(messages, systemPrompt, sensitivity, options, () => {});
  let reconciled = false;
  let dispatchStarted = false;
  try {
    return await withProviderReconciliationRetry(
      () => routeAndCallAttempt(messages, systemPrompt, sensitivity, options, () => { dispatchStarted = true; }),
      () => { reconciled = true; invalidateRoutingLoaderCache(); },
    );
  } catch (error) {
    // A preceding reconciliation attempt may already have called a provider.
    if (error instanceof NoEligibleEndpointsError) error.providerDispatch = !reconciled && !dispatchStarted ? "not-started" : "unknown";
    throw error;
  }
}

async function routeAndCallAttempt(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity,
  options: RouteAndCallOptions | undefined,
  onDispatch: () => void,
): Promise<RoutedInferenceResult> {
  // Shared preparation retains normal eligibility, ranking and preferences.
  const cancellation = currentInferenceSignal();
  cancellation?.throwIfAborted();
  const restricted = currentReassessmentExecution();
  const finite = currentFiniteReassessmentExecution(), original = finite ? structuredClone({ messages, systemPrompt, tools: options?.tools }) : null;
  const nativeRuntime = finite ? await (await import("./reassessment-execution-qualification")).prepareCurrentReassessmentNativeRouting() : undefined;
  const prepared = await prepareRoute(messages, systemPrompt, sensitivity, options, restricted ? { reassessment: true, nativeRuntime } : undefined);
  if (original) assertReassessmentNativeScreenUnchanged(original, prepared.screenInput);
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
      maxOutputTokens: options?.activityContract?.tokenEnvelope.maxOutputTokens,
      effort: options?.effort ?? prepared.posture?.effort,
      toolChoice: options?.toolChoice,
      terminalWriterToolName: options?.terminalWriterToolName,
    });
  }
  if (restricted) {
    const frozen = restricted.qualification;
    if (finite && (decision.routingConfidence?.qualityFloorRelaxed || prepared.requestedBudgetClass !== frozen.nativeRuntime!.requestedBudgetClass || contract.budgetClass !== frozen.nativeRuntime!.spendAwareBudgetClass
      || !decision.executionPlan || !reassessmentNativePlansEqual(decision.executionPlan, frozen.executionPlan))) throw new ReassessmentExecutionError("reassessment-native-normal-plan-changed");
    const endpoint = manifests.find(manifest => manifest.id === decision.selectedEndpoint);
    if (options?.interactionMode === "background" || options?.durableAsyncOperation || !endpoint
      || endpoint.providerId !== frozen.providerId || endpoint.modelId !== frozen.modelId
      || endpoint.providerConnectionId !== frozen.providerConnectionId
      || endpoint.providerConnectionVersion !== frozen.providerConnectionVersion) {
      throw new ReassessmentExecutionError("reassessment-route-changed");
    }
    decision = { ...decision, executionPlan: frozen.executionPlan, fallbackChain: [endpoint.id] };
    assertReassessmentPlan({ providerId: endpoint.providerId, modelId: endpoint.modelId,
      plan: frozen.executionPlan, tools: options?.tools });
  }

  // BI-F4D3B9E9(c): persist the failed route decision BEFORE throwing so the
  // excludedTrace survives for diagnosis (see persistFailedRouteDecision).
  const persistFailedDecision = () => persistFailedRouteDecision(decision, options);
  const noEligible = (reason: string, missingCapability?: string) => new NoEligibleEndpointsError(
    taskType, reason, decision.excludedCount, missingCapability, options?.agentId,
    routingEligibilitySummary(contract.sensitivity, contract.residencyPolicy, decision.excludedCount, decision.excludedReasons));

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
      throw noEligible(
        `No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). ` +
        `Missing: ${missingCap ?? "unknown"}. ` +
        `Configure a capable provider at Platform > AI > Model Assignment.`,
        missingCap,
      );
    }
  }

  // Ordinary calls may relax tool capability; governed callers require their tools.
  if (!decision.selectedEndpoint && contract.requiresTools) {
    if (options?.requireTools || contract.toolChoice === "required") {
      const fix = contract.residencyPolicy === "local_only"
        ? `Local-only inference is ON (cloud disabled), so routing will not fall back to a cloud provider. ` +
          `Enable a tool-capable LOCAL model (or run the build through the opencode engine, which supplies the tool loop), ` +
          `or turn off local-only inference in Admin > AI > Providers & Routing.`
        : `Configure a tool-capable provider (OpenAI, Anthropic, Gemini) or check that existing providers are active.`;
      persistFailedDecision();
      throw noEligible(
        `No tool-capable endpoint available. Build Studio requires tool support — cannot fall back to generic chat. ${fix}`,
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
        { preferences: endpointPreferencesFromOptions(options), accountAffinityKey: accountAffinityKey(options?.agentId, options?.threadId) },
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
      throw noEligible(
        screenedBlockReason ??
          `No eligible LOCAL model for task '${taskType}' (sensitivity '${sensitivity}'). ` +
          `Local-only inference is ON, so cloud providers are excluded and routing will NOT silently fall back to cloud. ` +
          `Pull or enable a local model that meets this task's requirements (tool support, context window, quality tier), ` +
          `raise the model's context window in Build Runtime, or turn off local-only inference in Admin > AI > Providers & Routing. ` +
          `Router detail: ${decisionReason}`,
      );
    }
    throw noEligible(decisionReason);
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
  // An async adapter performs a side-effecting provider start. It may only be
  // reached through the durable background admission/worker path, where the
  // provider handle cannot be discarded by a foreground response boundary.
  if (routeUsesDurableAsyncAdapter(decision)
    && options?.interactionMode !== "background") {
    throw new Error("ASYNC_OPERATION_BACKGROUND_REQUIRED");
  }
  // Supplying durable authority is an explicit at-most-once provider boundary,
  // not a hint. A missing/mis-seeded async recipe must fail before the generic
  // background branch can call a provider directly and discard its handle.
  if (options?.durableAsyncOperation && !routeUsesDurableAsyncAdapter(decision)) {
    throw new Error("ASYNC_OPERATION_EXECUTION_PLAN_REQUIRED");
  }
  const expectedExecution = options?.durableAsyncOperation?.expectedExecution;
  if (expectedExecution) assertDurableExecutionConstraint(decision, expectedExecution);
  if (options?.interactionMode === "background") {
    if (routeUsesDurableAsyncAdapter(decision)) {
      onDispatch();
      const admitted = await admitRoutedAsyncOperation({
        decision,
        messages,
        systemPrompt,
        tools: toolsStripped ? undefined : dispatchScreenInput.tools,
        screeningInput: dispatchScreenInput,
        options,
        traceId,
      });
      await persistAcceptedRoutedTokenUsage({
        traceId,
        agentId: options.agentId ?? "unknown",
        providerId: admitted.providerId,
        providerConnectionId: decision.executionPlan?.providerConnectionId,
        contextKey: routedContextKey(options),
      });
      return {
        providerId: admitted.providerId,
        providerConnectionId: decision.executionPlan?.providerConnectionId,
        quotaScopeKey: decision.executionPlan?.providerConnectionId ? conservativeQuotaScope(admitted.providerId) : undefined,
        modelId: admitted.modelId,
        content: "",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        downgraded: false,
        downgradeMessage: null,
        downgradeReason: null,
        toolsStripped,
        routeDecision: decision,
        asyncOperationId: admitted.operationId,
        ...routedRehydrationHandle(prepared.rehydrationHandle),
      };
    }

    // EP-INF-009d: Start async operation, return immediately
    onDispatch();
    const result = await callWithFallbackChain(
      decision,
      messages,
      systemPrompt,
      toolsStripped ? undefined : dispatchScreenInput.tools,
      decision.executionPlan,
      options?.previousResponseId,
      options?.mcpSession,
      { traceId, agentId: options?.agentId ?? null, agentMessageId: options?.agentMessageId ?? null, buildId: options?.buildId ?? null, threadId: options?.threadId ?? null, previousResponseProviderConnectionId: options?.previousResponseProviderConnectionId },
      dispatchScreenInput,
      ...(cancellation ? [cancellation] as [AbortSignal] : [] as []),
    );
    applyObservedRouterEvidence(decision, result.routingEvidence, routeDecisionLogId);

    // Every adapter dispatch persists TokenUsage (BI-28858D2F).
    void persistRoutedTokenUsage({
      traceId,
      agentId: options?.agentId ?? "unknown",
      providerId: result.providerId,
      contextKey: routedContextKey(options),
      ...(result.providerConnectionId ? { providerConnectionId: result.providerConnectionId, quotaScopeKey: result.quotaScopeKey } : {}),
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      inferenceMs: result.inferenceMs,
    });

    return transferLocalNativeContinuation<RoutedInferenceResult>(result, {
      providerId: result.providerId,
      providerConnectionId: result.providerConnectionId,
      quotaScopeKey: result.quotaScopeKey,
      modelId: result.modelId,
      content: result.content,
      toolCalls: result.toolCalls,
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      downgraded: result.downgraded,
      downgradeMessage: result.downgradeMessage,
      // Background path: only a real dispatch failure downgrades here.
      downgradeReason: result.downgradeReason
        ?? (result.downgraded ? "provider-unavailable" : null),
      toolsStripped,
      truncated: result.truncated ?? false,
      routeDecision: decision,
      ...routedRehydrationHandle(prepared.rehydrationHandle),
    });
  }

  // 5b. Foreground: standard sync dispatch via fallback chain
  onDispatch();
  const result = await callWithFallbackChain(
    decision,
    messages,
    systemPrompt,
    toolsStripped ? undefined : dispatchScreenInput.tools,
    decision.executionPlan,
    options?.previousResponseId,
    options?.mcpSession,
    { traceId, agentId: options?.agentId ?? null, agentMessageId: options?.agentMessageId ?? null, buildId: options?.buildId ?? null, threadId: options?.threadId ?? null, previousResponseProviderConnectionId: options?.previousResponseProviderConnectionId },
    dispatchScreenInput,
    ...(cancellation ? [cancellation] as [AbortSignal] : [] as []),
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
    ...(result.providerConnectionId ? { providerConnectionId: result.providerConnectionId, quotaScopeKey: result.quotaScopeKey } : {}),
    contextKey: routedContextKey(options),
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    inferenceMs: result.inferenceMs,
  });

  // 7. Normalize result to RoutedInferenceResult
  return transferLocalNativeContinuation<RoutedInferenceResult>(result, {
    providerId: result.providerId,
    providerConnectionId: result.providerConnectionId,
    quotaScopeKey: result.quotaScopeKey,
    modelId: result.modelId,
    content: result.content,
    toolCalls: result.toolCalls,
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    downgraded: result.downgraded || fellToLocal,
    downgradeMessage: result.downgradeMessage ?? localFallbackBanner,
    // Opposite causes; never both for one turn (BI-F4D3B9E9d).
    downgradeReason: result.downgradeReason
      ?? (result.downgraded
        ? "provider-unavailable"
        : fellToLocal
          ? "not-eligible"
          : null),
    downgradeCause: localFallback?.cause ?? null,
    toolsStripped,
    truncated: result.truncated ?? false,
    routeDecision: decision,
    responseId: result.responseId,
    resolvedMaxContextTokens: selectedManifest?.maxContextTokens ?? null,
    ...routedRehydrationHandle(prepared.rehydrationHandle),
  });
}
