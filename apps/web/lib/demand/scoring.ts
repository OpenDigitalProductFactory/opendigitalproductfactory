// Pure demand-scoring engine — no server imports. Safe in tests and client
// components. EP-DEMAND-MGMT Phase 1.
//
// The market lesson (Airfocus / Jira Product Discovery / Aha! / Productboard all
// converge here): persist the scoring INPUTS as first-class fields and COMPUTE
// the score with a pluggable framework, so an org can switch RICE <-> WSJF <->
// value/effort <-> weighted without a schema change, and every score stays
// explainable and re-computable.
//
// Spec: docs/superpowers/specs/2026-07-10-demand-management-design.md §5.
// Default framework RICE was WWMD-confirmed (ledger DI-4CEA0F5FACCE).

import { type DemandScoreFramework } from "../explore/backlog";

/**
 * T-shirt effortSize -> numeric job size (relative points). Used to derive
 * `jobSize` (the WSJF/RICE denominator) when an explicit value is absent, so
 * items sized only with the existing t-shirt field can still be scored.
 */
export const EFFORT_SIZE_TO_JOB_SIZE: Record<string, number> = {
  small: 1,
  medium: 3,
  large: 8,
  xlarge: 20,
};

/**
 * The raw scoring inputs. All optional/nullable — a caller supplies whatever it
 * has. `occurrenceCount` and `effortSize` are the existing backlog fields used
 * as fallbacks to derive `reach` and `jobSize` respectively.
 */
export type DemandScoreInputs = {
  reach?: number | null;
  impact?: number | null;
  confidence?: number | null;
  businessValue?: number | null;
  timeCriticality?: number | null;
  riskOpportunity?: number | null;
  jobSize?: number | null;
  // Existing-field fallbacks for derivation:
  occurrenceCount?: number | null;
  effortSize?: string | null;
};

/** Per-input weights for the generic `weighted` framework. */
export type DemandScoreWeights = {
  reach?: number;
  impact?: number;
  confidence?: number;
  businessValue?: number;
  timeCriticality?: number;
  riskOpportunity?: number;
  /** Cost axis — subtracted (multiplied by jobSize). */
  jobSize?: number;
};

export const DEFAULT_WEIGHTED_WEIGHTS: Required<DemandScoreWeights> = {
  reach: 0.5,
  impact: 2,
  confidence: 1,
  businessValue: 1,
  timeCriticality: 1,
  riskOpportunity: 1,
  jobSize: 1,
};

export type DemandScoreResult = {
  /** null when required inputs are missing — never a fabricated 0. */
  score: number | null;
  framework: DemandScoreFramework;
  /** Per-term contribution, for the "Why this score" drill-in. */
  contributions: Record<string, number>;
  /** Required inputs that were absent (why score is null / degraded). */
  missing: string[];
};

/** reach, falling back to the recurrence signal already collected at intake. */
export function resolveReach(inputs: DemandScoreInputs): number | null {
  if (typeof inputs.reach === "number") return inputs.reach;
  if (typeof inputs.occurrenceCount === "number") return inputs.occurrenceCount;
  return null;
}

