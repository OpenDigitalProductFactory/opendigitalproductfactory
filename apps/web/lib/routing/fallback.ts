/**
 * EP-INF-001: Dispatch HTTP calls using the RouteDecision's endpoint selection
 * and fallback chain. Replaces callWithFailover's dispatch loop.
 */
import { callProvider, InferenceError } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import type { RouteDecision } from "./types";

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
): Promise<FallbackResult> {
  if (!decision.selectedEndpoint) {
    throw new Error(
      `No endpoint available for ${decision.taskType}: ${decision.reason}`,
    );
  }

  // Build chain from RouteDecision — each entry carries both providerId and modelId
  const selectedEntry = { providerId: decision.selectedEndpoint!, modelId: decision.selectedModelId! };

  // Get fallback entries from the candidates in the decision trace
  const fallbackEntries = decision.fallbackChain.map(epId => {
    const candidate = decision.candidates.find(c => c.endpointId === epId && !c.excluded);
    return { providerId: epId, modelId: candidate?.modelId ?? "" };
  });

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
      );

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

      // Handle specific error types — update provider status accordingly
      if (e instanceof InferenceError) {
        if (e.code === "rate_limit") {
          // Mark degraded (not disabled) — stays in the routing pool at lower priority.
          // This differs from callWithFailover which fully disables on rate_limit.
          await prisma.modelProvider
            .update({
              where: { providerId: entry.providerId },
              data: { status: "degraded" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${entry.providerId} degraded:`,
                err,
              ),
            );
        } else if (e.code === "model_not_found" || e.code === "auth") {
          // Mark disabled — requires human review before re-enabling.
          // "model_not_found" means the model was removed on the provider side.
          // "auth" means credentials are invalid.
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
      }
    }
  }

  throw new Error(
    `All endpoints failed for ${decision.taskType}. Attempts: ${JSON.stringify(attempts)}`,
  );
}
