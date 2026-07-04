import { describe, it, expect } from "vitest";

import {
  humanizeDimension,
  buildMatrixDimensions,
  buildMatrixTierWeights,
} from "./principle-matrix";

describe("humanizeDimension", () => {
  it("sentence-cases a snake_case key", () => {
    expect(humanizeDimension("long_term_maintainability")).toBe(
      "Long term maintainability",
    );
    expect(humanizeDimension("blast_radius")).toBe("Blast radius");
  });
});

describe("buildMatrixDimensions", () => {
  const dims = buildMatrixDimensions();

  it("includes every registry dimension exactly once", () => {
    const keys = dims.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("blast_radius");
    expect(keys).toContain("long_term_maintainability");
  });

  it("classifies known cost axes as costs and orders benefits before costs", () => {
    const blast = dims.find((d) => d.key === "blast_radius");
    const maint = dims.find((d) => d.key === "long_term_maintainability");
    expect(blast?.kind).toBe("cost");
    expect(maint?.kind).toBe("benefit");
    const firstCostIdx = dims.findIndex((d) => d.kind === "cost");
    const lastBenefitIdx =
      dims.length - 1 - [...dims].reverse().findIndex((d) => d.kind === "benefit");
    expect(lastBenefitIdx).toBeLessThan(firstCostIdx);
  });
});

describe("buildMatrixTierWeights", () => {
  it("returns the three tiers in descending weight order", () => {
    const tiers = buildMatrixTierWeights();
    expect(tiers.map((t) => t.tier)).toEqual(["commandment", "core", "contextual"]);
    expect(tiers[0].weight).toBeGreaterThan(tiers[1].weight);
    expect(tiers[1].weight).toBeGreaterThan(tiers[2].weight);
  });
});
