// Epic → portfolio proposals (BI-A73A7DA3, design §5.2). An epic's portfolio is
// proposed from its own items' links first; a text match against the portfolio
// vocabulary is only a fallback, and it never decides alone. A proposal is
// advice: nothing is written until a person confirms it.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

export const EPIC_PORTFOLIO_CONFIDENCE_VALUES = ["high", "low"] as const;
export type EpicPortfolioConfidence = (typeof EPIC_PORTFOLIO_CONFIDENCE_VALUES)[number];

/** Share and size an item majority needs before a proposal is high confidence. */
const HIGH_SHARE = 0.8;
const HIGH_MIN_ITEMS = 3;

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "because", "before", "being", "between", "both", "but", "can", "each",
  "every", "for", "from", "has", "have", "into", "its", "make", "more", "must", "not", "one", "only", "other",
  "over", "same", "should", "that", "the", "their", "them", "then", "there", "these", "they", "this", "through",
  "under", "until", "what", "when", "where", "which", "while", "with", "without", "work", "would", "your",
]);

function terms(text: string | null | undefined): Set<string> {
  const words = (text ?? "").toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

export type PortfolioVocabulary = Map<string, Set<string>>;

/** One vocabulary per portfolio, from its description and the taxonomy nodes bound to it. */
export function buildPortfolioVocabulary(sources: Array<{ portfolioId: string; text: string | null }>): PortfolioVocabulary {
  const vocabulary: PortfolioVocabulary = new Map();
  for (const source of sources) {
    const set = vocabulary.get(source.portfolioId) ?? new Set<string>();
    for (const term of terms(source.text)) set.add(term);
    vocabulary.set(source.portfolioId, set);
  }
  return vocabulary;
}

export type EpicProposalInput = {
  epicId: string;
  title: string;
  description: string | null;
  /** Each item's portfolio through its non-epic links; null when it has none. */
  itemPortfolioIds: Array<string | null>;
};

export type EpicPortfolioProposal = {
  epicId: string;
  portfolioId: string | null;
  confidence: EpicPortfolioConfidence;
  evidence: {
    attributedItems: number;
    tally: Record<string, number>;
    textMatches: Record<string, string[]>;
  };
};

function leader(scores: Record<string, number>): string | null {
  const ranked = Object.entries(scores).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  return ranked[0]![0];
}

export function proposeEpicPortfolio(epic: EpicProposalInput, vocabulary: PortfolioVocabulary): EpicPortfolioProposal {
  const tally: Record<string, number> = {};
  for (const portfolioId of epic.itemPortfolioIds) {
    if (portfolioId) tally[portfolioId] = (tally[portfolioId] ?? 0) + 1;
  }
  const attributedItems = Object.values(tally).reduce((sum, count) => sum + count, 0);

  const epicTerms = terms(`${epic.title} ${epic.description ?? ""}`);
  const textMatches: Record<string, string[]> = {};
  for (const [portfolioId, portfolioTerms] of vocabulary) {
    const matched = [...epicTerms].filter((term) => portfolioTerms.has(term)).sort();
    if (matched.length > 0) textMatches[portfolioId] = matched;
  }
  const evidence = { attributedItems, tally, textMatches };

  const itemLeader = leader(tally);
  if (itemLeader && tally[itemLeader]! >= HIGH_MIN_ITEMS && tally[itemLeader]! / attributedItems >= HIGH_SHARE) {
    return { epicId: epic.epicId, portfolioId: itemLeader, confidence: "high", evidence };
  }
  const textLeader = leader(Object.fromEntries(Object.entries(textMatches).map(([id, matched]) => [id, matched.length])));
  return { epicId: epic.epicId, portfolioId: itemLeader ?? textLeader, confidence: "low", evidence };
}
