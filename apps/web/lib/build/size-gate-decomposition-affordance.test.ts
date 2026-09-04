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

function reviewWithOverride(sizeDecision: string) {
  return {
    decision: "pass",
    sizeAssessment: { decision: sizeDecision },
    decompositionOverride: {
      rationale: "One read-only page; splitting would ship fragments nobody can use.",
      recordedAt: "2026-08-28T19:26:04.554Z",
      recordedByUserId: "usr_1",
      recordedByAgentId: null,
    },
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

  // BI-181E8776 — the live repro: FB-1EBDEBAD was assessed decompose-required,
  // the owner took the "Keep as one build (explain why)" lever and recorded a
  // rationale, and the card went on offering "Split into smaller builds" as the
  // only next action. The gate had already unblocked; only this surface had not.
  it("stops asking once the owner has recorded an override", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: reviewWithOverride("decompose-required"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  it("stops asking on the advisory side too — an answered question stays answered", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: reviewWithOverride("decompose-recommended"),
        designDoc,
      }),
    ).toEqual({ kind: "none" });
  });

  // Guards the inverse: absent an override the split is still the right ask.
  it("still offers the split when no override has been recorded", () => {
    expect(
      deriveSizeGateDecompositionAffordance({
        phase: "ideate",
        designReview: review("pass", "decompose-required"),
        designDoc,
      }),
    ).toMatchObject({ kind: "decompose-now", required: true });
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
