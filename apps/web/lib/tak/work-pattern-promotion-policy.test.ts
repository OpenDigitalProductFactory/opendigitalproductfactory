import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
  evaluateWorkPatternPromotion,
  type WorkPatternPromotionEvidence,
} from "./work-pattern-promotion-policy";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function qualifyingEvidence(
  overrides: Partial<WorkPatternPromotionEvidence> = {},
): WorkPatternPromotionEvidence {
  return {
    activityKey: "build.implement",
    riskClass: "internal-reversible",
    validPairCount: 8,
    invalidPairCount: 0,
    completedCellKeys: ["control", "method", "model", "interaction"],
    freshnessAt: new Date("2026-07-25T12:00:00.000Z"),
    rollbackBindingId: "AB-work-pattern-prior",
    objectiveDeltas: {
      correctness: 0.08,
      security: 0,
      migrationSafety: 0,
      customerImpact: 0,
      speed: 0.12,
      cost: 0.04,
    },
    commandmentGateRegression: false,
    criticalFindingReproduced: false,
    regulatoryHumanControlRequired: false,
    activeBindingHealthRegression: false,
    ...overrides,
  };
}

describe("evaluateWorkPatternPromotion", () => {
  it("activates only complete, fresh, objectively improved evidence with rollback", () => {
    expect(evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence: qualifyingEvidence(),
      now: NOW,
    })).toEqual({ decision: "activate", reasons: [] });
  });

  it.each([
    ["commandment regression", { commandmentGateRegression: true }],
    ["critical finding", { criticalFindingReproduced: true }],
    ["correctness regression", { objectiveDeltas: { ...qualifyingEvidence().objectiveDeltas, correctness: -0.01 } }],
    ["security regression", { objectiveDeltas: { ...qualifyingEvidence().objectiveDeltas, security: -0.01 } }],
    ["migration regression", { objectiveDeltas: { ...qualifyingEvidence().objectiveDeltas, migrationSafety: -0.01 } }],
    ["customer-impact regression", { objectiveDeltas: { ...qualifyingEvidence().objectiveDeltas, customerImpact: -0.01 } }],
  ])("rejects %s even when speed and cost improve", (_label, override) => {
    const evidence = qualifyingEvidence({
      ...override,
      objectiveDeltas: {
        ...qualifyingEvidence().objectiveDeltas,
        speed: 0.9,
        cost: 0.9,
        ...("objectiveDeltas" in override ? override.objectiveDeltas : {}),
      },
    });
    expect(evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence,
      now: NOW,
    }).decision).toBe("reject");
  });

  it.each([
    ["too few pairs", { validPairCount: 7 }],
    ["invalid pair", { invalidPairCount: 1 }],
    ["missing required cell", { completedCellKeys: ["control", "method"] }],
    ["stale evidence", { freshnessAt: new Date("2026-06-01T00:00:00.000Z") }],
    ["missing rollback", { rollbackBindingId: null }],
  ])("continues without activation for %s", (_label, override) => {
    expect(evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence: qualifyingEvidence(override as Partial<WorkPatternPromotionEvidence>),
      now: NOW,
    }).decision).toBe("continue");
  });

  it("returns rollback for a same-scope health regression with a safe target", () => {
    expect(evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence: qualifyingEvidence({ activeBindingHealthRegression: true }),
      now: NOW,
    }).decision).toBe("rollback");
  });

  it("escalates when regulatory policy requires human control", () => {
    expect(evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence: qualifyingEvidence({ regulatoryHumanControlRequired: true }),
      now: NOW,
    }).decision).toBe("escalate");
  });
});
