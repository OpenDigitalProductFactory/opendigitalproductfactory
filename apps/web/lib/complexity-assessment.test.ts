import { describe, expect, it } from "vitest";
import { assessComplexity } from "./complexity-assessment";
import type { ComplexityScores } from "./feature-build-types";

const allOnes: ComplexityScores = {
  taxonomySpan: 1, dataEntities: 1, integrations: 1,
  novelty: 1, regulatory: 1, costEstimate: 1, techDebt: 1,
};

const allThrees: ComplexityScores = {
  taxonomySpan: 3, dataEntities: 3, integrations: 3,
  novelty: 3, regulatory: 3, costEstimate: 3, techDebt: 3,
};

describe("assessComplexity", () => {
  it("routes all-1s (total 7) to simple", () => {
    const result = assessComplexity(allOnes);
    expect(result.total).toBe(7);
    expect(result.path).toBe("simple");
  });
  it("routes total 10 to simple", () => {
    const scores: ComplexityScores = { ...allOnes, dataEntities: 2, integrations: 2, novelty: 2 };
    expect(assessComplexity(scores).path).toBe("simple");
  });
  it("routes total 11 to moderate", () => {
    const scores: ComplexityScores = { ...allOnes, dataEntities: 2, integrations: 2, novelty: 2, regulatory: 2 };
    expect(assessComplexity(scores).path).toBe("moderate");
  });
  it("routes total 16 to moderate", () => {
    const scores: ComplexityScores = { ...allOnes, taxonomySpan: 2, dataEntities: 3, integrations: 3, novelty: 2, regulatory: 2, costEstimate: 2, techDebt: 2 };
    expect(assessComplexity(scores).path).toBe("moderate");
  });
  it("routes total 17 to complex", () => {
    const scores: ComplexityScores = { ...allOnes, taxonomySpan: 3, dataEntities: 3, integrations: 3, novelty: 2, regulatory: 2, costEstimate: 2, techDebt: 2 };
    expect(assessComplexity(scores).path).toBe("complex");
  });
  it("routes all-3s (total 21) to complex", () => {
    expect(assessComplexity(allThrees).path).toBe("complex");
  });
  it("returns scores in the result", () => {
    expect(assessComplexity(allOnes).scores).toEqual(allOnes);
  });
});
