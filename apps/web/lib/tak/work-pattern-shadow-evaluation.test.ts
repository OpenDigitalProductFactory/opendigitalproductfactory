import { describe, expect, it } from "vitest";

import {
  evaluateWorkPatternShadowEvidence,
  parseLegacyWorkPatternShadowTrials,
  parseWorkPatternShadowTrials,
} from "./work-pattern-shadow-evaluation";

function trial(overrides: Record<string, unknown> = {}) {
  return {
    trialId: "S-1",
    riskClass: "internal-reversible",
    candidateDecision: "file grant need",
    actualDecision: "file grant need",
    outcome: "accepted",
    agreement: true,
    toolCallDelta: -2,
    failureDelta: -1,
    manualTouchDelta: 0,
    contextTokenDelta: -1200,
    reviewFailureDelta: 0,
    observedAt: "2026-06-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseWorkPatternShadowTrials", () => {
  it("accepts bounded shadow rows and rejects malformed risk/agreement data", () => {
    const parsed = parseWorkPatternShadowTrials([
      trial(),
      trial({ trialId: "S-2", riskClass: "not-a-risk" }),
      trial({ trialId: "S-3", agreement: "yes" }),
      null,
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      trialId: "S-1",
      riskClass: "internal-reversible",
      agreement: true,
      toolCallDelta: -2,
    });
    expect(parsed[0].observedAt?.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });
});

describe("parseLegacyWorkPatternShadowTrials", () => {
  it("normalizes and deduplicates trials repeated across legacy JSON sources", () => {
    const first = trial();
    const second = trial({ trialId: "S-2" });

    expect(parseLegacyWorkPatternShadowTrials(
      { shadowTrials: [first, second] },
      { shadowTrials: [first] },
    )).toEqual(parseWorkPatternShadowTrials([first, second]));
  });

  it("preserves first-source order for compatibility", () => {
    const first = trial({ trialId: "S-2" });
    const second = trial({ trialId: "S-1" });

    expect(parseLegacyWorkPatternShadowTrials(
      { shadowTrials: [first] },
      { shadowTrials: [second] },
    ).map((row) => row.trialId)).toEqual(["S-2", "S-1"]);
  });
});

describe("evaluateWorkPatternShadowEvidence", () => {
  it("summarizes agreement, improvement deltas, and projected trust recommendation", () => {
    const trials = Array.from({ length: 20 }, (_, index) =>
      trial({
        trialId: `S-${index + 1}`,
        agreement: index !== 19,
        actualDecision: index === 19 ? "defer" : "file grant need",
      }),
    );

    const evaluation = evaluateWorkPatternShadowEvidence({
      trials: parseWorkPatternShadowTrials(trials),
      currentLevel: "shadow",
    });

    expect(evaluation).toMatchObject({
      samples: 20,
      agreements: 19,
      agreementRate: 0.95,
      decision: "approve-narrower-scope",
      activationAllowed: false,
      riskClass: "internal-reversible",
    });
    expect(evaluation.improvementTotals).toMatchObject({
      toolCallDelta: -40,
      failureDelta: -20,
      contextTokenDelta: -24000,
    });
    expect(evaluation.trustRecommendation).toMatchObject({
      action: "promote",
      from: "shadow",
      to: "propose",
    });
  });

  it("rejects candidates with enough low-agreement shadow evidence", () => {
    const trials = Array.from({ length: 10 }, (_, index) =>
      trial({
        trialId: `S-${index + 1}`,
        agreement: index < 5,
        actualDecision: index < 5 ? "file grant need" : "defer",
      }),
    );

    const evaluation = evaluateWorkPatternShadowEvidence({
      trials: parseWorkPatternShadowTrials(trials),
      currentLevel: "propose",
    });

    expect(evaluation).toMatchObject({
      samples: 10,
      agreements: 5,
      agreementRate: 0.5,
      decision: "reject-candidate",
      activationAllowed: false,
    });
    expect(evaluation.trustRecommendation).toMatchObject({
      action: "demote",
      from: "propose",
      to: "shadow",
    });
  });

  it("blocks trust projection when risk evidence is missing", () => {
    const evaluation = evaluateWorkPatternShadowEvidence({
      trials: parseWorkPatternShadowTrials([trial({ riskClass: null })]),
      currentLevel: "shadow",
    });

    expect(evaluation).toMatchObject({
      samples: 1,
      agreements: 1,
      riskClass: null,
      trustRecommendation: null,
      decision: "insufficient-evidence",
      activationAllowed: false,
    });
    expect(evaluation.blockers).toContain("missing-risk-class");
  });
});
