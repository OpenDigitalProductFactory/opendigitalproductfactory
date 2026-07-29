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
  /** The latest matching evidence a human reviewed. Drafts never qualify. */
  reviewedBaseline?: {
    text: string;
    reviewedAt: Date;
  } | null;
};

export type ResearchConfidence = "low" | "medium" | "high";

export type ResearchSource = {
  title: string;
  url: string;
  retrievedAt: Date;
};

export type MarketResearchResult = {
  /** Synthesised markdown findings + a Sources section. Ready for enrichOrgCorpus. */
  text: string;
  /** Cited sources backing the findings. */
  sources: ResearchSource[];
  /** True when there was nothing to ingest (no sources, or blank synthesis). */
  empty: boolean;
  emptyReason:
    | "no-results"
    | "provider-unavailable"
    | "synthesis-empty"
    | null;
  confidence: ResearchConfidence;
  comparison: {
    kind: "first-run" | "changed-since";
    baselineReviewedAt: Date | null;
  };
};

export type MarketResearchDeps = {
  /** Web search; defaults to Brave-backed searchPublicWeb. Injectable for tests. */
  search?: (query: string) => Promise<NormalizedSearchResult[]>;
  /** LLM synthesis; defaults to the production inference adapter. Injectable for tests. */
  infer?: InferenceCallable;
  now?: () => Date;
};

export function buildResearchPrompt(
  query: string,
  results: NormalizedSearchResult[],
  reviewedBaseline?: { text: string; reviewedAt: Date } | null,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a market-research analyst producing a concise briefing for a business's own knowledge base.",
    "Synthesise findings ONLY from the provided search results. Do NOT invent or fabricate facts, figures, market sizes, or competitor names that are not supported by the snippets.",
    "When the evidence is thin or uncertain, say so plainly rather than guessing.",
    reviewedBaseline
      ? "Report only material findings that are new, changed, contradicted, or newly uncertain since the supplied last reviewed baseline; do not repeat unchanged background."
      : "This is the first reviewed baseline, so summarise the current evidence without implying a prior change.",
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
    ...(reviewedBaseline
      ? [
          "",
          `Last reviewed baseline (${reviewedBaseline.reviewedAt.toISOString()}):`,
          "",
          reviewedBaseline.text.slice(0, 12_000),
        ]
      : []),
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
  const retrievedAt = (deps.now ?? (() => new Date()))();
  const comparison = input.reviewedBaseline
    ? {
        kind: "changed-since" as const,
        baselineReviewedAt: input.reviewedBaseline.reviewedAt,
      }
    : { kind: "first-run" as const, baselineReviewedAt: null };

  // Fail-open into an explicit outcome: an outage must not throw into the
  // scheduled job, but it must remain distinguishable from a valid empty search.
  let found: NormalizedSearchResult[];
  try {
    found = await search(input.query);
  } catch {
    return {
      text: "",
      sources: [],
      empty: true,
      emptyReason: "provider-unavailable",
      confidence: "low",
      comparison,
    };
  }
  const results = found.slice(0, maxSources);
  if (results.length === 0) {
    return {
      text: "",
      sources: [],
      empty: true,
      emptyReason: "no-results",
      confidence: "low",
      comparison,
    };
  }

  const { systemPrompt, userPrompt } = buildResearchPrompt(
    input.query,
    results,
    input.reviewedBaseline,
  );
  const prose = (await infer({ tier: "reasoning", systemPrompt, userPrompt }).catch(() => "")).trim();

  const sources: ResearchSource[] = results.map((r) => ({
    title: r.title,
    url: r.url,
    retrievedAt,
  }));
  const confidence: ResearchConfidence =
    sources.length >= 4 ? "high" : sources.length >= 2 ? "medium" : "low";
  if (prose.length === 0) {
    // No grounded synthesis → nothing to ingest. Never fabricate to fill the gap.
    return {
      text: "",
      sources,
      empty: true,
      emptyReason: "synthesis-empty",
      confidence,
      comparison,
    };
  }

  const sourcesSection = sources.map((s) => `- [${s.title}](${s.url})`).join("\n");
  const heading =
    comparison.kind === "changed-since"
      ? "## Changed since the last reviewed research"
      : "## Current findings (first reviewed baseline)";
  const text = `${heading}\n\n${prose}\n\n## Sources\n${sourcesSection}`;
  return {
    text,
    sources,
    empty: false,
    emptyReason: null,
    confidence,
    comparison,
  };
}