/** jobSize, falling back to the t-shirt effortSize projection. */
export function resolveJobSize(inputs: DemandScoreInputs): number | null {
  if (typeof inputs.jobSize === "number" && inputs.jobSize > 0) return inputs.jobSize;
  if (inputs.effortSize && inputs.effortSize in EFFORT_SIZE_TO_JOB_SIZE) {
    return EFFORT_SIZE_TO_JOB_SIZE[inputs.effortSize];
  }
  return null;
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute a demand score under the given framework. Pure and idempotent.
 * Returns `score: null` (not 0) when a required input is missing, so the caller
 * can distinguish "unscored" from "scored zero".
 */
export function computeDemandScore(
  inputs: DemandScoreInputs,
  framework: DemandScoreFramework,
  weights: DemandScoreWeights = DEFAULT_WEIGHTED_WEIGHTS,
): DemandScoreResult {
  const reach = resolveReach(inputs);
  const jobSize = resolveJobSize(inputs);
  const impact = num(inputs.impact);
  const confidence = num(inputs.confidence);
  const businessValue = num(inputs.businessValue);
  const timeCriticality = num(inputs.timeCriticality);
  const riskOpportunity = num(inputs.riskOpportunity);

  const missing: string[] = [];
  const need = (label: string, v: number | null): number | null => {
    if (v === null) missing.push(label);
    return v;
  };

  switch (framework) {
    case "rice": {
      const r = need("reach", reach);
      const i = need("impact", impact);
      const c = need("confidence", confidence);
      const e = need("jobSize", jobSize);
      if (r === null || i === null || c === null || e === null || e === 0) {
        return { score: null, framework, contributions: {}, missing };
      }
      const score = (r * i * c) / e;
      return {
        score: round(score),
        framework,
        contributions: { reach: r, impact: i, confidence: c, jobSize: e },
        missing,
      };
    }
    case "wsjf": {
      const bv = need("businessValue", businessValue);
      const tc = need("timeCriticality", timeCriticality);
      const ro = need("riskOpportunity", riskOpportunity);
      const e = need("jobSize", jobSize);
      if (bv === null || tc === null || ro === null || e === null || e === 0) {
        return { score: null, framework, contributions: {}, missing };
      }
      const costOfDelay = bv + tc + ro;
      const score = costOfDelay / e;
      return {
        score: round(score),
        framework,
        contributions: { businessValue: bv, timeCriticality: tc, riskOpportunity: ro, costOfDelay, jobSize: e },
        missing,
      };
    }
    case "value_effort": {
      // value = impact when present, else businessValue; effort = jobSize.
      const value = impact !== null ? impact : businessValue;
      if (value === null) missing.push("impact|businessValue");
      const e = need("jobSize", jobSize);
      if (value === null || e === null || e === 0) {
        return { score: null, framework, contributions: {}, missing };
      }
      const score = value / e;
      return {
        score: round(score),
        framework,
        contributions: { value, jobSize: e },
        missing,
      };
    }
    case "weighted": {
      const w = { ...DEFAULT_WEIGHTED_WEIGHTS, ...weights };
      const terms: Record<string, number> = {};
      let total = 0;
      let any = false;
      const add = (label: string, v: number | null, weight: number, cost = false) => {
        if (v === null) return;
        any = true;
        const contribution = (cost ? -1 : 1) * weight * v;
        terms[label] = round(contribution);
        total += contribution;
      };
      add("reach", reach, w.reach);
      add("impact", impact, w.impact);
      add("confidence", confidence, w.confidence);
      add("businessValue", businessValue, w.businessValue);
      add("timeCriticality", timeCriticality, w.timeCriticality);
      add("riskOpportunity", riskOpportunity, w.riskOpportunity);
      add("jobSize", jobSize, w.jobSize, true);
      if (!any) {
        missing.push("any-input");
        return { score: null, framework, contributions: {}, missing };
      }
      return { score: round(total), framework, contributions: terms, missing };
    }
    default: {
      // Exhaustiveness guard — a new framework value must handle its case.
      const _never: never = framework;
      return { score: null, framework: _never, contributions: {}, missing: ["unknown-framework"] };
    }
  }
}

/** The four value×effort quadrants used by the Demand board matrix (Phase 2). */
export type ValueEffortQuadrant = "quick_win" | "big_bet" | "fill_in" | "time_sink";

/**
 * Classify an item onto the value×effort 2×2 given midpoint thresholds.
 * High value + low effort = quick_win; high/high = big_bet; low/low = fill_in;
 * low value + high effort = time_sink.
 */
export function classifyValueEffort(
  value: number,
  effort: number,
  valueMid: number,
  effortMid: number,
): ValueEffortQuadrant {
  const highValue = value >= valueMid;
  const highEffort = effort >= effortMid;
  if (highValue && !highEffort) return "quick_win";
  if (highValue && highEffort) return "big_bet";
  if (!highValue && !highEffort) return "fill_in";
  return "time_sink";
}
