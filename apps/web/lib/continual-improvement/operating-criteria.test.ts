import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPROVEMENT_CRITERIA,
  controlCheckDueDates,
  evaluateControlLimits,
  expectedSavings,
  probeK,
  rankAndSelect,
  resolveImprovementCriteria,
  screenCandidate,
  type CycleCandidate,
} from "./operating-criteria";

// BI-CE564FBB: the operating criteria the CI Manager runs the register by.
// Harness² measured diminishing returns (K=1 most of the gain; K=5 ~40× for
// +3.3), so effort goes only where the expected return justifies it.

const base = {
  distinctRuns: 3,
  shapeRunsPerWeek: 10,
  costPerOccurrence: 4,
  occurrencesPerWeek: 5,
  probeCost: 4,
  consecutiveKeepBase: 0,
  insideControlLimits: null as boolean | null,
};

describe("screenCandidate (the Define step)", () => {
  it("passes a recurring, repeated, costly miss whose probe costs less than it saves", () => {
    expect(screenCandidate(base)).toEqual({ eligible: true, k: 1 });
  });

  it("names the first reason a miss is skipped", () => {
    expect(screenCandidate({ ...base, distinctRuns: 1 })).toEqual({ eligible: false, reason: "single-run" });
    expect(screenCandidate({ ...base, shapeRunsPerWeek: 1 })).toEqual({ eligible: false, reason: "shape-too-rare" });
    expect(screenCandidate({ ...base, costPerOccurrence: 0.5 })).toEqual({ eligible: false, reason: "below-floor" });
    expect(screenCandidate({ ...base, consecutiveKeepBase: 2 })).toEqual({ eligible: false, reason: "parked-after-keep-base" });
    expect(screenCandidate({ ...base, insideControlLimits: true })).toEqual({ eligible: false, reason: "inside-control-limits" });
    expect(screenCandidate({ ...base, occurrencesPerWeek: 0.1, costPerOccurrence: 1, probeCost: 4 })).toEqual({
      eligible: false,
      reason: "spend-exceeds-savings",
    });
  });

  it("does not skip a room whose control limits have not been evaluated", () => {
    expect(screenCandidate({ ...base, insideControlLimits: null }).eligible).toBe(true);
  });
});

describe("expectedSavings and probeK (the Budget rule)", () => {
  it("is frequency × cost × horizon", () => {
    expect(expectedSavings({ occurrencesPerWeek: 5, costPerOccurrence: 4 }, DEFAULT_IMPROVEMENT_CRITERIA)).toBe(5 * 4 * 4);
  });

  it("starts at one and escalates only after KEEP_BASE on a top-decile-cost miss", () => {
    expect(probeK({ consecutiveKeepBase: 0, costPercentile: 0.99 })).toBe(1);
    expect(probeK({ consecutiveKeepBase: 1, costPercentile: 0.5 })).toBe(1);
    expect(probeK({ consecutiveKeepBase: 1, costPercentile: 0.95 })).toBe(2);
  });

  it("never escalates past maxK", () => {
    const criteria = { ...DEFAULT_IMPROVEMENT_CRITERIA, maxK: 1 };
    expect(probeK({ consecutiveKeepBase: 1, costPercentile: 0.99 }, criteria)).toBe(1);
  });
});

describe("resolveImprovementCriteria (typed configuration)", () => {
  it("returns the defaults for an absent or malformed config", () => {
    expect(resolveImprovementCriteria(undefined)).toEqual(DEFAULT_IMPROVEMENT_CRITERIA);
    expect(resolveImprovementCriteria("nonsense")).toEqual(DEFAULT_IMPROVEMENT_CRITERIA);
  });

  it("clamps every value into its bounds", () => {
    const criteria = resolveImprovementCriteria({ minDistinctRuns: 0, maxK: 99, paretoTopShare: 5, savingsHorizonWeeks: -1 });
    expect(criteria.minDistinctRuns).toBe(2);
    expect(criteria.maxK).toBe(5);
    expect(criteria.paretoTopShare).toBe(1);
    expect(criteria.savingsHorizonWeeks).toBe(1);
  });

  it("applies a layer's override on top of the base config", () => {
    const raw = { minShapeRunsPerWeek: 4, layers: { "ring-0": { minShapeRunsPerWeek: 6 } } };
    expect(resolveImprovementCriteria(raw).minShapeRunsPerWeek).toBe(4);
    expect(resolveImprovementCriteria(raw, "ring-0").minShapeRunsPerWeek).toBe(6);
    expect(resolveImprovementCriteria(raw, "archetype").minShapeRunsPerWeek).toBe(4);
  });

  it("keeps the ladder ordered human > ai > code whatever is configured", () => {
    const criteria = resolveImprovementCriteria({ ladderWeights: { human: 1, ai: 2, code: 3 } });
    expect(criteria.ladderWeights.human).toBeGreaterThan(criteria.ladderWeights.ai);
    expect(criteria.ladderWeights.ai).toBeGreaterThan(criteria.ladderWeights.code);
  });
});

