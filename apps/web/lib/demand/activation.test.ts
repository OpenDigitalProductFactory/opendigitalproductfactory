import { describe, expect, it } from "vitest";

import {
  buildDemandActivationState,
  evaluateDemandTransition,
  type DemandActivationInput,
} from "./activation";

function demand(overrides: Partial<DemandActivationInput> = {}): DemandActivationInput {
  return {
    demandStage: null,
    status: "open",
    problemStatement: null,
    evidenceCount: 0,
    framework: "rice",
    scoreInputs: {
      reach: null,
      impact: null,
      confidence: null,
      jobSize: null,
      occurrenceCount: 1,
      effortSize: null,
    },
    investmentBucket: null,
    estimateSource: null,
    estimateAgreed: null,
    estimateDiverged: false,
    fundingDecisionAllowed: false,
    ...overrides,
  };
}

// BI-A5697C5E, founder-ratified 2026-08-26: an estimate's standing follows its
// evidence, never its provenance. "Humans are not qualified to override an AI
// estimate" — the confirmation the old rule demanded could only be a rubber
// stamp, and blocked scoreReady on every agent-estimated item.
describe("estimate standing follows evidence, not provenance", () => {
  const grounded = {
    demandStage: "screened" as const,
    problemStatement: "Employment events are recorded but nothing acts on them.",
    evidenceCount: 1,
    scoreInputs: { reach: 40, impact: 4, confidence: 0.9, jobSize: 3 },
    investmentBucket: "grow",
    estimateAgreed: false,
    estimateDiverged: false,
  };

  it("lets an unconfirmed AI estimate reach scoreReady", () => {
    const state = buildDemandActivationState(demand({ ...grounded, estimateSource: "ai" }));

    expect(state.score.provisional).toBe(false);
    expect(state.readiness.scoreReady).toBe(true);
    expect(state.blockers).not.toContain("Confirm or overrule the proposed AI effort estimate.");
  });

  it("scores identical grounding identically whatever produced the estimate", () => {
    // `estimateAgreed` tracks its source realistically: only "agreed" carries a
    // countersignature. Under the old rule that alone split the three apart — ai
    // and human were provisional, agreed was not — which is exactly the
    // provenance judgement this pins closed.
    const states = ([
      { estimateSource: "ai" as const, estimateAgreed: false },
      { estimateSource: "human" as const, estimateAgreed: false },
      { estimateSource: "agreed" as const, estimateAgreed: true },
    ]).map((provenance) =>
      buildDemandActivationState(demand({ ...grounded, ...provenance })));

    const [first] = states;
    for (const state of states) {
      expect(state.score.score).toBe(first!.score.score);
      expect(state.score.provisional).toBe(first!.score.provisional);
      expect(state.readiness.scoreReady).toBe(first!.readiness.scoreReady);
    }
  });

  it("still blocks when two estimates genuinely disagree", () => {
    const state = buildDemandActivationState(
      demand({ ...grounded, estimateSource: "human", estimateDiverged: true }));

    expect(state.score.provisional).toBe(true);
    expect(state.readiness.scoreReady).toBe(false);
    expect(state.blockers).toContain("Reconcile the AI and human effort estimates.");
  });

  it("keeps the investment bucket a human decision", () => {
    const state = buildDemandActivationState(
      demand({ ...grounded, estimateSource: "ai", investmentBucket: null }));

    expect(state.readiness.scoreReady).toBe(false);
    expect(state.blockers).toContain("Choose an investment bucket.");
  });
});

