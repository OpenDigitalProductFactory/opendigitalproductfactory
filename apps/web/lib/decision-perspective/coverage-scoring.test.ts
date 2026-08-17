import { describe, expect, it } from "vitest";

import { scoreProfileCoverage } from "./coverage-scoring";
import type { PerspectiveMaterial } from "./types";

// BI-F5F2869D — the escalation must carry signal. Two failures were measured
// live: a decisive 1.0-weight ruling scored 0.60 because relevance was
// normalised over material that never got scored, and a settled question was
// indistinguishable from a novel one.
describe("relevance is normalised within the scored set (BI-F5F2869D)", () => {
  const profile = {
    profileId: "org-1",
    currentVersion: { versionId: "v1", versionNumber: 1 },
    fallbackProfileId: null,
    autonomyPolicy: {
      allowArbitration: false,
      allowRecommendation: true,
      maxRiskForArbitration: "low",
      minimumConfidenceForArbitration: 0.9,
      minimumConfidenceForRecommendation: 0.55,
    },
  } as unknown as Parameters<typeof scoreProfileCoverage>[0]["profile"];

  function material(over: Record<string, unknown>) {
    return {
      materialId: "m", profileId: "org-1", sourceType: "stance", sourceRef: {},
      summary: "s", domainClass: "risk-assessment", direction: "support",
      domains: ["risk-assessment"], freshness: "current", evidenceGrade: "A",
      confidenceWeight: 0.9, reviewStatus: "approved", promotionState: "promoted",
      lastValidatedAt: null, ...over,
    } as unknown as PerspectiveMaterial;
  }

  // The live regression: the relevance 1.0 anchor sat on material outside the
  // scored set, so the ruling scored 0.6 and the verdict read as "no answer".
  it("restores a 1.0 anchor when the global maximum was never scored", () => {
    const ruling = material({ materialId: "ruling", confidenceWeight: 1 });
    const other = material({ materialId: "other" });
    const coverage = scoreProfileCoverage({
      profile,
      materials: [ruling, other],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      // Neither reaches 1.0 — the global max belonged to an unscored material.
      relevanceByMaterialId: new Map([["ruling", 0.6], ["other", 0.2]]),
    });

    // 1.0 weight x re-normalised 1.0 relevance, minus the 0.1 medium penalty.
    expect(coverage.confidence).toBeCloseTo(0.9, 4);
  });

  it("marks a dominant ruled stance as settled", () => {
    const ruling = material({ materialId: "ruling", confidenceWeight: 1 });
    const other = material({ materialId: "other" });
    const coverage = scoreProfileCoverage({
      profile,
      materials: [ruling, other],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      relevanceByMaterialId: new Map([["ruling", 0.6], ["other", 0.2]]),
    });
    expect(coverage.settledByRuling?.materialId).toBe("ruling");
  });

  it("does NOT treat a merely-aligned stance as settled", () => {
    // Grade A but weight 0.9 — an owner confirmation, not a ruling on this question.
    const confirmed = material({ materialId: "confirmed", confidenceWeight: 0.9 });
    const coverage = scoreProfileCoverage({
      profile,
      materials: [confirmed],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      relevanceByMaterialId: new Map([["confirmed", 1]]),
    });
    expect(coverage.settledByRuling).toBeUndefined();
  });

  it("does NOT treat a ruling that loses relevance ranking as settled", () => {
    const ruling = material({ materialId: "ruling", confidenceWeight: 1 });
    const closer = material({ materialId: "closer" });
    const coverage = scoreProfileCoverage({
      profile,
      materials: [ruling, closer],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      // The ruling is the WORST match here — it answers some other question.
      relevanceByMaterialId: new Map([["ruling", 0.1], ["closer", 0.9]]),
    });
    expect(coverage.settledByRuling).toBeUndefined();
  });

  it("leaves the content-blind WWMD path untouched", () => {
    const coverage = scoreProfileCoverage({
      profile,
      materials: [material({ materialId: "a" })],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
    });
    expect(coverage.contentAware).toBe(false);
    expect(coverage.settledByRuling).toBeUndefined();
  });
});

// REGRESSION GUARD (BI-F5F2869D restore, 2026-08-16).
//
// #4348 recovered a branch pushed BEFORE #4346 and "reconciled it with current
// main" by hand. The reconciliation silently dropped `settledByRuling`,
// `directional-outcome.ts` and the scored-set re-normalisation — and all 34 CI
// checks passed, because nothing tested for the ABSENCE of the behaviour. Main
// went back to approving on alignment alone, which is the exact conservatism/
// innovation failure the operator ruled against.
//
// These assert the CONTRACT rather than any one code path, so a future
// reconciliation that deletes the module fails here instead of shipping.
describe("the settled-vs-aligned distinction must not be silently removed", () => {
  const profile = {
    profileId: "org-1",
    currentVersion: { versionId: "v1", versionNumber: 1 },
    fallbackProfileId: null,
    autonomyPolicy: {
      allowArbitration: false,
      allowRecommendation: true,
      maxRiskForArbitration: "low",
      minimumConfidenceForArbitration: 0.9,
      minimumConfidenceForRecommendation: 0.55,
    },
  } as unknown as Parameters<typeof scoreProfileCoverage>[0]["profile"];

  function material(over: Record<string, unknown>) {
    return {
      materialId: "m", profileId: "org-1", sourceType: "stance", sourceRef: {},
      summary: "s", domainClass: "risk-assessment", direction: "support",
      domains: ["risk-assessment"], freshness: "current", evidenceGrade: "A",
      confidenceWeight: 0.9, reviewStatus: "approved", promotionState: "promoted",
      lastValidatedAt: null, ...over,
    } as unknown as PerspectiveMaterial;
  }

  it("still exposes settledByRuling on content-aware coverage", () => {
    const coverage = scoreProfileCoverage({
      profile,
      materials: [material({ materialId: "ruling", confidenceWeight: 1 })],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      relevanceByMaterialId: new Map([["ruling", 1]]),
    });
    expect(coverage.contentAware).toBe(true);
    expect(coverage.settledByRuling?.materialId).toBe("ruling");
  });

  it("a merely-aligned stance is NOT settled — alignment is not a licence to act", () => {
    const coverage = scoreProfileCoverage({
      profile,
      materials: [material({ materialId: "supporting", confidenceWeight: 0.9 })],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      relevanceByMaterialId: new Map([["supporting", 1]]),
    });
    expect(coverage.settledByRuling).toBeUndefined();
  });

  it("relevance is still re-normalised within the scored set", () => {
    // Neither value reaches 1.0 — the global max belonged to unscored material.
    // Without re-normalisation the decisive 1.0-weight ruling scores 0.6 and the
    // verdict is indistinguishable from having no answer at all.
    const coverage = scoreProfileCoverage({
      profile,
      materials: [
        material({ materialId: "ruling", confidenceWeight: 1 }),
        material({ materialId: "other" }),
      ],
      questionDomain: "risk-assessment",
      riskTier: "medium",
      recentOverrideCount: 0,
      relevanceByMaterialId: new Map([["ruling", 0.6], ["other", 0.2]]),
    });
    expect(coverage.confidence).toBeCloseTo(0.9, 4);
  });
});