describe("evaluateControlLimits (the Control step: common vs special cause)", () => {
  it("is unevaluated until there is a baseline", () => {
    expect(evaluateControlLimits([3, 4]).insideControlLimits).toBeNull();
  });

  it("calls a stable count common cause: no edits", () => {
    const chart = evaluateControlLimits([4, 5, 3, 4, 5, 4]);
    expect(chart.specialCause).toBe(false);
    expect(chart.insideControlLimits).toBe(true);
  });

  it("calls a point beyond the upper limit special cause", () => {
    const chart = evaluateControlLimits([4, 5, 3, 4, 5, 20]);
    expect(chart.ucl).toBeLessThan(20);
    expect(chart.specialCause).toBe(true);
    expect(chart.insideControlLimits).toBe(false);
  });

  it("calls a run of points above the centre line special cause", () => {
    const chart = evaluateControlLimits([1, 1, 1, 1, 6, 6, 6, 6, 6, 6, 6, 6], { runLength: 8 });
    expect(chart.specialCause).toBe(true);
  });

  it("acts on a miss above its target rate even when the process is stable", () => {
    const chart = evaluateControlLimits([4, 5, 3, 4, 5, 4], { targetRate: 2 });
    expect(chart.specialCause).toBe(false);
    expect(chart.aboveTarget).toBe(true);
    expect(chart.insideControlLimits).toBe(false);
  });

  it("treats any miss on a zero baseline as special cause", () => {
    expect(evaluateControlLimits([0, 0, 0, 2]).specialCause).toBe(true);
  });

  it("schedules the recurrence checks 7 and 14 days after a verdict", () => {
    expect(controlCheckDueDates(new Date("2026-10-28T04:17:00.000Z"))).toEqual([
      "2026-11-04T04:17:00.000Z",
      "2026-11-11T04:17:00.000Z",
    ]);
  });
});

function candidate(missKey: string, overrides: Partial<CycleCandidate> = {}): CycleCandidate {
  return { missKey, roomRef: "WC-1", rung: "ai", modelClass: "strong", sparseHarness: false, ...base, ...overrides };
}

describe("rankAndSelect (Pareto ranking and the cycle ledger)", () => {
  it("records every candidate exactly once as worked or skipped with a reason", () => {
    const ledger = rankAndSelect(
      [candidate("a"), candidate("b", { distinctRuns: 1 }), candidate("c", { insideControlLimits: true })],
      DEFAULT_IMPROVEMENT_CRITERIA,
    );
    expect(ledger.eligible.map((row) => row.missKey)).toEqual(["a"]);
    expect(ledger.worked.map((row) => row.missKey)).toEqual(["a"]);
    expect(ledger.skipped).toEqual([
      { missKey: "b", roomRef: "WC-1", reason: "single-run" },
      { missKey: "c", roomRef: "WC-1", reason: "inside-control-limits" },
    ]);
  });

  it("weights a human-load miss above an AI-load one above a code-load one", () => {
    const ledger = rankAndSelect(
      [candidate("code", { rung: "code" }), candidate("human", { rung: "human" }), candidate("ai", { rung: "ai" })],
      { ...DEFAULT_IMPROVEMENT_CRITERIA, paretoTopShare: 1 },
    );
    expect(ledger.worked.map((row) => row.missKey)).toEqual(["human", "ai", "code"]);
  });

  it("works the vital few first and skips the rest as outside the Pareto cut", () => {
    const ledger = rankAndSelect(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => candidate(`m${n}`, { costPerOccurrence: n })),
      DEFAULT_IMPROVEMENT_CRITERIA,
    );
    expect(ledger.eligible).toHaveLength(10);
    expect(ledger.worked.map((row) => row.missKey)).toEqual(["m10", "m9"]);
    expect(ledger.skipped.filter((row) => row.reason === "outside-pareto-cut")).toHaveLength(8);
  });

  it("gives budget to rooms on weak or local models and to sparse harnesses first", () => {
    const ledger = rankAndSelect(
      [candidate("strong"), candidate("local", { modelClass: "local" }), candidate("sparse", { sparseHarness: true })],
      { ...DEFAULT_IMPROVEMENT_CRITERIA, paretoTopShare: 1 },
    );
    expect(ledger.worked.map((row) => row.missKey)).toEqual(["local", "sparse", "strong"]);
  });

  it("stops at the cycle's probe budget and says so", () => {
    const ledger = rankAndSelect(
      [candidate("a", { costPerOccurrence: 9 }), candidate("b", { costPerOccurrence: 8 })],
      { ...DEFAULT_IMPROVEMENT_CRITERIA, paretoTopShare: 1 },
      { probeBudget: 5 },
    );
    expect(ledger.worked.map((row) => row.missKey)).toEqual(["a"]);
    expect(ledger.skipped).toEqual([{ missKey: "b", roomRef: "WC-1", reason: "budget-exhausted" }]);
    expect(ledger.probeSpend).toBe(4);
  });

  it("is deterministic for the same input", () => {
    const input = [candidate("x"), candidate("y"), candidate("z")];
    expect(rankAndSelect(input, DEFAULT_IMPROVEMENT_CRITERIA)).toEqual(rankAndSelect([...input].reverse(), DEFAULT_IMPROVEMENT_CRITERIA));
  });
});
