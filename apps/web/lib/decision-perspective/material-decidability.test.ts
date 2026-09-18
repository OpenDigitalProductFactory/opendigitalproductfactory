import { describe, it, expect } from "vitest";

import { computeMaterialDecidability } from "./material";
import type { PerspectiveMaterial } from "./types";

const RECOMMENDATION_BAND = 0.7;
// From coverage-scoring RISK_PENALTY.
const MEDIUM = 0.1;
const HIGH = 0.25;

function material(over: Partial<PerspectiveMaterial> = {}): PerspectiveMaterial {
  return {
    materialId: `m-${Math.random().toString(36).slice(2, 8)}`,
    profileId: "p-1",
    sourceType: "principle",
    sourceRef: {},
    summary: "s",
    domainClass: "engineering-flow",
    direction: "support",
    domains: [],
    freshness: "current",
    evidenceGrade: "A",
    confidenceWeight: 1,
    reviewStatus: "approved",
    promotionState: "promoted",
    ...over,
  } as PerspectiveMaterial;
}

describe("computeMaterialDecidability (BI-5843CD9C)", () => {
  it("reproduces the measured ceiling for seeded candidate material", () => {
    // BI-0F3D5F94 measured five acumens holding 3 to 12 rows all returning
    // exactly 0.35 at medium risk and 0.2 at high. Candidate promotion weight is
    // 0.45, so 0.45 - 0.1 = 0.35 and 0.45 - 0.25 = 0.2. This pins that the
    // ceiling maths matches what was observed live.
    const seeded = [material({ promotionState: "candidate" })];

    const med = computeMaterialDecidability({
      materials: seeded,
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });
    const high = computeMaterialDecidability({
      materials: seeded,
      riskPenalty: HIGH,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(med.ceiling).toBe(0.35);
    expect(high.ceiling).toBe(0.2);
    expect(med.canReachRecommendation).toBe(false);
    expect(med.bindingFactor).toBe("promotion");
    expect(med.remedy).toMatch(/promotion/i);
  });

  it("volume does not move the ceiling — the whole point of the signal", () => {
    const one = [material({ promotionState: "candidate" })];
    const twelve = Array.from({ length: 12 }, () => material({ promotionState: "candidate" }));

    const a = computeMaterialDecidability({ materials: one, riskPenalty: MEDIUM, recommendationBand: RECOMMENDATION_BAND });
    const b = computeMaterialDecidability({ materials: twelve, riskPenalty: MEDIUM, recommendationBand: RECOMMENDATION_BAND });

    expect(b.ceiling).toBe(a.ceiling);
    expect(b.canReachRecommendation).toBe(false);
  });

  it("says a promoted, current, approved set CAN recommend", () => {
    const result = computeMaterialDecidability({
      materials: [material()],
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(result.ceiling).toBe(0.9);
    expect(result.canReachRecommendation).toBe(true);
    expect(result.bindingFactor).toBeNull();
    expect(result.remedy).toBeNull();
  });

  it("names staleness when that is what is holding it down, not promotion", () => {
    // Operator-fixable by curation, and a different remedy from promotion.
    const result = computeMaterialDecidability({
      materials: [material({ freshness: "stale" })],
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(result.canReachRecommendation).toBe(false);
    expect(result.bindingFactor).toBe("freshness");
    expect(result.remedy).toMatch(/refresh|re-confirm/i);
  });

  it("names weak evidence, which more material of the same grade cannot fix", () => {
    const result = computeMaterialDecidability({
      materials: [material({ evidenceGrade: "C" })],
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(result.bindingFactor).toBe("evidence");
    expect(result.remedy).toMatch(/better-sourced/i);
  });

  it("inherits the ceiling of its STRONGEST source, not its average", () => {
    // A set cannot be lifted above its best member by adding weaker ones, so the
    // strongest material bounds what the set can ever reach.
    const mixed = [
      material({ promotionState: "candidate" }),
      material(),
      material({ freshness: "stale" }),
    ];

    const result = computeMaterialDecidability({
      materials: mixed,
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(result.ceiling).toBe(0.9);
    expect(result.canReachRecommendation).toBe(true);
  });

  it("reports no usable material when every source is excluded", () => {
    const result = computeMaterialDecidability({
      materials: [
        material({ freshness: "contradicted" }),
        material({ reviewStatus: "rejected" }),
        material({ promotionState: "revoked" }),
      ],
      riskPenalty: MEDIUM,
      recommendationBand: RECOMMENDATION_BAND,
    });

    expect(result.ceiling).toBe(0);
    expect(result.canReachRecommendation).toBe(false);
    expect(result.remedy).toMatch(/contradicted|superseded|rejected|revoked/i);
  });

  it("a critical-risk decision can be undecidable on material that is fine at low risk", () => {
    const good = [material()];
    const low = computeMaterialDecidability({ materials: good, riskPenalty: 0, recommendationBand: RECOMMENDATION_BAND });
    const critical = computeMaterialDecidability({ materials: good, riskPenalty: 0.5, recommendationBand: RECOMMENDATION_BAND });

    expect(low.canReachRecommendation).toBe(true);
    expect(critical.canReachRecommendation).toBe(false);
    expect(critical.ceiling).toBe(0.5);
  });
});
