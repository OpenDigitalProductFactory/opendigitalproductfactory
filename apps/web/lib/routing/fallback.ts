/**
 * EP-INF-001: Dispatch HTTP calls using the RouteDecision's endpoint selection
 * and fallback chain. Replaces callWithFailover's dispatch loop.
 */
import { callProvider, InferenceError } from "@/lib/ai-inference";
import { resolveLocalToolCeiling } from "./local-tool-ceiling";
import { resolveLocalToolFidelityCeiling } from "./local-tool-fidelity";
import type { ChatMessage } from "@/lib/ai-inference";
import type { AsyncOperationStartResult } from "./adapter-types";
import { prisma } from "@dpf/db";
import type { RouteDecision } from "./types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { compileOpenRouterExecutionPolicy } from "./provider-suitability/openrouter-policy";
import { resolveDefaultExecutionAdapter } from "./execution-plan";
import {
  recordRequest,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
  markEndpointUnavailable,
  clearEndpointUnavailable,
  type EndpointUnavailableReason,
} from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
import { isLocalProviderId } from "./provider-locality";
import {
  LocalProviderCapacityDeferredError,
} from "./local-provider-capacity";
import { invalidateRoutingLoaderCache } from "./loader";
import { recordRouteOutcome } from "./route-outcome";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import {
  ProviderReconciliationRequiredError,
  shouldDegradeModelForInterfaceDrift,
  shouldReconcileProviderAfterError,
} from "@/lib/inference/provider-reconciliation";
import {
  assertInferenceDispatchScreen,
  isEligibleForScreenedDispatch,
  requiresInferenceDispatchScreen,
} from "./inference-dispatch-guard";
import {
  screenInferencePayload,
  type ScreenInferencePayloadInput,
} from "@/lib/inference/data-screening/screen-inference-payload";

type RouteOutcomeAttribution = {
  /** Request-scoped correlation shared by decision, attempts, outcomes, and usage. */
  traceId?: string | null;
  agentId?: string | null;
  /**
   * Pre-allocated AgentMessage id for the assistant turn this call is part of.
   * Threaded into AdapterRunTelemetry rows so a thread's badge/cost rollups
   * can join telemetry → message without depending on row-creation ordering
   * (the AgentMessage row is persisted after the agentic loop returns, but
   * adapter rows are written inside each iteration).
   */
  agentMessageId?: string | null;
  /** FeatureBuild this call belongs to (BI-0A6B8B38 per-phase metering). */
  buildId?: string | null;
};

function buildFallbackProviderSettings(
  sourcePlan?: RoutedExecutionPlan,
): RoutedExecutionPlan["providerSettings"] {
  const settings = sourcePlan?.providerSettings ?? {};
  const effort = (settings as Record<string, unknown>).effort;
  return effort ? { effort } : {};
}

export function buildFallbackPlan(
  entry: { providerId: string; modelId: string },
  decision: RouteDecision,
  tools?: Array<Record<string, unknown>>,
  sourcePlan?: RoutedExecutionPlan,
): RoutedExecutionPlan {
  const toolPolicy: RoutedExecutionPlan["toolPolicy"] = {
    ...(sourcePlan?.toolPolicy ?? {}),
  };
  if ((tools?.length ?? 0) > 0 && toolPolicy.toolChoice === undefined) {
    toolPolicy.toolChoice = "auto";
  }

  const fallbackPlan: RoutedExecutionPlan = {
    providerId: entry.providerId,
    modelId: entry.modelId,
    recipeId: null,
    contractFamily: sourcePlan?.contractFamily ?? decision.taskType,
    executionAdapter: resolveDefaultExecutionAdapter(entry.providerId),
    maxTokens: sourcePlan?.maxTokens ?? 4096,
    providerSettings: buildFallbackProviderSettings(sourcePlan),
    toolPolicy,
    responsePolicy: sourcePlan?.responsePolicy ?? {},
    ...(sourcePlan?.temperature !== undefined ? { temperature: sourcePlan.temperature } : {}),
    ...(sourcePlan?.openRouterObligations
      ? { openRouterObligations: sourcePlan.openRouterObligations }
      : {}),
  };
  if (entry.providerId === "openrouter" && sourcePlan?.openRouterObligations) {
    fallbackPlan.openRouterPolicy = compileOpenRouterExecutionPolicy(sourcePlan.openRouterObligations);
  }
  return fallbackPlan;
}