describe("buildDemandActivationState", () => {
  it("keeps a null stage explicitly unclassified", () => {
    const state = buildDemandActivationState(demand());

    expect(state.stage).toBe("unclassified");
    expect(state.nextStage).toBe("raw");
    expect(state.score.score).toBeNull();
    expect(state.blockers).toContain("Classify this demand before shaping it.");
  });

  it("explains score inputs, confidence, evidence, and estimate provenance", () => {
    const state = buildDemandActivationState(
      demand({
        demandStage: "screened",
        problemStatement: "Customers abandon the booking flow.",
        evidenceCount: 2,
        scoreInputs: {
          reach: 40,
          impact: 2,
          confidence: 0.75,
          jobSize: 5,
        },
        investmentBucket: "grow",
        estimateSource: "agreed",
        estimateAgreed: true,
      }),
    );

    expect(state.score).toMatchObject({
      score: 12,
      framework: "rice",
      confidence: 0.75,
      evidenceCount: 2,
      effectiveJobSize: 5,
      estimateSource: "agreed",
      provisional: false,
      missing: [],
    });
    expect(state.score.contributions).toEqual({
      reach: 40,
      impact: 2,
      confidence: 0.75,
      jobSize: 5,
    });
    expect(state.readiness).toEqual({
      classified: true,
      evidenceReady: true,
      scoreReady: true,
      fundingReady: true,
    });
    expect(state.nextStage).toBe("shaped");
  });

  it("keeps a computable score provisional while estimates diverge", () => {
    const state = buildDemandActivationState(
      demand({
        demandStage: "screened",
        problemStatement: "Evidence-backed problem.",
        evidenceCount: 1,
        scoreInputs: { reach: 20, impact: 2, confidence: 0.8, jobSize: 4 },
        investmentBucket: "grow",
        estimateSource: "human",
        estimateAgreed: false,
        estimateDiverged: true,
      }),
    );

    expect(state.score.score).toBe(8);
    expect(state.score.provisional).toBe(true);
    expect(state.readiness.scoreReady).toBe(false);
    expect(state.blockers).toContain("Reconcile the AI and human effort estimates.");
  });

  it("does not invent evidence or confidence when inputs are absent", () => {
    const state = buildDemandActivationState(
      demand({
        demandStage: "raw",
        problemStatement: "Known problem, no reviewed evidence yet.",
        scoreInputs: { reach: 10, impact: 1, confidence: null, jobSize: 2 },
      }),
    );

    expect(state.readiness.evidenceReady).toBe(false);
    expect(state.score.missing).toContain("confidence");
    expect(state.blockers).toContain("Link at least one reviewed evidence source.");
  });
});

describe("evaluateDemandTransition", () => {
  it("allows explicit intake classification but rejects skipping raw", () => {
    expect(evaluateDemandTransition(demand(), "raw")).toMatchObject({ allowed: true });
    expect(evaluateDemandTransition(demand(), "screened")).toMatchObject({
      allowed: false,
      code: "invalid-transition",
    });
  });

  it("requires evidence before screened and full score readiness before shaped", () => {
    expect(
      evaluateDemandTransition(demand({ demandStage: "raw" }), "screened"),
    ).toMatchObject({ allowed: false, code: "evidence-required" });

    expect(
      evaluateDemandTransition(
        demand({
          demandStage: "raw",
          problemStatement: "Supported problem.",
          evidenceCount: 1,
        }),
        "screened",
      ),
    ).toMatchObject({ allowed: true });

    expect(
      evaluateDemandTransition(
        demand({
          demandStage: "screened",
          problemStatement: "Supported problem.",
          evidenceCount: 1,
        }),
        "shaped",
      ),
    ).toMatchObject({ allowed: false, code: "score-not-ready" });
  });

  it("reserves ready for the governed funding result", () => {
    const shaped = demand({
      demandStage: "shaped",
      problemStatement: "Supported problem.",
      evidenceCount: 1,
      scoreInputs: { reach: 20, impact: 2, confidence: 0.8, jobSize: 4 },
      investmentBucket: "grow",
      estimateSource: "agreed",
      estimateAgreed: true,
    });

    expect(evaluateDemandTransition(shaped, "ready")).toMatchObject({
      allowed: false,
      code: "funding-decision-required",
    });
    expect(
      evaluateDemandTransition({ ...shaped, fundingDecisionAllowed: true }, "ready"),
    ).toMatchObject({ allowed: true });
  });

  it("refuses a funding result when shaped demand is still incomplete", () => {
    expect(
      evaluateDemandTransition(
        demand({ demandStage: "shaped", fundingDecisionAllowed: true }),
        "ready",
      ),
    ).toMatchObject({ allowed: false, code: "evidence-required" });
  });

  it("allows one-step reconsideration with rationale and never silently rewinds funded demand", () => {
    expect(
      evaluateDemandTransition(
        demand({ demandStage: "shaped" }),
        "screened",
        "New evidence changed the estimate.",
      ),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateDemandTransition(demand({ demandStage: "shaped" }), "screened"),
    ).toMatchObject({ allowed: false, code: "rationale-required" });
    expect(
      evaluateDemandTransition(
        demand({ demandStage: "ready" }),
        "shaped",
        "Reconsider funding.",
      ),
    ).toMatchObject({ allowed: false, code: "funding-reconsideration-required" });
  });
});
