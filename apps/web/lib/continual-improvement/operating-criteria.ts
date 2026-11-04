// The operating criteria of continual improvement (BI-CE564FBB, epic
// EP-C00F61F4; spec docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md,
// "Continual improvement as a standing operation").
//
// The Continual Improvement Manager (AGT-908) runs the improvement register by
// these rules; the harness-evolution loop (BI-49BC21C1, BI-B8DAEB71) consumes
// them before it spends a probe. They are typed configuration, not prose: every
// value has a default, a bound, and an optional per-layer override.
//
// Why criteria at all. Harness² (arXiv 2610.14224) measured diminishing
// returns: round one (K=1, ~8× tokens) gave most of the gain, K=5 (~40×) added
// only +3.3, gains were largest on weak models and near-empty harnesses, and
// paid off only on task types repeated many times. So the loop spends only
// where the expected return justifies it, and records why it did not elsewhere.
//
// The steps map onto DMAIC: Define = screenCandidate (eligibility), Measure /
// Analyze = rankAndSelect (Pareto, weighted by the human → AI → code ladder),
// Improve = the probe the caller runs for each `worked` row, Control =
// evaluateControlLimits (common cause gets no edits; special cause is acted on).
//
// Pure: no reads, no writes, no clock.

import { isRecord } from "@/lib/shared/coerce";

export type LadderRung = "human" | "ai" | "code";

/** The model class a room's executor ran on; weak and local models gain most. */
export type ModelClass = "weak" | "local" | "strong" | "unknown";

export type ImprovementCriteria = {
  /** Define: the miss recurs in at least this many distinct runs or sessions in the window. */
  minDistinctRuns: number;
  /** Define: its shape runs at least this often a week (repetition is what pays back). */
  minShapeRunsPerWeek: number;
  /** Define: AI-turn-equivalent cost per occurrence must clear this floor. */
  costFloorPerOccurrence: number;
  /** Budget: expected savings = frequency × cost × this horizon. */
  savingsHorizonWeeks: number;
  /** Stop: this many consecutive KEEP_BASE verdicts park a miss until new evidence. */
  parkAfterConsecutiveKeepBase: number;
  /** Budget: K>1 only after KEEP_BASE on a miss in this cost percentile or above. */
  escalationCostPercentile: number;
  /** Budget: the most candidate pairs ever probed for one miss in one cycle. */
  maxK: number;
  /** Budget: a probe may spend at most this share of the miss's expected savings. */
  probeSpendToSavingsRatio: number;
  /** Prioritize: the share of eligible misses, highest priority first, worked per cycle. */
  paretoTopShare: number;
  /** Prioritize: a miss that loads a person outranks one that loads an AI, which outranks code. */
  ladderWeights: Record<LadderRung, number>;
  /** Bias: rooms run by weak or local models get budget first. */
  weakModelBoost: number;
  /** Bias: shapes with little harness yet get budget first. */
  sparseHarnessBoost: number;
  /** Control: control limits sit this many standard deviations from the centre line. */
  controlSigma: number;
  /** Control: this many consecutive points above the centre line is a special cause. */
  controlRunLength: number;
};

export const DEFAULT_IMPROVEMENT_CRITERIA: ImprovementCriteria = {
  minDistinctRuns: 2,
  minShapeRunsPerWeek: 3,
  costFloorPerOccurrence: 1,
  savingsHorizonWeeks: 4,
  parkAfterConsecutiveKeepBase: 2,
  escalationCostPercentile: 0.9,
  maxK: 2,
  probeSpendToSavingsRatio: 1,
  paretoTopShare: 0.2,
  ladderWeights: { human: 3, ai: 2, code: 1 },
  weakModelBoost: 1.5,
  sparseHarnessBoost: 1.25,
  controlSigma: 3,
  controlRunLength: 8,
};

type NumericKey = Exclude<keyof ImprovementCriteria, "ladderWeights">;

/** Every number is clamped here; a configured value outside its range is pulled back in. */
export const IMPROVEMENT_CRITERIA_BOUNDS: Record<NumericKey, { min: number; max: number; integer?: boolean }> = {
  minDistinctRuns: { min: 2, max: 20, integer: true },
  minShapeRunsPerWeek: { min: 0, max: 500 },
  costFloorPerOccurrence: { min: 0, max: 1000 },
  savingsHorizonWeeks: { min: 1, max: 52 },
  parkAfterConsecutiveKeepBase: { min: 1, max: 10, integer: true },
  escalationCostPercentile: { min: 0.5, max: 1 },
  maxK: { min: 1, max: 5, integer: true },
  probeSpendToSavingsRatio: { min: 0.1, max: 1 },
  paretoTopShare: { min: 0.05, max: 1 },
  weakModelBoost: { min: 1, max: 5 },
  sparseHarnessBoost: { min: 1, max: 5 },
  controlSigma: { min: 1, max: 6 },
  controlRunLength: { min: 5, max: 12, integer: true },
};

export type SkipReason =
  | "single-run"
  | "shape-too-rare"
  | "below-floor"
  | "parked-after-keep-base"
  | "inside-control-limits"
  | "spend-exceeds-savings"
  | "budget-exhausted"
  | "outside-pareto-cut";

