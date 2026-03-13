// apps/web/lib/ai-profiling.ts
import type { ProviderRow } from "./ai-provider-types";

export function rankProvidersByCost(
  providers: Pick<ProviderRow, "providerId" | "status" | "outputPricePerMToken">[],
): string[] {
  return providers
    .filter((p) => p.status === "active")
    .sort((a, b) => (a.outputPricePerMToken ?? Infinity) - (b.outputPricePerMToken ?? Infinity))
    .map((p) => p.providerId);
}

export function buildProfilingPrompt(
  models: { modelId: string; providerName: string; rawMetadata: Record<string, unknown> }[],
): string {
  return `You are helping non-technical business users understand AI models.

For each model below, produce a JSON array of profiles. Each profile has:
- friendlyName: a memorable 2-3 word name (e.g. "Deep Thinker", "Fast Worker", "Budget Helper")
- summary: one plain-English sentence describing what it's best at
- capabilityTier: one of "deep-thinker", "fast-worker", "specialist", "budget", "embedding"
- costTier: one of "$", "$$", "$$$", "$$$$"
- bestFor: array of 3-5 use cases in plain English
- avoidFor: array of 2-3 anti-patterns in plain English
- contextWindow: human-friendly string like "Large (200K tokens)" or "Standard (8K tokens)" or null if unknown
- speedRating: "Fast", "Moderate", or "Slow" (or null if unknown)
- modelId: the exact model ID string

Use language a non-technical manager would understand. No jargon. No marketing language.

Respond ONLY with a valid JSON array. No markdown, no explanation.

Models to profile:
${JSON.stringify(models.map((m) => ({ modelId: m.modelId, provider: m.providerName, metadata: m.rawMetadata })), null, 2)}`;
}

export type ProfileResult = {
  modelId: string;
  friendlyName: string;
  summary: string;
  capabilityTier: string;
  costTier: string;
  bestFor: string[];
  avoidFor: string[];
  contextWindow: string | null;
  speedRating: string | null;
};

export function parseProfilingResponse(text: string): ProfileResult[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is ProfileResult =>
    typeof item === "object" && item !== null
    && typeof (item as Record<string, unknown>).modelId === "string"
    && typeof (item as Record<string, unknown>).friendlyName === "string"
    && typeof (item as Record<string, unknown>).summary === "string"
  );
}
