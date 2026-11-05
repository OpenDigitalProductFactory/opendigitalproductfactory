// Operating criteria for continual improvement (BI-CE564FBB), as consumed by
// the probe stage (BI-B8DAEB71).
//
// LOCAL STUB. The Continual Improvement Manager work (BI-CE564FBB) owns these
// criteria as typed configuration per layer; when its module lands, this file
// is replaced by an import of it and the call sites keep the same shape. The
// defaults follow that item. Two values it leaves unnamed (`minShapeRunsPerWeek`
// and `costFloorPerOccurrence`) are conservative placeholders, not doctrine.
//
// Why criteria at all: Harness² gets most of its gain from the first round
// (K=1); K=5 added +3.3 for about five times the spend. A probe is worth
// running only when the miss recurs, its shape repeats, and the probe costs
// less than the miss would.

export type ImprovementCriteria = {
  /** The miss recurs in at least this many distinct runs or sessions in the window. */
  minDistinctRuns: number;
  /** Its shape runs at least this often a week (placeholder until BI-CE564FBB names M). */
  minShapeRunsPerWeek: number;
  /** AI turns spent per occurrence must clear this floor (placeholder until BI-CE564FBB names it). */
  costFloorPerOccurrence: number;
  /** Expected savings = frequency × cost × this horizon. */
  savingsHorizonWeeks: number;
  /** Two consecutive KEEP_BASE verdicts park a miss until new evidence. */
  parkAfterConsecutiveKeepBase: number;
  /** K>1 only after KEEP_BASE on a miss in this cost percentile or above. */
  escalationCostPercentile: number;
};

export const DEFAULT_IMPROVEMENT_CRITERIA: ImprovementCriteria = {
  minDistinctRuns: 2,
  minShapeRunsPerWeek: 3,
  costFloorPerOccurrence: 1,
  savingsHorizonWeeks: 4,
  parkAfterConsecutiveKeepBase: 2,
  escalationCostPercentile: 0.9,
};

export type SkipReason =
  | "single-run"
  | "shape-too-rare"
  | "below-floor"
  | "parked-after-keep-base"
  | "inside-control-limits"
  | "spend-exceeds-savings"
  | "budget-exhausted";

export type Screening = { eligible: true; k: number } | { eligible: false; reason: SkipReason };

export function expectedSavings(
  input: { occurrencesPerWeek: number; costPerOccurrence: number },
  criteria: ImprovementCriteria = DEFAULT_IMPROVEMENT_CRITERIA,
): number {
  return input.occurrencesPerWeek * input.costPerOccurrence * criteria.savingsHorizonWeeks;
}

/** K=1 first; escalate only when K=1 kept the base and the miss stays in the top cost decile. */
export function probeK(
  input: { consecutiveKeepBase: number; costPercentile: number },
  criteria: ImprovementCriteria = DEFAULT_IMPROVEMENT_CRITERIA,
): number {
  return input.consecutiveKeepBase >= 1 && input.costPercentile >= criteria.escalationCostPercentile ? 2 : 1;
}

export function screenCandidate(
  input: {
    distinctRuns: number;
    shapeRunsPerWeek: number;
    costPerOccurrence: number;
    occurrencesPerWeek: number;
    probeCost: number;
    consecutiveKeepBase: number;
    /** Null until control limits are evaluated (BI-CE564FBB Control); null never skips. */
    insideControlLimits: boolean | null;
    costPercentile?: number;
  },
  criteria: ImprovementCriteria = DEFAULT_IMPROVEMENT_CRITERIA,
): Screening {
  if (input.distinctRuns < criteria.minDistinctRuns) return { eligible: false, reason: "single-run" };
  if (input.shapeRunsPerWeek < criteria.minShapeRunsPerWeek) return { eligible: false, reason: "shape-too-rare" };
  if (input.costPerOccurrence < criteria.costFloorPerOccurrence) return { eligible: false, reason: "below-floor" };
  if (input.consecutiveKeepBase >= criteria.parkAfterConsecutiveKeepBase) return { eligible: false, reason: "parked-after-keep-base" };
  if (input.insideControlLimits === true) return { eligible: false, reason: "inside-control-limits" };
  if (input.probeCost > expectedSavings(input, criteria)) return { eligible: false, reason: "spend-exceeds-savings" };
  return { eligible: true, k: probeK({ consecutiveKeepBase: input.consecutiveKeepBase, costPercentile: input.costPercentile ?? 0 }, criteria) };
}