export type Screening = { eligible: true; k: number } | { eligible: false; reason: SkipReason };

function applyOverrides(target: ImprovementCriteria, raw: Record<string, unknown>): ImprovementCriteria {
  const next = { ...target, ladderWeights: { ...target.ladderWeights } };
  for (const key of Object.keys(IMPROVEMENT_CRITERIA_BOUNDS) as NumericKey[]) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const bound = IMPROVEMENT_CRITERIA_BOUNDS[key];
    const clamped = Math.min(bound.max, Math.max(bound.min, value));
    next[key] = bound.integer ? Math.round(clamped) : clamped;
  }
  const weights = raw.ladderWeights;
  if (isRecord(weights)) {
    const proposed = { ...next.ladderWeights };
    for (const rung of ["human", "ai", "code"] as const) {
      const value = weights[rung];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) proposed[rung] = Math.min(10, value);
    }
    // The ladder is the doctrine, not a tunable: a weighting that would rank
    // code-load above human-load is refused and the current weights kept.
    if (proposed.human > proposed.ai && proposed.ai > proposed.code) next.ladderWeights = proposed;
  }
  return next;
}

/**
 * Typed configuration from a task's untyped `taskConfig.criteria`. Unknown
 * keys are ignored, numbers are clamped, and `layers[<layer>]` overrides the
 * base for that layer (ring-0, an archetype, an executor layer).
 */
export function resolveImprovementCriteria(raw: unknown, layer?: string): ImprovementCriteria {
  if (!isRecord(raw)) return DEFAULT_IMPROVEMENT_CRITERIA;
  let criteria = applyOverrides(DEFAULT_IMPROVEMENT_CRITERIA, raw);
  const layers = raw.layers;
  if (layer && isRecord(layers) && isRecord(layers[layer])) criteria = applyOverrides(criteria, layers[layer]);
  return criteria;
}

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
  const escalate = input.consecutiveKeepBase >= 1 && input.costPercentile >= criteria.escalationCostPercentile;
  return Math.min(criteria.maxK, escalate ? 2 : 1);
}

export type ScreenInput = {
  distinctRuns: number;
  shapeRunsPerWeek: number;
  costPerOccurrence: number;
  occurrencesPerWeek: number;
  /** One probe pair's cost, in the same AI-turn-equivalent unit as costPerOccurrence. */
  probeCost: number;
  consecutiveKeepBase: number;
  /** Null until control limits are evaluated; null never skips. */
  insideControlLimits: boolean | null;
  costPercentile?: number;
};

/** Define: the first reason a miss is not worth working, or its K. Checks run cheapest first. */
export function screenCandidate(input: ScreenInput, criteria: ImprovementCriteria = DEFAULT_IMPROVEMENT_CRITERIA): Screening {
  if (input.distinctRuns < criteria.minDistinctRuns) return { eligible: false, reason: "single-run" };
  if (input.shapeRunsPerWeek < criteria.minShapeRunsPerWeek) return { eligible: false, reason: "shape-too-rare" };
  if (input.costPerOccurrence < criteria.costFloorPerOccurrence) return { eligible: false, reason: "below-floor" };
  if (input.consecutiveKeepBase >= criteria.parkAfterConsecutiveKeepBase) return { eligible: false, reason: "parked-after-keep-base" };
  if (input.insideControlLimits === true) return { eligible: false, reason: "inside-control-limits" };
  const k = probeK({ consecutiveKeepBase: input.consecutiveKeepBase, costPercentile: input.costPercentile ?? 0 }, criteria);
  if (input.probeCost * k > expectedSavings(input, criteria) * criteria.probeSpendToSavingsRatio) {
    return { eligible: false, reason: "spend-exceeds-savings" };
  }
  return { eligible: true, k };
}

// ── Control: a c-chart over a miss key's per-period counts ──────────────────

export type ControlChart = {
  centerLine: number;
  ucl: number;
  lcl: number;
  /** The latest point is beyond the upper limit, or ends a run above the centre line. */
  specialCause: boolean;
  /** The latest point exceeds the configured target rate. */
  aboveTarget: boolean;
  /** True: common cause only, no edits. Null: too few periods to judge. */
  insideControlLimits: boolean | null;
};

const MIN_BASELINE_PERIODS = 3;

/**
 * Counts per period, oldest first; the last is the period being judged. Misses
 * are counts of rare events, so a c-chart (Poisson: sigma = sqrt(centre)) is
 * the standard chart. Special cause is Western Electric rule 1 (a point beyond
 * the limit) or rule 2 (a run on one side of the centre line).
 */
