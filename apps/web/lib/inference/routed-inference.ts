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
import { inferContract } from "@/lib/routing/request-contract";
import type { RequestContract } from "@/lib/routing/request-contract";
import {
  loadEndpointManifests,
  loadPolicyRules,
  loadOverrides,
  persistRouteDecision,
} from "@/lib/routing/loader";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  activityHarnessOverridesFromProposalRows,
} from "@/lib/routing/activity-harness-approval-source";
import { callWithFallbackChain } from "@/lib/routing/fallback";
import { prisma } from "@dpf/db";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import { resolveDispatchPosture, type DispatchPosture } from "@/lib/golden-triangle/dispatch";
import { logTokenUsage } from "@/lib/ai-inference";
import type { RouteAndCallOptions } from "./routed-inference-options";
import {
  applyObservedRouterEvidence,
  attachProviderSuitabilityReceipt,
  prepareProviderSuitabilityRuntime,
  type ProviderSuitabilityRuntime,
} from "@/lib/routing/provider-suitability/runtime";
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
  /** True when tools were stripped due to capability degradation (local model). */
  toolsStripped: boolean;
  /** Responses API: the response ID for chaining subsequent calls. */
  responseId?: string;
  /** The V2 route decision that selected this endpoint (for audit/metadata). */
  routeDecision: RouteDecision;
  /** EP-INF-009d: Set when interactionMode is "background". Poll via pollAsyncOperation(). */
  asyncOperationId?: string;
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
  /** EP-GOLDEN-TRIANGLE: the resolved posture applied to this route (null = none/Balanced). */
  posture: DispatchPosture | null;
  suitability: ProviderSuitabilityRuntime | null;
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

  // 1. Infer contract
  let contract = await inferContract(
    taskType,
    messages,
    options?.tools,
    undefined, // outputSchema
    {
      // Posture defaults first — every explicit caller field and the local-only
      // switch below override them (spread/assignment order = precedence).
      ...(posture?.routeContext ?? {}),
      sensitivity,
      interactionMode: options?.interactionMode,
      requiresCodeExecution: options?.requiresCodeExecution,
      requiresWebSearch: options?.requiresWebSearch,
      requiresComputerUse: options?.requiresComputerUse,
      // EP-GOLDEN-TRIANGLE reconciliation: the posture (the everyday Cost/Quality
      // lever) OWNS budgetClass. AgentModelConfig.budgetClass (which defaults to
      // "balanced" and is always sent) applies only as the fallback when no
      // non-Balanced posture is set — so dragging the triangle toward Cost or
      // Quality is never silently overridden by the Assignments default. (Tier is
      // already reconciled: AgentModelConfig.minimumTier acts as a floor via the
      // per-dimension max-merge in inferContract, which the posture can raise but
      // not drop below. See docs/design/2026-06-25-coworker-work-orchestration.md.)
      budgetClass: posture?.routeContext.budgetClass ?? options?.budgetClass,
      allowedProviders: options?.allowedProviders,
      deniedProviders: options?.deniedProviders,
      residencyPolicy:
        options?.modelTier === "local" || localOnlyInference
          ? "local_only"
          : options?.residencyPolicy,
      requiredModelClass: options?.requiredModelClass,
      // EP-MODEL-TIER-ROUTING: a "local"-tier call forces local_only (keep
      // small/simple work on-box) even when the global switch is off; "robust"
      // leaves routing free to prefer a frontier endpoint. The global local-only
      // switch still wins for every call (the sovereign master toggle).
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
  });

  return { contract, decision, manifests, policies, overrides, taskType, posture, suitability };
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
  // 1-3. Contract inference, routing-data load, and V2 endpoint selection —
  // shared with previewRoute() via prepareRoute() so a model-selection
  // prediction can never drift from what this live path actually picks. The
  // live path keeps recipe selection (skipRecipe defaults false) so the
  // executionPlan is built for dispatch below.
  const prepared = await prepareRoute(messages, sensitivity, options);
  const { contract, manifests, policies, overrides, taskType } = prepared;
  let decision = prepared.decision;
  let toolsStripped = false;

  // EP-INF-013: Inject effort into the execution plan so adapters can translate it
  // to provider-specific parameters (Anthropic thinking, OpenAI reasoning_effort).
  // Effort is injected here — after routing but before dispatch — so it flows
  // through callWithFallbackChain into every adapter in the fallback chain.
  // Caller-set effort wins; otherwise the resolved posture's effort applies
  // (EP-GOLDEN-TRIANGLE Slice 3). Balanced/no posture leaves effort untouched.
  const effort = options?.effort ?? prepared.posture?.effort;
  if (effort && decision.executionPlan) {
    decision.executionPlan = {
      ...decision.executionPlan,
      providerSettings: {
        ...decision.executionPlan.providerSettings,
        effort,
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
      const fix = contract.residencyPolicy === "local_only"
        ? `Local-only inference is ON (cloud disabled), so routing will not fall back to a cloud provider. ` +
          `Enable a tool-capable LOCAL model (or run the build through the opencode engine, which supplies the tool loop), ` +
          `or turn off local-only inference in Admin > AI > Providers & Routing.`
        : `Configure a tool-capable provider (OpenAI, Anthropic, Gemini) or check that existing providers are active.`;
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
      decision = await routeEndpointV2(manifests, relaxedContract, policies, overrides);
      if (decision.selectedEndpoint) {
        toolsStripped = true;
      }
    }
  }

  if (!decision.selectedEndpoint) {
    // Local-only inference: fail LOUDLY and specifically rather than letting the
    // generic "no eligible endpoints" mask the real cause (cloud is disabled and
    // no local model qualified for this task's tier/capability/context).
    if (contract.residencyPolicy === "local_only") {
      throw new NoEligibleEndpointsError(
        taskType,
        `No eligible LOCAL model for task '${taskType}' (sensitivity '${sensitivity}'). ` +
        `Local-only inference is ON, so cloud providers are excluded and routing will NOT silently fall back to cloud. ` +
        `Pull or enable a local model that meets this task's requirements (tool support, context window, quality tier), ` +
        `raise the model's context window in Build Runtime, or turn off local-only inference in Admin > AI > Providers & Routing. ` +
        `Router detail: ${decision.reason}`,
        decision.excludedCount,
      );
    }
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

  if (prepared.suitability) {
    attachProviderSuitabilityReceipt(decision, manifests, prepared.suitability);
  }

  // 4. Persist route decision (fire-and-forget unless disabled)
  let routeDecisionLogId: Promise<string | null> = Promise.resolve(null);
  if (options?.persistDecision !== false) {
    routeDecisionLogId = persistRouteDecision(decision, {
      actor: options?.routingActor ?? (options?.agentId ? { kind: "agent", id: options.agentId } : { kind: "system", id: "routed-inference" }),
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
      toolsStripped ? undefined : options?.tools,
      decision.executionPlan,
      options?.previousResponseId,
      options?.mcpSession,
      { agentId: options?.agentId ?? null, agentMessageId: options?.agentMessageId ?? null },
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
        toolsStripped,
        routeDecision: decision,
        asyncOperationId: asyncOpId,
      };
    }

    // Adapter didn't return operation ID — treat as sync result.
    // Phase J (BI-28858D2F follow-up / cost-ledger): every dispatch persists
    // a TokenUsage row regardless of which adapter served it. The CLI
    // subprocess paths (claude-cli, codex-cli) previously bypassed this.
    void persistRoutedTokenUsage({
      agentId: options?.agentId ?? "unknown",
      providerId: result.providerId,
      contextKey: options?.threadId ?? options?.taskType ?? "routed-call",
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
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
    options?.mcpSession,
    { agentId: options?.agentId ?? null },
  );
  applyObservedRouterEvidence(decision, result.routingEvidence, routeDecisionLogId);

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
  // fellToLocal requires an ACTIVE paid provider (no outage) — it was merely ineligible for this request (usually context-window/capability), not unavailable (BI-9DFAFB4A).
  const localFallbackBanner = fellToLocal
    ? `This turn ran on the bundled local model. Your configured provider is active but wasn't eligible for this request — usually because the request exceeded its context window, or needed a capability it doesn't offer. Local output can be less reliable for tool use and complex reasoning; try a shorter request, or review provider settings in Admin > AI.`
    : null;

  // 6. Persist TokenUsage row for the cost ledger (Phase J).
  // Fire-and-forget because metering must not block the response. A loud log
  // on failure is the floor; the bus-check enforcement detector (separate
  // follow-up) is the durable guarantee that drift surfaces.
  void persistRoutedTokenUsage({
    agentId: options?.agentId ?? "unknown",
    providerId: result.providerId,
    contextKey: options?.threadId ?? options?.taskType ?? "routed-call",
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
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
    toolsStripped,
    routeDecision: decision,
    responseId: result.responseId,
    resolvedMaxContextTokens: selectedManifest?.maxContextTokens ?? null,
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
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
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
