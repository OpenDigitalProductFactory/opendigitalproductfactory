// Onboarding market & scope capture (BI-34936764, EP-CORPUS-BOOTSTRAP).
//
// Captures the operator's market/scope context — competitive landscape, market
// size / TAM, differentiators, positioning — and feeds it into the org WWWD
// corpus as first-party material. Per design open-Q#6 this is NARRATIVE-first:
// the answers become an org-overlay stance page (the corpus is the natural home
// for this kind of judgment), with no new structured BusinessContext columns.
//
// Indexing goes through the enrichment pipeline via the injectable `enrich`
// seam (the route wires it to enrichOrgCorpus(origin="data-entry",
// trust="first-party")). Per the founder's draft-by-default decision (BI-1378),
// first-party enrichment still lands as a draft for review.

export type MarketContextAnswers = {
  /** Who we compete with and how the field is shaped. */
  competitiveLandscape?: string | null;
  /** Total addressable market / market sizing notes. */
  marketSize?: string | null;
  /** What sets us apart. */
  differentiators?: string | null;
  /** Where we play / target-segment posture. */
  positioning?: string | null;
};

/** Seam to the enrichment pipeline (wired by the route to enrichOrgCorpus). */
export type MarketContextEnricher = (args: {
  organizationId: string;
  text: string;
  title: string;
}) => Promise<void>;

export type CaptureMarketContextInput = {
  organizationId: string;
  answers: MarketContextAnswers;
};

export type CaptureMarketContextDeps = {
  enrich?: MarketContextEnricher;
};

export type CaptureMarketContextResult = {
  /** True when at least one answer had content. */
  captured: boolean;
  /** Section labels included in the narrative (for UI confirmation). */
  sections: string[];
  /** True when the enrichment seam was invoked. */
  enrichmentQueued: boolean;
};

export const MARKET_CONTEXT_TITLE = "Market and competitive context";

const FIELDS: Array<{ key: keyof MarketContextAnswers; label: string }> = [
  { key: "competitiveLandscape", label: "Competitive landscape" },
  { key: "marketSize", label: "Market size" },
  { key: "differentiators", label: "What sets us apart" },
  { key: "positioning", label: "Positioning" },
];

export function buildMarketNarrative(answers: MarketContextAnswers): {
  text: string;
  sections: string[];
} {
  const sections: string[] = [];
  const blocks: string[] = [];
  for (const { key, label } of FIELDS) {
    const value = (answers[key] ?? "").trim();
    if (value.length === 0) continue;
    sections.push(label);
    blocks.push(`## ${label}\n\n${value}`);
  }
  const text = blocks.length > 0 ? `# ${MARKET_CONTEXT_TITLE}\n\n${blocks.join("\n\n")}` : "";
  return { text, sections };
}

export async function captureMarketContext(
  input: CaptureMarketContextInput,
  deps: CaptureMarketContextDeps = {},
): Promise<CaptureMarketContextResult> {
  const { text, sections } = buildMarketNarrative(input.answers);
  if (text.length === 0) {
    return { captured: false, sections: [], enrichmentQueued: false };
  }

  let enrichmentQueued = false;
  if (deps.enrich) {
    await deps.enrich({ organizationId: input.organizationId, text, title: MARKET_CONTEXT_TITLE });
    enrichmentQueued = true;
  }

  return { captured: true, sections, enrichmentQueued };
}
