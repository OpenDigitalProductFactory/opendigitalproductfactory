// apps/web/lib/decision/band-telemetry.ts
//
// BI-3217C098 (spec slice 6). The instrument for tuning the uncertain band.
//
// BI-2107B5D2 made the data exist — real margins, band edges, and causes are
// recorded per decision instead of four synthetic constants. This reads them.
//
// TWO numbers, because either alone lies:
//
//   • The MARGIN HISTOGRAM shows where decisions land. Tuning is working when
//     mass moves AWAY from the middle, toward both ends.
//   • The REVERSAL RATE per band shows whether the confident calls deserved
//     their confidence. Without it, narrowing the band until the middle stops
//     firing looks identical to improving separation — and that is the failure
//     the spec names: a band that never fires is trivially achievable and
//     proves nothing.
//
// A falling middle band with a rising reversal rate is a REGRESSION, and only
// the second number can say so.

import type { DecisionVerdict } from "./option-scoring";

/** One recorded decision, as the ledger stores it. */
export interface BandTelemetryRow {
  /** Real separation between the winner and runner-up. Null on rows that weighed nothing. */
  margin: number | null;
  verdict: DecisionVerdict | null;
  /** The upper band edge in force for this decision, so a moved bar is visible. */
  bandUpper: number | null;
  /** The kernel's pick, when the gate scored real options. */
  recommendedOptionId: string | null;
  /** What the human actually chose, once their response resolved to a scored option. */
  chosenOptionId: string | null;
}

export interface HistogramBucket {
  /** Inclusive lower edge of the bucket. */
  from: number;
  /** Exclusive upper edge. */
  to: number;
  count: number;
  /** True when this bucket sits below the upper band edge — i.e. inside the uncertain band. */
  insideUncertainBand: boolean;
}

export interface BandReversal {
  verdict: DecisionVerdict;
  /** Rows where both the kernel's pick and the human's choice are known. */
  judged: number;
  /** Of those, how many the human decided differently. */
  reversed: number;
  /** reversed / judged, or null when nothing could be judged. */
  rate: number | null;
}

export interface BandTelemetry {
  buckets: HistogramBucket[];
  /** Share of decisions that landed in the uncertain band. The number to drive down. */
  uncertainShare: number | null;
  reversals: BandReversal[];
  /** Rows the histogram could use (a margin was recorded). */
  scored: number;
  /** Rows seen in total, so a small sample is never mistaken for a settled picture. */
  total: number;
  /** The most common upper band edge across the population, for marking the chart. */
  typicalBandUpper: number | null;
}

const DEFAULT_BUCKET_COUNT = 10;

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * A reversal is only countable where BOTH the kernel's pick and the human's
 * choice are known. Rows missing either are reported as unjudged rather than
 * counted as agreement — treating silence as assent is how a reversal rate
 * flatters itself.
 */
function reversalFor(verdict: DecisionVerdict, rows: BandTelemetryRow[]): BandReversal {
  const judgable = rows.filter(
    (r) => r.verdict === verdict && r.recommendedOptionId && r.chosenOptionId,
  );
  const reversed = judgable.filter((r) => r.chosenOptionId !== r.recommendedOptionId).length;
  return {
    verdict,
    judged: judgable.length,
    reversed,
    rate: judgable.length === 0 ? null : reversed / judgable.length,
  };
}

export function computeBandTelemetry(
  rows: BandTelemetryRow[],
  options: { bucketCount?: number } = {},
): BandTelemetry {
  const bucketCount = Math.max(1, options.bucketCount ?? DEFAULT_BUCKET_COUNT);
  const scored = rows.filter((r) => typeof r.margin === "number" && Number.isFinite(r.margin));
  const margins = scored.map((r) => r.margin as number);
  const typicalBandUpper = mode(
    rows.map((r) => r.bandUpper).filter((v): v is number => typeof v === "number"),
  );

  const max = margins.length ? Math.max(...margins) : 0;
  // Always span at least the band edge, so the uncertain region is visible even
  // when every recorded decision cleared it.
  const span = Math.max(max, typicalBandUpper ?? 0) || 1;
  const width = span / bucketCount;

  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const from = i * width;
    const to = i === bucketCount - 1 ? span : (i + 1) * width;
    return {
      from,
      to,
      count: 0,
      // A bucket counts as inside the band when its lower edge is below the bar.
      insideUncertainBand: typicalBandUpper != null && from < typicalBandUpper,
    };
  });

  for (const margin of margins) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(margin / width)));
    buckets[index]!.count += 1;
  }

  const uncertainCount = rows.filter((r) => r.verdict === "uncertain").length;

  return {
    buckets,
    uncertainShare: rows.length === 0 ? null : uncertainCount / rows.length,
    reversals: (["proceed", "decline", "uncertain"] as const).map((v) => reversalFor(v, rows)),
    scored: scored.length,
    total: rows.length,
    typicalBandUpper,
  };
}

/**
 * Is a later population better tuned than an earlier one?
 *
 * Deliberately strict: a smaller uncertain share only counts as improvement
 * when the confident calls did NOT get worse. Narrowing the bar shrinks the
 * middle band without improving separation, and this is what refuses to call
 * that progress.
 */
export function isBetterTuned(before: BandTelemetry, after: BandTelemetry): {
  improved: boolean;
  reason: string;
} {
  if (before.uncertainShare == null || after.uncertainShare == null) {
    return { improved: false, reason: "Not enough decisions to compare." };
  }
  if (after.uncertainShare >= before.uncertainShare) {
    return { improved: false, reason: "The uncertain band did not shrink." };
  }
  const assuredRate = (t: BandTelemetry) => {
    const judged = t.reversals
      .filter((r) => r.verdict !== "uncertain")
      .reduce((acc, r) => ({ judged: acc.judged + r.judged, reversed: acc.reversed + r.reversed }), { judged: 0, reversed: 0 });
    return judged.judged === 0 ? null : judged.reversed / judged.judged;
  };
  const beforeRate = assuredRate(before);
  const afterRate = assuredRate(after);
  if (beforeRate == null || afterRate == null) {
    return {
      improved: false,
      reason: "The band shrank, but no confident call could be judged — a narrower bar cannot be told from better separation.",
    };
  }
  if (afterRate > beforeRate) {
    return {
      improved: false,
      reason: "The band shrank while confident calls were reversed more often — the bar moved, the separation did not.",
    };
  }
  return { improved: true, reason: "The uncertain band shrank and confident calls held." };
}
