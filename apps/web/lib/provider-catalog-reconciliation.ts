import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";

export type ProviderCatalogStrategy = "provider_api" | "known_catalog";

export type OfficialCatalogCandidate = {
  modelId: string;
  sourceUrl: string;
  deprecated: boolean;
};

export type ProviderCatalogSignal = {
  providerId: string;
  strategy: ProviderCatalogStrategy;
  officialCandidates: OfficialCatalogCandidate[];
  newCandidates: OfficialCatalogCandidate[];
  deprecatedKnown: OfficialCatalogCandidate[];
  warning?: string;
  error?: string;
};

const OPENAI_MODELS_INDEX_URL = "https://developers.openai.com/api/docs/models/all";
const OPENAI_MODELS_BASE_URL = "https://developers.openai.com/api/docs/models";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getProviderCatalogStrategy(providerId: string): ProviderCatalogStrategy {
  return KNOWN_PROVIDER_MODELS[providerId] ? "known_catalog" : "provider_api";
}

export function parseOpenAiModelsIndex(html: string): OfficialCatalogCandidate[] {
  const matches = [...html.matchAll(/\/api\/docs\/models\/([a-z0-9.-]+)/gi)];
  const seen = new Set<string>();
  const candidates: OfficialCatalogCandidate[] = [];

  for (const match of matches) {
    const modelId = match[1];
    if (!modelId || modelId === "all" || seen.has(modelId)) continue;
    seen.add(modelId);

    const start = Math.max(0, match.index ?? 0);
    const nearby = html.slice(start, start + 240);

    candidates.push({
      modelId,
      sourceUrl: `${OPENAI_MODELS_BASE_URL}/${modelId}`,
      deprecated: /deprecated/i.test(nearby),
    });
  }

  return candidates;
}

function filterOfficialCandidatesForProvider(
  providerId: string,
  candidates: OfficialCatalogCandidate[],
): OfficialCatalogCandidate[] {
  if (providerId === "codex") {
    return candidates.filter((candidate) => /codex/i.test(candidate.modelId));
  }
  return [];
}

export async function collectProviderCatalogSignals(
  providerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderCatalogSignal> {
  const strategy = getProviderCatalogStrategy(providerId);
  if (strategy !== "known_catalog") {
    return {
      providerId,
      strategy,
      officialCandidates: [],
      newCandidates: [],
      deprecatedKnown: [],
    };
  }

  const knownModels = KNOWN_PROVIDER_MODELS[providerId] ?? [];
  const knownIds = new Set(knownModels.map((model) => model.modelId));

  if (providerId !== "codex") {
    return {
      providerId,
      strategy,
      officialCandidates: [],
      newCandidates: [],
      deprecatedKnown: [],
    };
  }

  try {
    const res = await fetchImpl(OPENAI_MODELS_INDEX_URL, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        providerId,
        strategy,
        officialCandidates: [],
        newCandidates: [],
        deprecatedKnown: [],
        error: `Official catalog fetch failed with HTTP ${res.status}`,
      };
    }

    const html = await res.text();
    const officialCandidates = filterOfficialCandidatesForProvider(providerId, parseOpenAiModelsIndex(html));
    const newCandidates = officialCandidates.filter((candidate) => !knownIds.has(candidate.modelId));
    const deprecatedKnown = officialCandidates.filter(
      (candidate) => knownIds.has(candidate.modelId) && candidate.deprecated,
    );
    const signal: ProviderCatalogSignal = {
      providerId,
      strategy,
      officialCandidates,
      newCandidates,
      deprecatedKnown,
    };
    const warning = formatCatalogSignalWarning(signal);
    return warning ? { ...signal, warning } : signal;
  } catch (err) {
    return {
      providerId,
      strategy,
      officialCandidates: [],
      newCandidates: [],
      deprecatedKnown: [],
      error: err instanceof Error ? err.message : "Official catalog fetch failed",
    };
  }
}

export function formatCatalogSignalWarning(
  signal: Pick<ProviderCatalogSignal, "providerId" | "newCandidates" | "deprecatedKnown" | "error">,
): string | null {
  if (signal.error) {
    return `Official catalog check unavailable for ${signal.providerId}: ${signal.error}`;
  }
  if (signal.newCandidates.length > 0) {
    return `Official docs list ${signal.newCandidates.length} additional candidate model${signal.newCandidates.length !== 1 ? "s" : ""} not yet routed: ${signal.newCandidates.map((candidate) => candidate.modelId).join(", ")}`;
  }
  if (signal.deprecatedKnown.length > 0) {
    return `Official docs mark ${signal.deprecatedKnown.length} routed model${signal.deprecatedKnown.length !== 1 ? "s" : ""} as deprecated: ${signal.deprecatedKnown.map((candidate) => candidate.modelId).join(", ")}`;
  }
  return null;
}

export function summarizeCatalogSignal(signal: ProviderCatalogSignal): string {
  const pieces = [`${signal.providerId}: strategy=${signal.strategy}`];
  if (signal.newCandidates.length > 0) {
    pieces.push(`new=${signal.newCandidates.map((candidate) => candidate.modelId).join(",")}`);
  }
  if (signal.deprecatedKnown.length > 0) {
    pieces.push(`deprecated=${signal.deprecatedKnown.map((candidate) => candidate.modelId).join(",")}`);
  }
  if (signal.error) {
    pieces.push(`error=${signal.error}`);
  }
  return pieces.join(" ");
}

export function detectOpenAiModelDeprecation(html: string, modelId: string): boolean {
  const regex = new RegExp(`${escapeRegex(modelId)}[\\s\\S]{0,240}deprecated`, "i");
  return regex.test(html);
}
