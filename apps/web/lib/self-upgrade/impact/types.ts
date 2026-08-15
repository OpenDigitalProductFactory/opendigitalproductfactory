// apps/web/lib/self-upgrade/impact/types.ts
//
// Public types for the on-demand upgrade impact summary (BI-C26F7EE1).
//
// The summary answers, in plain operator-facing language tailored to THIS
// install: "what's in this update?" — most impactful first. Advisory only.
// It does not gate apply / defer; it informs that decision.
//
// Pipeline (deterministic classification + LLM phrasing, no fabrication):
//   git log <currentLineageSha>..<targetSha>
//     → ConventionalCommit per commit (type / scope / breaking / subject / pr#)
//     → ImpactCategoryCounts (totals for the headline)
//     → ImpactItem[] scored against install signals (top-N by impact)
//     → PhrasedImpactSummary (LLM headline + per-item plain-language phrasing)
//
// The deterministic shape (this file) is what tests exercise and what the LLM
// is grounded against. The LLM only PHRASES — never invents items, never
// reorders, never changes categories.

/**
 * Operator-facing change buckets.
 *
 * `other` is the honest fallback for a subject we could not parse — NOT a
 * catch-all. Docs, dependency bumps and internal maintenance each get their own
 * bucket because they are different operator concerns: a dependency bump is a
 * supply-chain event worth a second look, a docs commit is not, and lumping
 * them together made the panel render a wall of identical "OTHER" badges while
 * the headline could plainly say "1 documentation addition and 4 dependency
 * updates".
 */
export type ChangeCategory =
  | "breaking"
  | "security"
  | "feature"
  | "fix"
  | "performance"
  | "dependency"
  | "documentation"
  | "maintenance"
  | "other";

export type ConventionalType =
  | "feat"
  | "fix"
  | "perf"
  | "refactor"
  | "docs"
  | "chore"
  | "test"
  | "build"
  | "ci"
  | "style"
  | "revert"
  | "unknown";

/** A single commit parsed from `git log` over the lineage range. */
export type RawCommit = {
  /** Full 40-hex SHA. */
  sha: string;
  /** First line of the commit message. */
  subject: string;
  /** Author display name (best effort; empty if unavailable). */
  author: string;
  /** ISO-8601 author date. */
  authorDate: string;
  /** Files touched by this commit (best effort; empty when --name-only unavailable). */
  files: string[];
};

/** A RawCommit parsed under the Conventional Commits 1.0.0 grammar. */
export type ParsedCommit = RawCommit & {
  type: ConventionalType;
  /** Optional scope from `type(scope): subject`. */
  scope: string | null;
  /** True if the subject carries `!` before the colon OR a `BREAKING CHANGE:` trailer. */
  breaking: boolean;
  /** The description after `type(scope):` — falls back to the full subject for unparseable lines. */
  description: string;
  /** Pull request number parsed from a trailing `(#1234)`, when present. */
  prNumber: number | null;
  /** Category derived from `type` + `breaking`. */
  category: ChangeCategory;
};

/**
 * Per-category tallies. Every key is present on a freshly computed summary, but
 * summaries persisted under the earlier (breaking/feature/fix/performance/other)
 * taxonomy are replayed from JSON and carry only those keys — every reader must
 * therefore treat a missing key as 0 rather than assume presence.
 */
export type ImpactCategoryCounts = {
  breaking: number;
  security: number;
  feature: number;
  fix: number;
  performance: number;
  dependency: number;
  documentation: number;
  maintenance: number;
  other: number;
  total: number;
};

/**
 * Compact impact digest for the Latest Run card — the human-readable "what did
 * this run carry?" the raw SHA pair never gave. Assembled server-side from the
 * run's own persisted summary; kept minimal so it serializes cleanly into the
 * client component. See `loadRunImpactDigest` in ./index.
 */
export type RunImpactDigest = {
  counts: ImpactCategoryCounts;
  /** LLM one-line headline, or null when phrasing was skipped/empty. */
  headline: string | null;
};

/**
 * Signals about THIS install used to score relevance of each upstream commit.
 *
 * These are intentionally narrow and observable from live DB state — no
 * inferred capability lists, no guesses. If a signal is unavailable we say so
 * (`null` / empty array) rather than fabricate one.
 */
