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

// Skip non-chat models when resolving modelId from ModelProfile/DiscoveredModel
const NON_CHAT_PATTERN =
  /embed|whisper|tts|dall-e|moderation|babbage|davinci-00|text-search|text-similarity|audio|image/i;

const TIER_RANK: Record<string, number> = {
  "frontier": 5,
  "deep-thinker": 4,
  "strong": 3,
  "capable": 2,
  "fast": 1,
  "specialist": 1,
  "local": 0,
};

/**
 * Resolve the best modelId for a provider by checking ModelProfile first,
 * then DiscoveredModel. Mirrors buildBootstrapPriority's resolution logic.
 */
async function resolveModelId(providerId: string): Promise<string> {
  // Try ModelProfile first — has capabilityTier for better selection
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId },
    select: { modelId: true, capabilityTier: true, costTier: true },
  });

  const chatProfiles = profiles.filter(
    (pr) => !NON_CHAT_PATTERN.test(pr.modelId),
  );

  if (chatProfiles.length > 0) {
    chatProfiles.sort((a, b) => {
      const tierDiff =
        (TIER_RANK[b.capabilityTier] ?? 0) - (TIER_RANK[a.capabilityTier] ?? 0);
      if (tierDiff !== 0) return tierDiff;
      // Prefer non-dated aliases (e.g., "claude-sonnet-4-6" over "claude-sonnet-4-6-20250514")
      const aIsDated = /\d{8}$/.test(a.modelId) ? 1 : 0;
      const bIsDated = /\d{8}$/.test(b.modelId) ? 1 : 0;
      if (aIsDated !== bIsDated) return aIsDated - bIsDated;
      return (a.costTier ?? "").localeCompare(b.costTier ?? "");
    });
    return chatProfiles[0]!.modelId;
  }

  // Fall back to DiscoveredModel
  const discovered = await prisma.discoveredModel.findFirst({
    where: {
      providerId,
      NOT: { modelId: { contains: "embed" } },
    },
    orderBy: { modelId: "asc" },
    select: { modelId: true },
  });

  if (discovered && !NON_CHAT_PATTERN.test(discovered.modelId)) {
    return discovered.modelId;
  }

  // No model found — return empty string; callProvider will surface the error
  return "";
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

  // Build ordered list: selected endpoint first, then fallbacks
  const chain = [decision.selectedEndpoint, ...decision.fallbackChain];

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const uniqueChain = chain.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const attempts: Array<{ endpointId: string; error: string }> = [];

  for (let i = 0; i < uniqueChain.length; i++) {
    const endpointId = uniqueChain[i]!;

    // Look up the provider row to get its display name for downgrade messages
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: endpointId },
      select: { providerId: true, name: true },
    });

    if (!provider) {
      attempts.push({ endpointId, error: "provider not found in database" });
      continue;
    }

    // Resolve modelId via ModelProfile → DiscoveredModel chain
    const modelId = await resolveModelId(endpointId);

    try {
      const result = await callProvider(
        endpointId,
        modelId,
        messages,
        systemPrompt,
        tools,
      );

      const downgraded = i > 0;
      return {
        providerId: endpointId,
        modelId,
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
      attempts.push({ endpointId, error: errMsg });
      console.warn(`[callWithFallbackChain] ${endpointId} failed: ${errMsg}`);

      // Handle specific error types — update provider status accordingly
      if (e instanceof InferenceError) {
        if (e.code === "rate_limit") {
          // Mark degraded (not disabled) — stays in the routing pool at lower priority.
          // This differs from callWithFailover which fully disables on rate_limit.
          await prisma.modelProvider
            .update({
              where: { providerId: endpointId },
              data: { status: "degraded" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${endpointId} degraded:`,
                err,
              ),
            );
        } else if (e.code === "model_not_found" || e.code === "auth") {
          // Mark disabled — requires human review before re-enabling.
          // "model_not_found" means the model was removed on the provider side.
          // "auth" means credentials are invalid.
          await prisma.modelProvider
            .update({
              where: { providerId: endpointId },
              data: { status: "disabled" },
            })
            .catch((err) =>
              console.error(
                `[callWithFallbackChain] failed to mark ${endpointId} disabled:`,
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
