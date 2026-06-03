/**
 * EP-INF-001: Dispatch HTTP calls using the RouteDecision's endpoint selection
 * and fallback chain. Replaces callWithFailover's dispatch loop.
 */
import { callProvider, InferenceError } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import type { RouteDecision } from "./types";
import type { RoutedExecutionPlan } from "./recipe-types";
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
import { recordRouteOutcome } from "./route-outcome";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import {
  shouldDegradeModelForInterfaceDrift,
  shouldReconcileProviderAfterError,
} from "@/lib/inference/provider-reconciliation";

type RouteOutcomeAttribution = {
  agentId?: string | null;
  /**
   * Pre-allocated AgentMessage id for the assistant turn this call is part of.
   * Threaded into AdapterRunTelemetry rows so a thread's badge/cost rollups
   * can join telemetry → message without depending on row-creation ordering
   * (the AgentMessage row is persisted after the agentic loop returns, but
   * adapter rows are written inside each iteration).
   */
  agentMessageId?: string | null;
};

function buildFallbackProviderSettings(
  sourcePlan?: RoutedExecutionPlan,
): RoutedExecutionPlan["providerSettings"] {
  const settings = sourcePlan?.providerSettings ?? {};
  const effort = (settings as Record<string, unknown>).effort;
  return effort ? { effort } : {};
}

function buildFallbackPlan(
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

  return {
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
  };
}

export interface FallbackResult {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  downgraded: boolean;
  downgradeMessage: string | null;
  responseId?: string;
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
): Promise<FallbackResult> {
  if (!decision.selectedEndpoint) {
    throw new Error(
      `No endpoint available for ${decision.taskType}: ${decision.reason}`,
    );
  }

  // Build chain from RouteDecision — resolve actual providerId from candidate traces
  const resolveEntry = (endpointId: string) => {
    const candidate = decision.candidates.find(c => c.endpointId === endpointId && !c.excluded);
    return {
      endpointId,
      providerId: candidate?.providerId ?? endpointId,
      modelId: candidate?.modelId ?? "",
    };
  };

  const selectedEntry = resolveEntry(decision.selectedEndpoint!);
  // Override modelId with the authoritative value from the decision
  selectedEntry.modelId = decision.selectedModelId!;

  // Get fallback entries from the candidates in the decision trace
  const fallbackEntries = decision.fallbackChain.map(epId => resolveEntry(epId));

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
  let rateLimitRetried = false;
  let overloadRetried = false;
  let transientRetried = false;
  const agentId = outcomeAttribution?.agentId?.trim() || mcpSession?.agentId?.trim() || null;
  const agentMessageId = outcomeAttribution?.agentMessageId?.trim() || null;

  // Small local fallback models (Docker Model Runner / 7-13B class) reliably
  // handle ~10-15 tools before tool-selection accuracy collapses. When the
  // caller hands us a large tool surface (Build Studio threads expose 26-36
  // phase-filtered tools), routing local as a fallback turns the agentic loop
  // into a 200-iteration spin. Skip local fallbacks above the threshold; the
  // selected primary endpoint is still tried regardless. See FB-71FB3A53
  // thread, 2026-05-22.
  const LOCAL_FALLBACK_MAX_TOOLS = 15;
  const skipLocalFallback = (tools?.length ?? 0) > LOCAL_FALLBACK_MAX_TOOLS;

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;

    if (skipLocalFallback && i > 0 && entry.providerId === "local") {
      console.log(
        `[callWithFallbackChain] Skipping local fallback (${tools?.length ?? 0} tools > ${LOCAL_FALLBACK_MAX_TOOLS} threshold for small local models)`,
      );
      attempts.push({
        endpointId: entry.providerId,
        error: `skipped local fallback: ${tools?.length ?? 0} tools exceeds threshold for small local models`,
      });
      continue;
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
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: entry.providerId },
      select: { providerId: true, name: true },
    });

    if (!provider) {
      attempts.push({ endpointId: entry.providerId, error: "provider not found in database" });
      continue;
    }

    try {
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
        { agentId, agentMessageId },
      );

      // EP-INF-004: Record successful request for rate tracking
      recordRequest(entry.providerId, entry.modelId,
        (result.inputTokens ?? 0) + (result.outputTokens ?? 0));

      // Routing-resilience Slice A: a success closes any open runtime circuit
      // for this endpoint — it is demonstrably reachable again.
      clearEndpointUnavailable(entry.providerId, entry.modelId);

      // EP-INF-006: Record route outcome (fire-and-forget)
      recordRouteOutcome({
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

      const pinnedMiss = decision.reason?.startsWith("WARNING: Pinned provider") ?? false;
      const downgraded = i > 0 || pinnedMiss;
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        content: result.content,
        toolCalls: result.toolCalls ?? [],
        tokenUsage:
          result.inputTokens !== undefined || result.outputTokens !== undefined
            ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens }
            : undefined,
        downgraded,
        downgradeMessage: downgraded
          ? pinnedMiss
            ? `${decision.reason?.split(". ")[0]}. Using ${provider.name} instead. Check AI Workforce settings to fix.`
            : `Switched to ${provider.name} after the preferred endpoint was unavailable.`
          : null,
        responseId: result.responseId,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      attempts.push({ endpointId: entry.providerId, error: errMsg });
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
          if (isSelectedEndpoint && !rateLimitRetried) {
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
          await prisma.modelProvider
            .update({
              where: { providerId: entry.providerId },
              data: { status: "disabled" },
            })
            .catch((err) =>
              console.error(`[callWithFallbackChain] failed to disable ${entry.providerId} after billing error:`, err),
            );

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
            autoDiscoverAndProfile(entry.providerId).catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to reconcile ${entry.providerId} after model_not_found:`,
                err,
              ),
            );
          }

        } else if (e.code === "auth") {
          // Auth errors remain at provider level — credentials are shared
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

        // EP-INF-006: Record error outcome (fire-and-forget)
        recordRouteOutcome({
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

  throw new Error(
    `All endpoints failed for ${decision.taskType}. Attempts: ${JSON.stringify(attempts)}`,
  );
}
