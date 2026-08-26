/**
 * Freshness discipline for acquired external reference corpora.
 *
 * `LicenseRequirementReference` and `TaxJurisdictionReference` are not authored
 * by DPF — they mirror what an outside authority publishes. A mirror is only as
 * good as its last confirmation against the source, so every row carries a
 * verification timestamp and a staleness budget.
 *
 * The budget has a ceiling. An operator-set maximum of 90 days applies to every
 * acquired reference: a row may be re-verified more often than that, never less.
 * Before this module the clock was decorative — `staleAfterDays` was stored,
 * defaulted to 180, and read by nothing, so a mirror could drift arbitrarily far
 * from its authority while still being served as `sourceKind: "official"`.
 */

/**
 * The operator-set ceiling on how long any acquired reference may go
 * unverified. Founder-directed 2026-08-25. A per-row budget may be shorter
 * where the authority changes faster; it may never be longer.
 */
export const MAX_REFERENCE_STALE_DAYS = 90;

/** Clamp a proposed staleness budget to the ceiling. */
export function clampStaleAfterDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return MAX_REFERENCE_STALE_DAYS;
  return Math.min(Math.floor(days), MAX_REFERENCE_STALE_DAYS);
}

/**
 * `unverified` is deliberately distinct from `stale`. A row that has never been
 * confirmed against its authority did not go fresh and then expire — it was never
 * established, and a surface must not imply otherwise by counting a budget from
 * a date that does not exist.
 */
export type ReferenceFreshnessState = "fresh" | "stale" | "unverified";

export type ReferenceFreshness = {
  state: ReferenceFreshnessState;
  /** Whole days since the row was last confirmed; null when never confirmed. */
  ageDays: number | null;
  /** When re-verification falls due; null when never confirmed. */
  dueAt: Date | null;
  /** The budget actually applied, after clamping to the ceiling. */
  budgetDays: number;
  /** True when this row must not be presented as current. */
  requiresReverification: boolean;
};

export type ReferenceFreshnessInput = {
  /** Last confirmation against the authority. The authoritative signal. */
  lastVerifiedAt?: Date | string | null;
  /**
   * When the row was first researched. A weaker signal than verification and
   * used only as a fallback, so a researched-but-unconfirmed row still ages.
   */
  lastResearchedAt?: Date | string | null;
  staleAfterDays?: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve the freshness of one acquired reference row.
 *
 * `now` is injected rather than read from the clock so callers — and tests —
 * evaluate a whole corpus against a single instant.
 */
export function referenceFreshness(
  input: ReferenceFreshnessInput,
  now: Date = new Date(),
): ReferenceFreshness {
  const budgetDays = clampStaleAfterDays(input.staleAfterDays ?? MAX_REFERENCE_STALE_DAYS);
  const anchor = toDate(input.lastVerifiedAt) ?? toDate(input.lastResearchedAt);

  if (!anchor) {
    return {
      state: "unverified",
      ageDays: null,
      dueAt: null,
      budgetDays,
      requiresReverification: true,
    };
  }

  const ageDays = Math.floor((now.getTime() - anchor.getTime()) / MS_PER_DAY);
  const dueAt = new Date(anchor.getTime() + budgetDays * MS_PER_DAY);
  const stale = ageDays >= budgetDays;

  return {
    state: stale ? "stale" : "fresh",
    ageDays,
    dueAt,
    budgetDays,
    requiresReverification: stale,
  };
}

/**
 * Plain-language freshness for an operator-facing surface.
 *
 * A stale or unverified reference states its own limit rather than being
 * presented as settled fact — the same standard the platform holds its
 * coworkers to when they cite a source.
 */
export function describeReferenceFreshness(freshness: ReferenceFreshness): string {
  switch (freshness.state) {
    case "unverified":
      return "Never confirmed against the issuing authority — treat as unconfirmed.";
    case "stale":
      return `Last confirmed ${freshness.ageDays} days ago, past the ${freshness.budgetDays}-day limit — treat as unconfirmed until re-checked.`;
    case "fresh":
      return `Confirmed ${freshness.ageDays} days ago.`;
  }
}
