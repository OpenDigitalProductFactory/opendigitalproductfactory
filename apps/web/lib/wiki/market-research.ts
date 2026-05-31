// Market-research producer (BI-8A58C65A, EP-CORPUS-BOOTSTRAP) — slice A.
//
// Composes a web search (`searchPublicWeb`, Brave) with an LLM synthesis pass
// into cited prose findings the corpus enrichment pipeline can ingest as
// `origin="research"`, `trust="researched"` (→ draft for review, per BI-1378).
//
// This is the reusable ENGINE. The scheduled + approval-gated orchestration
// (founder decision on open-Q#4) wires it: a periodic cadence proposes a run,
// a human approves, and only then does execution call runMarketResearch() →
// enrichOrgCorpus(). Nothing here fires on its own.
//
// Guardrail: synthesis is grounded ONLY in the retrieved snippets and must not
// fabricate figures — research is low-trust (grade C) and always lands as a
// reviewable draft.

import { searchPublicWeb, type NormalizedSearchResult } from "@/lib/public-web-tools";
import { createProductionInference } from "@/lib/wiki/inference-adapter";
import type { InferenceCallable } from "@/lib/wiki/proposal";

const DEFAULT_MAX_SOURCES = 6;
const MAX_SNIPPET_CHARS = 400;

export type MarketResearchInput = {
  organizationId: string;
  /** What to research, e.g. "competitive landscape for an HVAC contractor in Austin TX". */
  query: string;
  /** Cap on web sources fed to synthesis. Default 6. */
  maxSources?: number;
};

export type ResearchSource = { title: string; url: string };

export type MarketResearchResult = {
  /** Synthesised markdown findings + a Sources section. Ready for enrichOrgCorpus. */
  text: string;
  /** Cited sources backing the findings. */
  sources: ResearchSource[];
  /** True when there was nothing to ingest (no sources, or blank synthesis). */
  empty: boolean;
};

export type MarketResearchDeps = {
  /** Web search; defaults to Brave-backed searchPublicWeb. Injectable for tests. */
  search?: (query: string) => Promise<NormalizedSearchResult[]>;
  /** LLM synthesis; defaults to the production inference adapter. Injectable for tests. */
  infer?: InferenceCallable;
};

export function buildResearchPrompt(
  query: string,
  results: NormalizedSearchResult[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a market-research analyst producing a concise briefing for a business's own knowledge base.",
    "Synthesise findings ONLY from the provided search results. Do NOT invent or fabricate facts, figures, market sizes, or competitor names that are not supported by the snippets.",
    "When the evidence is thin or uncertain, say so plainly rather than guessing.",
    "Write 2-5 short markdown paragraphs (or bullets) of grounded findings. Do not add a sources list — that is appended separately.",
  ].join(" ");

  const sourceBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet.slice(0, MAX_SNIPPET_CHARS)}`)
    .join("\n\n");

  const userPrompt = [
    `Research topic: ${query}`,
    "",
    "Search results to synthesise (cite nothing beyond these):",
    "",
    sourceBlock,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export async function runMarketResearch(
  input: MarketResearchInput,
  deps: MarketResearchDeps = {},
): Promise<MarketResearchResult> {
  const search = deps.search ?? searchPublicWeb;
  const infer = deps.infer ?? createProductionInference({ taskType: "market_research" });
  const maxSources = input.maxSources ?? DEFAULT_MAX_SOURCES;

  // Fail-open: a search outage must not throw into the caller (scheduled job).
  const found = await search(input.query).catch(() => [] as NormalizedSearchResult[]);
  const results = found.slice(0, maxSources);
  if (results.length === 0) {
    return { text: "", sources: [], empty: true };
  }

  const { systemPrompt, userPrompt } = buildResearchPrompt(input.query, results);
  const prose = (await infer({ tier: "reasoning", systemPrompt, userPrompt }).catch(() => "")).trim();

  const sources: ResearchSource[] = results.map((r) => ({ title: r.title, url: r.url }));
  if (prose.length === 0) {
    // No grounded synthesis → nothing to ingest. Never fabricate to fill the gap.
    return { text: "", sources, empty: true };
  }

  const sourcesSection = sources.map((s) => `- [${s.title}](${s.url})`).join("\n");
  const text = `${prose}\n\n## Sources\n${sourcesSection}`;
  return { text, sources, empty: false };
}
