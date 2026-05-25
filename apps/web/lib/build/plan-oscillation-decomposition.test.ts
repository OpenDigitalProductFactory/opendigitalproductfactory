import { describe, expect, it } from "vitest";

import {
  derivePlanOscillationDecompositionAffordance,
  isPlanReviewOscillating,
} from "./plan-oscillation-decomposition";
import type { BuildDesignDoc, ReviewResult } from "@/lib/feature-build-types";

const designDoc: BuildDesignDoc = {
  problemStatement: "Plan review keeps trading scope issues.",
  proposedApproach: "Split the workflow into smaller child builds.",
  reusePlan: "Reuse the decomposition assistant.",
  acceptanceCriteria: ["AC0", "AC1"],
};

function planReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    decision: "fail",
    summary: "Still too large.",
    issues: [{ severity: "important", description: "Scope is too broad." }],
    iteration: {
      round: 3,
      prior: { issueCount: 8, addressed: 2, persisted: 5, newlySurfaced: 3 },
      oscillating: true,
    },
    ...overrides,
  };
}

describe("isPlanReviewOscillating", () => {
  it("detects failed plan reviews with oscillating iteration metadata", () => {
    expect(isPlanReviewOscillating(planReview())).toBe(true);
  });

  it("ignores passed reviews and failed reviews without the D38 oscillation flag", () => {
    expect(isPlanReviewOscillating(planReview({ decision: "pass" }))).toBe(false);
    expect(isPlanReviewOscillating(planReview({ iteration: { round: 2 } }))).toBe(false);
    expect(isPlanReviewOscillating(null)).toBe(false);
  });
});

describe("derivePlanOscillationDecompositionAffordance", () => {
  it("offers Decompose now for top-level plan builds with a design doc", () => {
    const result = derivePlanOscillationDecompositionAffordance({
      phase: "plan",
      planReview: planReview(),
      parentEpicId: null,
      designDoc,
    });

    expect(result).toEqual({
      kind: "decompose-now",
      disabledReason: null,
    });
  });

  it("keeps the top-level affordance visible but disabled when the design doc is missing", () => {
    const result = derivePlanOscillationDecompositionAffordance({
      phase: "plan",
      planReview: planReview(),
      parentEpicId: null,
      designDoc: null,
    });

    expect(result).toEqual({
      kind: "decompose-now",
      disabledReason: "Need a design doc first.",
    });
  });

  it("routes child builds to parent amendment instead of recursive decomposition", () => {
    const result = derivePlanOscillationDecompositionAffordance({
      phase: "plan",
      planReview: planReview(),
      parentEpicId: "epic-row-1",
      designDoc,
    });

    expect(result).toEqual({
      kind: "amend-parent-design",
      disabledReason: null,
    });
  });

  it("does nothing outside plan-phase oscillation", () => {
    expect(derivePlanOscillationDecompositionAffordance({
      phase: "build",
      planReview: planReview(),
      parentEpicId: null,
      designDoc,
    })).toEqual({ kind: "none" });

    expect(derivePlanOscillationDecompositionAffordance({
      phase: "plan",
      planReview: planReview({ iteration: { round: 2 } }),
      parentEpicId: null,
      designDoc,
    })).toEqual({ kind: "none" });
  });
});
