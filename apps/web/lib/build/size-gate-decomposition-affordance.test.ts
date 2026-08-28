// BI-04B112CA / BI-97F7F599 — the size gate must drive the owner's next action.

import { describe, expect, it } from "vitest";

import { deriveSizeGateDecompositionAffordance } from "./size-gate-decomposition-affordance";

const designDoc = { problemStatement: "P" } as never;

function review(decision: string, sizeDecision?: string) {
  return {
    decision,
    ...(sizeDecision ? { sizeAssessment: { decision: sizeDecision } } : {}),
  } as never;
}

describe("deriveSizeGateDecompositionAffordance", () => {
  // The live repro: FB-41EA43C5 passed design review, was assessed xlarge, and
  // was offered "Advance to Plan" — which the gate then refused.
  it("offers decomposition for a passed ideate design assessed decompose-required", () => {
    const result = deriveSizeGateDecompositionAffordance({
      phase: "ideate",
      designReview: review("pass", "decompose-required"),
      designDoc,
    });

    expect(result).toMatchObject({ kind: "decompose-now", required: true, disabledReason: null });
  });

  it("offers decomposition for decompose-recommended, marked as advisory", () => {
    const result = deriveSizeGateDecompositionAffordance({
      phase: "ideate",
      designReview: review("pass", "decompose-recommended"),
      designDoc,
    });

    expect(result).toMatchObject({ kind: "decompose-now", required: false });
  });

  it("stays out of the way when the design is the right size", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: review("pass", "ok"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  it("stays out of the way when no size assessment was recorded", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: review("pass"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  // A failing design is the design loop's problem — splitting it would carry the
  // unresolved issues into every child.
  it("does not offer decomposition while the design review is failing", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: review("fail", "decompose-required"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not fire outside ideate — plan oscillation owns that entry point", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "plan",
        designReview: review("pass", "decompose-required"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  it("disables the action when there is no design to split", () => {
    const result = deriveSizeGateDecompositionAffordance({
      phase: "ideate",
      designReview: review("pass", "decompose-required"),
      designDoc: null,
    });

    expect(result).toMatchObject({ kind: "decompose-now", disabledReason: "Need a design doc first." });
  });
});