export interface FallbackResult {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  // BI-105E8A1E: the adapter's measured wall-clock latency, carried through to
  // metering so the `compute` cost model (watts × time) can price local
  // inference. Optional because a screened/stub path may not measure it.
  inferenceMs?: number;
  /** Typed provider start handle preserved across the fallback projection. */
  asyncOperation?: AsyncOperationStartResult;
  downgraded: boolean;
  /** Distinguishes a failed dispatch from a configured route that was ineligible. */
  downgradeReason: "provider-unavailable" | "not-eligible" | null;
  downgradeMessage: string | null;
  responseId?: string;
  /** True when the provider stopped at the output-token ceiling (BI-1D144CC1). */
  truncated?: boolean;
  /** Policy-safe router receipt; never includes prompts or model output. */
  routingEvidence?: import("./provider-suitability/openrouter-policy").OpenRouterRoutingEvidence;
}

/**
 * Reason-scoped runtime-cooldown durations (ms) for the circuit breaker.
 * Short for self-clearing conditions (rate_limit/overload/transient/provider
 * error); long for conditions that need operator remediation (auth/billing).
 * See spec §4.1 + risk R1.
 */
const RUNTIME_COOLDOWN_MS: Record<EndpointUnavailableReason, number> = {
  rate_limit: 30_000,
  overloaded: 15_000,
  transient: 10_000,
  provider_error: 15_000,
  auth: 600_000,
  billing: 600_000,
};

/**
 * Map an InferenceError to a runtime-circuit reason + cooldown (with jitter, per
 * AWS backoff-with-jitter). For rate limits the provider's retry-after header
 * wins when present (capped at 60s).
 */
function runtimeCooldownFor(e: InferenceError): {
  reason: EndpointUnavailableReason;
  ms: number;
} {
  let reason: EndpointUnavailableReason;
  switch (e.code) {
    case "rate_limit":
    case "overloaded":
    case "transient":
    case "auth":
    case "billing":
      reason = e.code;
      break;
    default:
      reason = "provider_error";
      break;
  }
  let base = RUNTIME_COOLDOWN_MS[reason];
  if (reason === "rate_limit") {
    const retry = extractRetryAfterMs(e.headers);
    if (retry !== undefined) base = Math.min(retry, 60_000);
  }
  const jitter = Math.random() * Math.min(base * 0.1, 1_000);
  return { reason, ms: base + jitter };
}

async function markModelDegraded(
  providerId: string,
  modelId: string,
  reason: string,
): Promise<void> {
  await prisma.modelProfile
    .updateMany({
      where: { providerId, modelId },
      data: { modelStatus: "degraded" },
    })
    .catch((err) =>
      console.error(
        `[callWithFallbackChain] failed to degrade ${providerId}/${modelId} after ${reason}:`,
        err,
      ),
    );
  // The manifest loader derives EndpointManifest.status from modelStatus, so this
  // degrade changes what loadEndpointManifests would return — drop the request-
  // scoped loader cache so the next routing iteration sees the degraded status
  // rather than a stale "active" manifest.
  invalidateRoutingLoaderCache();
}

/**
 * Execute an inference call using the RouteDecision's selected endpoint,
 * falling back through the chain on failure.
 */
