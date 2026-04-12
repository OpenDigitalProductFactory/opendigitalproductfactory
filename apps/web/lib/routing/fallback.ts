/**
 * EP-INF-001: Dispatch HTTP calls using the RouteDecision's endpoint selection
 * and fallback chain. Replaces callWithFailover's dispatch loop.
 */
import { callProvider, InferenceError } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import type { RouteDecision } from "./types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { recordRequest, learnFromRateLimitResponse, extractRetryAfterMs } from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
import { recordRouteOutcome } from "./route-outcome";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import {
  shouldDegradeModelForInterfaceDrift,
  shouldReconcileProviderAfterError,
} from "@/lib/inference/provider-reconciliation";

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

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;

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
      const result = await callProvider(
        entry.providerId,
        entry.modelId,
        messages,
        systemPrompt,
        tools,
        i === 0 ? plan : undefined,
        i === 0 ? previousResponseId : undefined,
      );

      // EP-INF-004: Record successful request for rate tracking
      recordRequest(entry.providerId, entry.modelId,
        (result.inputTokens ?? 0) + (result.outputTokens ?? 0));

      // EP-INF-006: Record route outcome (fire-and-forget)
      recordRouteOutcome({
        providerId: entry.providerId,
        modelId: entry.modelId,
        recipeId: i === 0 ? (plan?.recipeId ?? null) : null,
        contractFamily: plan?.contractFamily ?? decision.taskType,
        taskType: decision.taskType,
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
          await prisma.modelProfile
            .updateMany({
              where: { providerId: entry.providerId, modelId: entry.modelId },
              data: { modelStatus: "degraded" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${entry.providerId}/${entry.modelId} degraded:`,
                err,
              ),
            );

          // EP-INF-004: Schedule auto-recovery
          scheduleRecovery(entry.providerId, entry.modelId);

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
          await prisma.modelProfile
            .updateMany({
              where: { providerId: entry.providerId, modelId: entry.modelId },
              data: { modelStatus: "degraded" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to degrade ${entry.providerId}/${entry.modelId} after interface drift:`,
                err,
              ),
            );

          if (shouldReconcileProviderAfterError(e.code, e.message)) {
            autoDiscoverAndProfile(entry.providerId).catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to reconcile ${entry.providerId} after interface drift:`,
                err,
              ),
            );
          }
        }

        // EP-INF-006: Record error outcome (fire-and-forget)
        recordRouteOutcome({
          providerId: entry.providerId,
          modelId: entry.modelId,
          recipeId: i === 0 ? (plan?.recipeId ?? null) : null,
          contractFamily: plan?.contractFamily ?? decision.taskType,
          taskType: decision.taskType,
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
