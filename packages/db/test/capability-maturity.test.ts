import { describe, expect, it } from "vitest";

import {
  deriveConfidenceGrade,
  deriveEffectiveMaturity,
  deriveMvpTargetScore,
  validateCapabilityDependencyGraph,
} from "../src/capability-maturity";

describe("capability maturity scoring", () => {
  it.each([
    ["critical", 4],
    ["elevated", 4],
    ["standard", 3],
    ["low", 3],
  ] as const)("derives MVP target for %s risk", (riskTier, expected) => {
    expect(deriveMvpTargetScore(riskTier)).toBe(expected);
  });

  it("returns claimed when no evidence stream has ever flowed and no review exists", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: null,
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: false,
    })).toBe("claimed");
  });

  it("returns stale when evidence stream existed and has been silent more than 30 days", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-04-15T12:00:00.000Z"),
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: false,
    })).toBe("stale");
  });

  it("returns verified when governance review is fresh even if evidence lapsed", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-04-15T12:00:00.000Z"),
      lastGovernanceReviewAt: new Date("2026-05-10T12:00:00.000Z"),
      hasContinuousEvidence: true,
    })).toBe("verified");
  });

  it("returns evidenced when continuous evidence is fresh and review is absent", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: true,
    })).toBe("evidenced");
  });

  it("bounds effective maturity by dependency maturity", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 4,
      dependencyEffectiveMaturities: [4, 2, 3],
      confidenceGrade: "evidenced",
    })).toBe(2);
  });

  it("demotes stale effective maturity by one", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 3,
      dependencyEffectiveMaturities: [4],
      confidenceGrade: "stale",
    })).toBe(2);
  });

  it("does not demote claimed effective maturity", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 3,
      dependencyEffectiveMaturities: [4],
      confidenceGrade: "claimed",
    })).toBe(3);
  });

  it("floors stale demotion at zero", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 0,
      dependencyEffectiveMaturities: [],
      confidenceGrade: "stale",
    })).toBe(0);
  });

  it("rejects direct dependency cycles", () => {
    expect(() => validateCapabilityDependencyGraph([
      { id: "runtime", dependsOnIds: ["gateway"] },
      { id: "gateway", dependsOnIds: ["runtime"] },
    ])).toThrow(/cycle/i);
  });

  it("rejects transitive dependency cycles", () => {
    expect(() => validateCapabilityDependencyGraph([
      { id: "a", dependsOnIds: ["b"] },
      { id: "b", dependsOnIds: ["c"] },
      { id: "c", dependsOnIds: ["a"] },
    ])).toThrow(/cycle/i);
  });
});