export function evaluateControlLimits(
  counts: readonly number[],
  opts: { sigma?: number; runLength?: number; targetRate?: number | null } = {},
): ControlChart {
  const sigma = opts.sigma ?? DEFAULT_IMPROVEMENT_CRITERIA.controlSigma;
  const runLength = opts.runLength ?? DEFAULT_IMPROVEMENT_CRITERIA.controlRunLength;
  const baseline = counts.slice(0, -1);
  const latest = counts.at(-1) ?? 0;
  const aboveTarget = opts.targetRate != null && latest > opts.targetRate;
  if (baseline.length < MIN_BASELINE_PERIODS) {
    return { centerLine: 0, ucl: 0, lcl: 0, specialCause: false, aboveTarget, insideControlLimits: null };
  }
  const centerLine = baseline.reduce((sum, n) => sum + n, 0) / baseline.length;
  const spread = sigma * Math.sqrt(centerLine);
  const ucl = centerLine + spread;
  const lcl = Math.max(0, centerLine - spread);
  const run = counts.slice(-runLength);
  const runAbove = counts.length >= runLength && run.every((n) => n > centerLine);
  const specialCause = latest > ucl || runAbove;
  return { centerLine, ucl, lcl, specialCause, aboveTarget, insideControlLimits: !specialCause && !aboveTarget };
}

/** Recurrence checks after a verdict, in days (BI-D33412EA): a fix that recurs is reopened. */
export const CONTROL_CHECK_DAYS = [7, 14] as const;

const MS_PER_DAY = 86_400_000;

/** When a verdict's control checks fall due, as ISO timestamps, earliest first. */
export function controlCheckDueDates(decidedAt: Date): string[] {
  return CONTROL_CHECK_DAYS.map((days) => new Date(decidedAt.getTime() + days * MS_PER_DAY).toISOString());
}

// ── Prioritize and budget: one cycle's ledger ───────────────────────────────

export type CycleCandidate = ScreenInput & {
  missKey: string;
  roomRef: string;
  rung: LadderRung;
  modelClass: ModelClass;
  /** The room's shape carries little harness yet (few stage briefs, skills or gates). */
  sparseHarness: boolean;
};

export type LedgerRow = { missKey: string; roomRef: string; k: number; priority: number; expectedSavings: number };

/** What one cycle did with every miss it considered: the TaskRun records this. */
export type ImprovementCycleLedger = {
  eligible: LedgerRow[];
  worked: LedgerRow[];
  skipped: { missKey: string; roomRef: string; reason: SkipReason }[];
  probeSpend: number;
};

function byKey(a: { missKey: string; roomRef: string }, b: { missKey: string; roomRef: string }): number {
  return a.missKey.localeCompare(b.missKey) || a.roomRef.localeCompare(b.roomRef);
}

/** Share of candidates whose cost per occurrence is at or below this one's. */
function costPercentiles(candidates: readonly CycleCandidate[]): number[] {
  const costs = candidates.map((c) => c.costPerOccurrence);
  return costs.map((cost) => costs.filter((other) => other <= cost).length / costs.length);
}

/**
 * Screen every candidate, rank the eligible by expected savings × ladder
 * weight × bias, work the Pareto vital few within the probe budget, and record
 * a reason for every miss not worked. Deterministic for the same input set.
 */
export function rankAndSelect(
  candidates: readonly CycleCandidate[],
  criteria: ImprovementCriteria = DEFAULT_IMPROVEMENT_CRITERIA,
  budget: { probeBudget?: number } = {},
): ImprovementCycleLedger {
  const percentiles = costPercentiles(candidates);
  const eligible: LedgerRow[] = [];
  const skipped: ImprovementCycleLedger["skipped"] = [];
  candidates.forEach((candidate, index) => {
    const screening = screenCandidate({ ...candidate, costPercentile: candidate.costPercentile ?? percentiles[index] }, criteria);
    if (!screening.eligible) {
      skipped.push({ missKey: candidate.missKey, roomRef: candidate.roomRef, reason: screening.reason });
      return;
    }
    const savings = expectedSavings(candidate, criteria);
    const bias = (candidate.modelClass === "weak" || candidate.modelClass === "local" ? criteria.weakModelBoost : 1)
      * (candidate.sparseHarness ? criteria.sparseHarnessBoost : 1);
    eligible.push({
      missKey: candidate.missKey,
      roomRef: candidate.roomRef,
      k: screening.k,
      priority: savings * criteria.ladderWeights[candidate.rung] * bias,
      expectedSavings: savings,
    });
  });
  eligible.sort((a, b) => b.priority - a.priority || byKey(a, b));

  const probeCostOf = new Map(candidates.map((c) => [`${c.missKey}\u0000${c.roomRef}`, c.probeCost]));
  const vitalFew = Math.max(1, Math.ceil(eligible.length * criteria.paretoTopShare));
  const worked: LedgerRow[] = [];
  let probeSpend = 0;
  eligible.forEach((row, rank) => {
    if (rank >= vitalFew) {
      skipped.push({ missKey: row.missKey, roomRef: row.roomRef, reason: "outside-pareto-cut" });
      return;
    }
    const cost = (probeCostOf.get(`${row.missKey}\u0000${row.roomRef}`) ?? 0) * row.k;
    if (budget.probeBudget !== undefined && probeSpend + cost > budget.probeBudget) {
      skipped.push({ missKey: row.missKey, roomRef: row.roomRef, reason: "budget-exhausted" });
      return;
    }
    probeSpend += cost;
    worked.push(row);
  });
  skipped.sort(byKey);
  return { eligible, worked, skipped, probeSpend };
}