export type InstallSignals = {
  /** StorefrontConfig.archetypeId — single source of truth for portal industry. */
  archetypeId: string | null;
  /** Organization.industry (derived from archetype; kept for legacy match). */
  industry: string | null;
  /**
   * Touched-area hints from active customization. Currently sourced from
   * FeaturePack entries (manifest paths, sourceVertical, applicableVerticals).
   * Overlap on these paths is both a relevance signal AND a §5.0 merge-conflict
   * early warning — surfaced via the `touchesCustomizations` callout.
   */
  customizationPaths: string[];
  /** Industry/vertical tags of the install's customizations, for relevance match. */
  customizationVerticals: string[];
  /** Open PortfolioQualityIssue summaries — substrings the LLM has NOT seen. */
  openIssueKeywords: string[];
  /** PR labels (lowercased) considered relevant to this install (best effort). */
  relevantPrLabels: string[];
};

/** GitHub enrichment for a single PR, fetched when reachable. */
export type PrEnrichment = {
  prNumber: number;
  title: string | null;
  /** Lowercased label slugs. */
  labels: string[];
  /** Truncated body (first ~400 chars, plain text). */
  body: string | null;
};

export type ImpactItemReason =
  | { kind: "archetype-match"; archetypeId: string }
  | { kind: "industry-match"; industry: string }
  | { kind: "customization-path-overlap"; paths: string[] }
  | { kind: "customization-vertical-match"; vertical: string }
  | { kind: "open-issue-keyword"; keyword: string }
  | { kind: "breaking-change" }
  | { kind: "base-weight" };

/** One scored item — what the LLM phrases. */
export type ImpactItem = {
  sha: string;
  /** Subject after stripping `type(scope):` prefix; never empty. */
  description: string;
  /** Conventional type. */
  type: ConventionalType;
  /** Optional scope (e.g. "self-upgrade"). */
  scope: string | null;
  category: ChangeCategory;
  breaking: boolean;
  prNumber: number | null;
  /** PR title from GitHub enrichment, when reachable. */
  prTitle: string | null;
  /** PR labels from GitHub enrichment (lowercased). */
  prLabels: string[];
  /** Final impact score (higher = more impactful for this install). */
  score: number;
  /** Why this item scored where it did — surfaced verbatim, not phrased. */
  reasons: ImpactItemReason[];
  /** True when this commit touches an install-customized path. */
  touchesCustomizations: boolean;
};

/**
 * Result of the LLM phrasing pass. Strictly grounded against the
 * ImpactItem[] above — the LLM is forbidden from adding items, reordering,
 * or changing categories.
 */
export type PhrasedImpactSummary = {
  /** Plain-English one-line headline for the operator (no SHAs / paths). */
  headline: string;
  /**
   * Per-item plain-language line. Order MUST match the input ImpactItem[]
   * positionally. Length MUST equal items.length.
   */
  itemPhrasings: Array<{
    /** One-line plain description of what changed. */
    description: string;
    /** One-line "why this matters for this install" — empty when no per-item reason. */
    whyRelevant: string;
  }>;
  /**
   * Whole-summary callout for commits that touch install customizations,
   * doubling as a §5.0 merge-conflict early warning. Empty when none.
   */
  touchesCustomizationsCallout: string;
};

/**
 * The full operator-facing summary. The deterministic shape is the contract;
 * `phrased` is the rendered text layer.
 */
export type UpgradeImpactSummary = {
  /** SHA the running build absorbed from upstream (lineage marker). */
  currentLineageSha: string;
  /** Upstream SHA the summary is comparing against. */
  targetSha: string;
  /** Counts feed the headline ("3 new features, 5 fixes, 1 breaking change"). */
  counts: ImpactCategoryCounts;
  /** Top-N most relevant items. Default cap is 8; full list is on the foldable view. */
  topItems: ImpactItem[];
  /** Full list of every commit in the range (foldable / on-demand). */
  allItems: ImpactItem[];
  /** Phrased layer — empty `headline` indicates the LLM call was skipped/failed. */
  phrased: PhrasedImpactSummary | null;
  /** Provenance for the operator — were PR titles/labels reachable? */
  enrichment: {
    githubReachable: boolean;
    prsEnriched: number;
  };
  /** Marker the summary was generated against now-current state. */
  generatedAt: string;
  /** True when the summary was served from cache. */
  fromCache: boolean;
};

export type SummaryNotApplicable =
  | { ok: false; reason: "no-lineage"; detail: string }
  | { ok: false; reason: "no-target"; detail: string }
  | { ok: false; reason: "lineage-equals-target"; detail: string }
  | { ok: false; reason: "git-log-failed"; detail: string };

export type SummaryResult =
  | { ok: true; summary: UpgradeImpactSummary }
  | SummaryNotApplicable;

/** Default cap for top-N items surfaced before "show all". */
export const DEFAULT_TOP_N = 8;