export async function callWithFallbackChain(
  decision: RouteDecision,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
  previousResponseId?: string,
  mcpSession?: import("./adapter-types").AdapterMcpSession,
  outcomeAttribution?: RouteOutcomeAttribution,
  screeningInput?: ScreenInferencePayloadInput,
): Promise<FallbackResult> {
  if (!decision.selectedEndpoint) {
    throw new Error(
      `No endpoint available for ${decision.taskType}: ${decision.reason}`,
    );
  }
  revalidateDispatchScreen(decision, screeningInput, messages, systemPrompt, tools);
  const requireScreenedCandidates = requiresInferenceDispatchScreen(decision);

  // Build chain from RouteDecision — resolve actual providerId from candidate traces
  const resolveEntry = (endpointId: string) => {
    const candidate = decision.candidates.find(c => c.endpointId === endpointId);
    if (requireScreenedCandidates && !isEligibleForScreenedDispatch(decision, candidate)) {
      return null;
    }
    const eligibleCandidate = candidate && !candidate.excluded ? candidate : undefined;
    return {
      endpointId,
      providerId: eligibleCandidate?.providerId ?? endpointId,
      modelId: eligibleCandidate?.modelId ?? "",
    };
  };

  const selectedEntry = resolveEntry(decision.selectedEndpoint!);
  if (!selectedEntry) {
    throw new Error(
      `No eligible screened endpoint available for ${decision.taskType}: ${decision.reason}`,
    );
  }
  // Override modelId with the authoritative value from the decision
  selectedEntry.modelId = decision.selectedModelId!;

  // Get fallback entries from the candidates in the decision trace
  const fallbackEntries = decision.fallbackChain
    .map(epId => resolveEntry(epId))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const allEntries = [selectedEntry, ...fallbackEntries];

  // Deduplicate using composite key (providerId + modelId)
  const seen = new Set<string>();
  const chain = allEntries.filter(e => {
    const key = `${e.providerId}::${e.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const attempts: Array<{ endpointId: string; error: string }> = [];
  const reconciledProviders = new Set<string>();
  const capacityDeferrals: LocalProviderCapacityDeferredError[] = [];
  let rateLimitRetried = false;
  let overloadRetried = false;
  let transientRetried = false;
  let authRefreshRetried = false;
  let selectedAdapterCannotEnforceRequiredTerminalWriter = false;
  const agentId = outcomeAttribution?.agentId?.trim() || mcpSession?.agentId?.trim() || null;
  const traceId = outcomeAttribution?.traceId?.trim() || decision.traceId?.trim() || null;
  const agentMessageId = outcomeAttribution?.agentMessageId?.trim() || null;
  const buildId = outcomeAttribution?.buildId?.trim() || null;

  // Small local fallback models (Docker Model Runner / 7-13B class) reliably
  // handle ~10-15 tools before tool-selection accuracy collapses. When the
  // caller hands us a large tool surface (Build Studio threads expose 26-36
  // phase-filtered tools), routing local as a fallback turns the agentic loop
  // into a 200-iteration spin. Skip local fallbacks above the ceiling; the
  // selected primary endpoint is still tried regardless. See FB-71FB3A53
  // thread, 2026-05-22.
  //
  // The ceiling comes from `resolveLocalToolCeiling`, the SAME function the
  // coworker attachment budget uses (BI-A8BFEFCE). This file previously pinned
  // the raw cliff and asserted the budget matched it; it did not. The budget
  // honours a MEASURED fidelity ceiling, so once the eval harness measures a
  // local model above 15 the budget would attach more tools than this gate would
  // agree to run — the surface would be refused for exceeding a limit nothing
  // else applied. Sharing the derivation makes that class of drift impossible.
  //
  // Resolved LAZILY and memoised: the measured ceiling is a DB read, and it is
  // only needed when a local fallback entry is actually reached with tools
  // attached, which is rare. The hot path pays nothing.
  const attachedToolCount = tools?.length ?? 0;
  let cachedLocalToolCeiling: number | null = null;
  const resolveLocalFallbackCeiling = async (): Promise<number> => {
    if (cachedLocalToolCeiling === null) {
      const measured = await resolveLocalToolFidelityCeiling().catch(() => null);
      cachedLocalToolCeiling = resolveLocalToolCeiling(measured);
    }
    return cachedLocalToolCeiling;
  };

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;

    if (i > 0 && entry.providerId === "local" && attachedToolCount > 0) {
      const localToolCeiling = await resolveLocalFallbackCeiling();
      if (attachedToolCount > localToolCeiling) {
        console.log(
          `[callWithFallbackChain] Skipping local fallback (${attachedToolCount} tools > ${localToolCeiling} threshold for small local models)`,
        );
        // Message shape is parsed by inference-dead-ends.ts to report the exact
        // count back to the operator — keep "<n> tools exceeds threshold".
        attempts.push({
          endpointId: entry.providerId,
          error: `skipped local fallback: ${attachedToolCount} tools exceeds threshold for small local models`,
        });
        continue;
      }
    }

    // Backoff between fallback attempts to avoid cascading rate limits.
    // First attempt (i=0) runs immediately; subsequent attempts wait with
    // exponential backoff + jitter: ~500ms, ~1.5s, ~3.5s, ...
    if (i > 0) {
      const baseMs = 500 * Math.pow(2, i - 1);
      const jitterMs = Math.random() * 300;
      await new Promise(r => setTimeout(r, baseMs + jitterMs));
    }

    // Look up the provider row to get its display name for downgrade messages
    // and its auth method (so an auth error on a refreshable OAuth provider can
    // be self-healed rather than permanently disabling the provider).
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: entry.providerId },
      select: { providerId: true, name: true, authMethod: true },
    });

    if (!provider) {
      attempts.push({ endpointId: entry.providerId, error: "provider not found in database" });
      continue;
    }

    try {
      // A retry or fallback can happen well after routing. Re-screen the actual
      // dispatch payload at every provider attempt so route-time evidence cannot
      // be replayed after payload or policy-version drift.
      revalidateDispatchScreen(decision, screeningInput, messages, systemPrompt, tools);
      const entryPlan =
        i === 0 && plan
          ? plan
          : buildFallbackPlan(entry, decision, tools, plan);

      const result = await callProvider(
        entry.providerId,
        entry.modelId,
        messages,
        systemPrompt,
        tools,
        entryPlan,
        i === 0 ? previousResponseId : undefined,
        mcpSession,
        { traceId, agentId, agentMessageId, buildId },
      );

      // EP-INF-004: Record successful request for rate tracking
      recordRequest(entry.providerId, entry.modelId,
        (result.inputTokens ?? 0) + (result.outputTokens ?? 0));

      // Routing-resilience Slice A: a success closes any open runtime circuit
      // for this endpoint — it is demonstrably reachable again.
      clearEndpointUnavailable(entry.providerId, entry.modelId);

      // EP-INF-006: Record route outcome (fire-and-forget)
      recordRouteOutcome({
        traceId,
        providerId: entry.providerId,
        modelId: entry.modelId,
        recipeId: i === 0 ? (plan?.recipeId ?? null) : null,
        contractFamily: plan?.contractFamily ?? decision.taskType,
        taskType: decision.taskType,
        agentId,
        latencyMs: result.inferenceMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: null,
        schemaValid: null,
        toolSuccess: result.toolCalls ? true : null,
        fallbackOccurred: i > 0,
      }).catch((err) => console.error("[outcome] Failed to record:", err));

      const preferenceMiss =
        decision.preferenceResolution?.fallbackUsed === true;
      const unavailablePreference =
        decision.preferenceResolution?.unavailable[0] ?? null;
      const capabilityFallback = i > 0
        && selectedAdapterCannotEnforceRequiredTerminalWriter;
      const downgradeReason = i > 0
        ? capabilityFallback ? "not-eligible" : "provider-unavailable"
        : preferenceMiss
          ? "not-eligible"
          : null;
      const downgraded = downgradeReason !== null;
      const raw = result.raw && typeof result.raw === "object"
        ? result.raw as Record<string, unknown>
        : null;
      const routingEvidence = raw?.openRouterRoutingEvidence;
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        content: result.content,
        toolCalls: result.toolCalls ?? [],
        tokenUsage:
          result.inputTokens !== undefined || result.outputTokens !== undefined
            ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens }
            : undefined,
        inferenceMs: result.inferenceMs,
        ...(result.asyncOperation !== undefined && {
          asyncOperation: result.asyncOperation,
        }),
        truncated: result.truncated,
        downgraded,
        downgradeReason,
        downgradeMessage: downgraded
          ? capabilityFallback
            ? `The selected AI adapter cannot enforce this task's required governed writer. Using ${provider.name} instead.`
            : preferenceMiss
            ? unavailablePreference
              ? `Preferred ${unavailablePreference.kind} "${unavailablePreference.value}" is unavailable. Using ${provider.name} instead. Check AI Workforce settings to fix.`
              : `A configured AI routing preference is unavailable. Using ${provider.name} instead. Check AI Workforce settings to fix.`
            : `Switched to ${provider.name} after the preferred endpoint was unavailable.`
          : null,
        responseId: result.responseId,
        ...(routingEvidence && typeof routingEvidence === "object"
          ? { routingEvidence: routingEvidence as import("./provider-suitability/openrouter-policy").OpenRouterRoutingEvidence }
          : {}),
      };
    } catch (e) {
      if (e instanceof LocalProviderCapacityDeferredError) {
        capacityDeferrals.push(e);
        attempts.push({ endpointId: entry.providerId, error: e.reason });
        continue;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      attempts.push({ endpointId: entry.providerId, error: errMsg });
      if (e instanceof InferenceError && e.code === "required_terminal_writer_not_enforceable") {
        if (i === 0) selectedAdapterCannotEnforceRequiredTerminalWriter = true;
        console.info(`[callWithFallbackChain] ${entry.providerId} adapter cannot enforce the required terminal writer; trying the next candidate.`);
        continue;
      }
      console.warn(`[callWithFallbackChain] ${entry.providerId} failed: ${errMsg}`);

      if (e instanceof InferenceError) {
        // EP-INF-004: Record the failed request too
        recordRequest(entry.providerId, entry.modelId);

        if (e.code === "rate_limit") {
          // EP-INF-004: Learn from response headers if available
          learnFromRateLimitResponse(entry.providerId, entry.modelId, e.headers);

          // Wait-and-retry: if this is the selected (pinned) endpoint,
          // wait for the rate limit to clear instead of falling through
          // to an incompatible provider. Max 2 retries with backoff.
          const retryMs = extractRetryAfterMs(e.headers) ?? 30_000;
          const isSelectedEndpoint = i === 0;
          // A LOCAL pool check that refused before the call left the process is
          // not an upstream 429: nothing was asked of the provider, and the
          // reset is wall-clock, so waiting here cannot make it answer sooner.
          // The pool check throws precisely to cause fallback, and honouring
          // the wait defeated it — the review lane spent its whole 300s budget
          // sleeping on a saturated codex pool while a healthy provider sat at
          // index 1, and every governed review ended `missing-terminal-writer`
          // with the model never bound (BI-52C6FE5A).
          //
          // Skipping the wait is only correct when somewhere else can serve the
          // call. On a single-provider install the saturated pool IS the whole
          // chain, and the wait is the only recovery there is — dropping it
          // there would turn a 30s delay into an immediate hard failure. So the
          // skip is conditional on an untried entry actually existing.
          const hasUntriedAlternative = i < chain.length - 1;
          const skipWaitForLocalPool = e.localPoolExhausted === true && hasUntriedAlternative;
          if (isSelectedEndpoint && !rateLimitRetried && !skipWaitForLocalPool) {
            rateLimitRetried = true;
            const waitMs = Math.min(retryMs, 60_000);
            console.log(`[callWithFallbackChain] Rate limited on pinned provider ${entry.providerId}. Waiting ${waitMs / 1000}s before retry...`);
            await new Promise(r => setTimeout(r, waitMs));
            // Retry the same entry by decrementing i
            i--;
            continue;
          }

          // EP-INF-004: Degrade the specific MODEL, not the provider
          await markModelDegraded(entry.providerId, entry.modelId, "rate_limit");

          // EP-INF-004: Schedule auto-recovery
          scheduleRecovery(entry.providerId, entry.modelId);

        } else if (e.code === "overloaded") {
          // 529 is transient — retry once on the pinned endpoint before degrading.
          // Overload clears in seconds to minutes; 15 s is a safe conservative wait.
          if (i === 0 && !overloadRetried) {
            overloadRetried = true;
            console.log(`[callWithFallbackChain] Provider ${entry.providerId} overloaded (529). Waiting 15s before retry...`);
            await new Promise(r => setTimeout(r, 15_000));
            i--;
            continue;
          }
          await markModelDegraded(entry.providerId, entry.modelId, "overload");
          scheduleRecovery(entry.providerId, entry.modelId);

        } else if (e.code === "transient") {
          // 5xx / 408 are transient server-side errors — retry once on the pinned
          // endpoint with a shorter wait (10 s) before degrading and falling through.
          if (i === 0 && !transientRetried) {
            transientRetried = true;
            console.log(`[callWithFallbackChain] Transient error (${e.statusCode}) from ${entry.providerId}. Waiting 10s before retry...`);
            await new Promise(r => setTimeout(r, 10_000));
            i--;
            continue;
          }
          await markModelDegraded(entry.providerId, entry.modelId, `transient_${e.statusCode ?? "5xx"}`);
          scheduleRecovery(entry.providerId, entry.modelId);

        } else if (e.code === "billing") {
          // 402: billing lapse is account-level and permanent until fixed.
          // Disable the entire provider — same treatment as auth failure.
          //
          // EXCEPT local serving engines (BI-F4D3B9E9): DMR/Ollama have no
          // billing account, so a "billing"-classified response is an
          // interface anomaly (reload race, proxy hiccup, misread body).
          // Disabling the provider turns a per-request glitch into a
          // workforce-wide outage on a local-first install — degrade the
          // model with a recovery probe instead.
          if (isLocalProviderId(entry.providerId)) {
            console.warn(
              `[callWithFallbackChain] ${e.code}-classified error from LOCAL provider ${entry.providerId} — ` +
                `local engines have no billing/credentials; degrading the model instead of disabling the provider.`,
            );
            await markModelDegraded(entry.providerId, entry.modelId, `local_${e.code}_misclassification`);
            scheduleRecovery(entry.providerId, entry.modelId);
          } else {
          await prisma.modelProvider
            .update({
              where: { providerId: entry.providerId },
              data: { status: "disabled" },
            })
            .catch((err) =>
              console.error(`[callWithFallbackChain] failed to disable ${entry.providerId} after billing error:`, err),
            );
          }

        } else if (e.code === "request_too_large") {
          // 413: falling through to the next provider won't help — the same
          // messages will be sent. Throw immediately so the agentic loop can
          // surface a specific "start a new thread" message.
          throw new Error(
            `REQUEST_TOO_LARGE: ${entry.providerId} rejected the request as too large (413). ` +
            `Start a new thread to reduce context size.`,
          );

        } else if (e.code === "model_not_found") {
          // EP-INF-004: Retire the specific model, not the provider
          await prisma.modelProfile
            .updateMany({
              where: { providerId: entry.providerId, modelId: entry.modelId },
              data: {
                modelStatus: "retired",
                retiredAt: new Date(),
                retiredReason: "model_not_found from provider",
              },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to retire ${entry.providerId}/${entry.modelId}:`,
                err,
              ),
            );

          if (shouldReconcileProviderAfterError(e.code, e.message)) {
            await autoDiscoverAndProfile(entry.providerId).then(() => {
              reconciledProviders.add(entry.providerId);
            }).catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to reconcile ${entry.providerId} after model_not_found:`,
                err,
              ),
            );
          }

        } else if (e.code === "auth") {
          // Auth errors are provider-level (credentials are shared). But an
          // OAuth-subscription provider whose access token merely lapsed is
          // REFRESHABLE — permanently disabling it on the first 401 takes the
          // whole provider dark (e.g. the paid Claude subscription that is the
          // only endpoint eligible for the Build code-generation phase, which
          // then silently breaks Build Studio). So for OAuth providers, attempt
          // a token refresh and retry the same entry once before disabling;
          // only disable if the refresh fails or the retry still auth-fails.
          //
          // LOCAL serving engines short-circuit first (BI-F4D3B9E9): DMR/Ollama
          // carry no credentials, so an "auth"-classified response is an
          // interface anomaly (reload race, proxy hiccup), not a bad key.
          // Disabling the provider here turned a single context-overflow window
          // into a 35-minute workforce-wide outage on the fully-local install —
          // degrade the model with a recovery probe instead.
          if (isLocalProviderId(entry.providerId)) {
            console.warn(
              `[callWithFallbackChain] auth-classified error from LOCAL provider ${entry.providerId} — ` +
                `local engines have no credentials; degrading the model instead of disabling the provider.`,
            );
            await markModelDegraded(entry.providerId, entry.modelId, "local_auth_misclassification");
            scheduleRecovery(entry.providerId, entry.modelId);
          } else {
          const isOAuth = provider.authMethod?.startsWith("oauth2") ?? false;
          if (isOAuth && !authRefreshRetried) {
            authRefreshRetried = true;
            const { refreshOAuthToken } = await import("@/lib/provider-oauth");
            const refreshed = await refreshOAuthToken(entry.providerId);
            if ("token" in refreshed) {
              console.log(
                `[callWithFallbackChain] Auth error on OAuth provider ${entry.providerId}; refreshed token, retrying once before disabling.`,
              );
              i--;
              continue;
            }
            console.warn(
              `[callWithFallbackChain] Auth error on OAuth provider ${entry.providerId}; token refresh failed (${refreshed.error}). Disabling provider.`,
            );
          }
          // Non-OAuth provider, refresh failed, or refresh-retry already
          // attempted: the credentials are genuinely bad — disable the provider.
          await prisma.modelProvider
            .update({
              where: { providerId: entry.providerId },
              data: { status: "disabled" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${entry.providerId} disabled:`,
                err,
              ),
            );
          }
        } else if (shouldDegradeModelForInterfaceDrift(e.code, e.message)) {
          await markModelDegraded(entry.providerId, entry.modelId, "interface drift");

          if (shouldReconcileProviderAfterError(e.code, e.message)) {
            autoDiscoverAndProfile(entry.providerId).catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to reconcile ${entry.providerId} after interface drift:`,
                err,
              ),
            );
          }
        }

        // Routing-resilience Slice A: open the runtime circuit for this endpoint.
        // Reached only when the endpoint is actually failing over (the retry
        // `continue` paths above exit first), so a single endpoint contributes at
        // most one wait per turn; subsequent agentic-loop iterations re-run the
        // routing pipeline, which now skips this cooled-down endpoint (spec D1).
        // Process-local + auto-expiring; does NOT mutate ModelProvider.status.
        const cooldown = runtimeCooldownFor(e);
        markEndpointUnavailable(
          entry.providerId,
          entry.modelId,
          cooldown.reason,
          cooldown.ms,
          e.message,
        );
        // Bust the request-scoped loader cache on this cooldown mutation too, so
        // the candidate-pool health change is reflected immediately. (The skip
        // itself is enforced by routeEndpointV2 reading the live circuit state per
        // iteration, not by the manifests — this keeps the cached inputs honest.)
        invalidateRoutingLoaderCache();

        // EP-INF-006: Record error outcome (fire-and-forget)
        recordRouteOutcome({
          traceId,
          providerId: entry.providerId,
          modelId: entry.modelId,
          recipeId: i === 0 ? (plan?.recipeId ?? null) : null,
          contractFamily: plan?.contractFamily ?? decision.taskType,
          taskType: decision.taskType,
          agentId,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          schemaValid: false,
          toolSuccess: false,
          fallbackOccurred: i > 0,
          providerErrorCode: e.code,
        }).catch((err) => console.error("[outcome] Failed to record error:", err));
      }
    }
  }

  if (capacityDeferrals.length === chain.length) {
    throw capacityDeferrals.at(-1)!;
  }

  if (reconciledProviders.size > 0) {
    throw new ProviderReconciliationRequiredError(reconciledProviders, attempts);
  }

  throw new Error(
    `All endpoints failed for ${decision.taskType}. Attempts: ${JSON.stringify(attempts)}`,
  );
}

function revalidateDispatchScreen(
  decision: RouteDecision,
  screeningInput: ScreenInferencePayloadInput | undefined,
  messages: ChatMessage[],
  systemPrompt: string,
  tools: Array<Record<string, unknown>> | undefined,
): void {
  const currentReceipt = screeningInput
    ? screenInferencePayload({
        ...screeningInput,
        messages,
        systemPrompt,
        tools,
      }).receipt
    : undefined;
  assertInferenceDispatchScreen(decision, currentReceipt);
}
