import { describe, expect, it } from "vitest";

import { computeStanceRelevance, cosineSimilarity } from "./stance-relevance";
import type { DecisionDomainClass, PerspectiveMaterial } from "./types";

const RISK_ASSESSMENT_DOMAIN_CLASS: DecisionDomainClass = "risk-assessment";

function material(overrides: Partial<PerspectiveMaterial>): PerspectiveMaterial {
  return {
    materialId: "m",
    profileId: "p",
    sourceType: "stance",
    sourceRef: {},
    summary: "",
    domainClass: RISK_ASSESSMENT_DOMAIN_CLASS,
    direction: "neutral",
    domains: [],
    freshness: "current",
    evidenceGrade: "A",
    confidenceWeight: 0.9,
    reviewStatus: "approved",
    promotionState: "promoted",
    lastValidatedAt: null,
    ...overrides,
  };
}

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("computeStanceRelevance", () => {
  const declineStance = material({ materialId: "decline", summary: "We decline off-mission consumer hardware ventures.", direction: "oppose" });
  const supportStance = material({ materialId: "support", summary: "We go to market through a reseller and MSP partner network.", direction: "support" });

  it("semantic: the on-point stance dominates (min-max normalised)", async () => {
    // Embed the question like the decline stance ([1,0]) and unlike the support one ([0,1]).
    const vectors: Record<string, number[]> = {
      "toaster question": [1, 0],
      "We decline off-mission consumer hardware ventures.": [1, 0],
      "We go to market through a reseller and MSP partner network.": [0, 1],
    };
    const result = await computeStanceRelevance({
      question: "toaster question",
      materials: [declineStance, supportStance],
      embed: async (text) => vectors[text] ?? [0, 0],
    });
    expect(result.method).toBe("semantic");
    expect(result.relevanceByMaterialId.get("decline")).toBe(1);
    expect(result.relevanceByMaterialId.get("support")).toBe(0);
  });

  it("falls back to lexical overlap when embeddings are unavailable", async () => {
    const result = await computeStanceRelevance({
      question: "should we onboard a reseller MSP partner",
      materials: [declineStance, supportStance],
      embed: async () => null,
    });
    expect(result.method).toBe("lexical");
    // The support stance shares 'reseller'/'partner'/'msp' with the question.
    expect(result.relevanceByMaterialId.get("support")!).toBeGreaterThan(
      result.relevanceByMaterialId.get("decline")!,
    );
  });

  it("gives a lone applicable stance full relevance", async () => {
    const result = await computeStanceRelevance({
      question: "anything",
      materials: [supportStance],
      embed: async () => null,
    });
    expect(result.relevanceByMaterialId.get("support")).toBe(1);
  });

  it("returns an empty map for no materials", async () => {
    const result = await computeStanceRelevance({ question: "q", materials: [] });
    expect(result.relevanceByMaterialId.size).toBe(0);
  });
});
