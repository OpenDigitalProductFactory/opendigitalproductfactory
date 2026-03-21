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

export interface FallbackResult {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  downgraded: boolean;
  downgradeMessage: string | null;
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

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;

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

      const downgraded = i > 0;
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
          ? `Switched to ${provider.name} after the preferred endpoint was unavailable.`
          : null,
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
          const retryMs = extractRetryAfterMs(e.headers) ?? 60_000;
          scheduleRecovery(entry.providerId, entry.modelId, retryMs);

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
