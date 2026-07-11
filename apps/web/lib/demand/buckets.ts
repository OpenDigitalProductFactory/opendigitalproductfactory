// Pure investment-bucket helpers — no server imports. Safe in tests and client
// components. EP-DEMAND-MGMT Phase 3.
//
// Run / Grow / Transform is the strategic-balance axis: demand is prioritized
// against a target allocation so near-term work can't silently consume the whole
// budget. Spec: docs/superpowers/specs/2026-07-10-demand-management-design.md §8.

import { INVESTMENT_BUCKET_VALUES, type InvestmentBucket } from "../explore/backlog";

/** Default allocation when a portfolio hasn't set its own (the 70/20/10 split). */
export const DEFAULT_BUCKET_TARGETS: Record<InvestmentBucket, number> = {
  run: 70,
  grow: 20,
  transform: 10,
};

export const BUCKET_LABELS: Record<InvestmentBucket, string> = {
  run: "Run",
  grow: "Grow",
  transform: "Transform",
};

/**
 * Default bucket for an item from its work-type: keep-the-lights-on work (bug /
 * chore / refactor) is Run; new capability (feature) is Grow; everything else is
 * left unclassified for an operator to place.
 */
export function deriveBucket(workType: string | null | undefined): InvestmentBucket | null {
  switch (workType) {
    case "bug":
    case "chore":
    case "refactor":
      return "run";
    case "feature":
      return "grow";
    default:
      return null;
  }
}

export type BucketWeightedItem = {
  investmentBucket: string | null;
  workType: string | null;
  /** Effort weight (points). Falls back to 1 so unsized items still count once. */
  weight?: number | null;
};

export type BucketMix = {
  /** Effort-weighted total per bucket. */
  byBucket: Record<InvestmentBucket, number>;
  total: number;
  /** Actual share (percent, 0..100) per bucket. */
  sharePct: Record<InvestmentBucket, number>;
  /** Items with no derivable bucket. */
  unclassified: number;
};

function normalizeBucket(item: BucketWeightedItem): InvestmentBucket | null {
  const explicit = (INVESTMENT_BUCKET_VALUES as readonly string[]).includes(item.investmentBucket ?? "")
    ? (item.investmentBucket as InvestmentBucket)
    : null;
  return explicit ?? deriveBucket(item.workType);
}

/** Effort-weighted actual mix across a set of items. */
export function computeBucketMix(items: BucketWeightedItem[]): BucketMix {
  const byBucket: Record<InvestmentBucket, number> = { run: 0, grow: 0, transform: 0 };
  let unclassified = 0;
  for (const item of items) {
    const bucket = normalizeBucket(item);
    const weight = typeof item.weight === "number" && item.weight > 0 ? item.weight : 1;
    if (bucket === null) {
      unclassified += weight;
      continue;
    }
    byBucket[bucket] += weight;
  }
  const total = byBucket.run + byBucket.grow + byBucket.transform;
  const sharePct: Record<InvestmentBucket, number> = { run: 0, grow: 0, transform: 0 };
  if (total > 0) {
    for (const b of INVESTMENT_BUCKET_VALUES) {
      sharePct[b] = Math.round((byBucket[b] / total) * 1000) / 10;
    }
  }
  return { byBucket, total, sharePct, unclassified };
}

export type BucketBalanceRow = {
  bucket: InvestmentBucket;
  actualPct: number;
  targetPct: number;
  /** actual - target (negative = under-invested vs target). */
  deltaPct: number;
  starved: boolean;
};

/**
 * Compare the actual mix against targets. A bucket is "starved" when it is more
 * than `tolerancePct` below its target — the signal that near-term work is
 * crowding out (typically) Transform.
 */
export function bucketBalance(
  mix: BucketMix,
  targets: Partial<Record<InvestmentBucket, number>> | null | undefined,
  tolerancePct = 5,
): BucketBalanceRow[] {
  const resolvedTargets = { ...DEFAULT_BUCKET_TARGETS, ...(targets ?? {}) };
  return INVESTMENT_BUCKET_VALUES.map((bucket) => {
    const actualPct = mix.sharePct[bucket];
    const targetPct = resolvedTargets[bucket];
    const deltaPct = Math.round((actualPct - targetPct) * 10) / 10;
    return {
      bucket,
      actualPct,
      targetPct,
      deltaPct,
      starved: mix.total > 0 && deltaPct < -tolerancePct,
    };
  });
}
