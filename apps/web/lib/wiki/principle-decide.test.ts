// Phase 2 Task 2.5 of the principles-as-wiki-kind plan: principle_decide
// core math. Pure-function tests; no I/O.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §11
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 2 Tasks 2.5)

import { describe, expect, it } from "vitest";
import {
  computeStructuredAlignment,
  computeSemanticAlignment,
  buildOptionScores,
  type DecisionOption,
  type DecisionPrinciple,
} from "./principle-decide";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function principle(
  id: string,
  overrides: Partial<DecisionPrinciple> = {},
): DecisionPrinciple {
  return {
    id,
    name: id,
    tier: "core",
    weight: 0.4,
    dimensionVector: {},
    ...overrides,
  };
}

function option(
  id: string,
  features: Record<string, number> = {},
  overrides: Partial<DecisionOption> = {},
): DecisionOption {
  return {
    id,
    description: id,
    features,
    ...overrides,
  };
}

// ─── computeStructuredAlignment ─────────────────────────────────────────────

describe("computeStructuredAlignment", () => {
  it("reproduces the spec section 11.4 worked example for Option B against Architecture Over Shortcuts", () => {
    // Principle Architecture Over Shortcuts: dimensionVector
    //   long_term_maintainability=1.0, schema_grounding=0.8, speed_to_value=-0.4
    // Option B features:
    //   long_term_maintainability=0.9, schema_grounding=0.8, speed_to_value=0.3
    // alignment = ((0.9*1.0) + (0.8*0.8) + (0.3*-0.4)) / (|1.0|+|0.8|+|-0.4|)
    //           = (0.9 + 0.64 - 0.12) / 2.2
    //           = 1.42 / 2.2
    //           ≈ 0.645
    const p = principle("arch", {
      dimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
        speed_to_value: -0.4,
      },
    });
    const opt = option("B", {
      long_term_maintainability: 0.9,
      schema_grounding: 0.8,
      speed_to_value: 0.3,
    });
    const { alignment } = computeStructuredAlignment(opt, p);
    expect(alignment).toBeCloseTo(0.645, 3);
  });

  it("reproduces Option A from the worked example (-0.009)", () => {
    const p = principle("arch", {
      dimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
        speed_to_value: -0.4,
      },
    });
    const opt = option("A", {
      long_term_maintainability: 0.1,
      schema_grounding: 0.3,
      speed_to_value: 0.9,
    });
    const { alignment } = computeStructuredAlignment(opt, p);
    // ((0.1*1.0) + (0.3*0.8) + (0.9*-0.4)) / 2.2
    // = (0.1 + 0.24 - 0.36) / 2.2 = -0.02 / 2.2 ≈ -0.009
    expect(alignment).toBeCloseTo(-0.009, 3);
  });

  it("treats option dimensions missing from its features as 0 (no contribution)", () => {
    const p = principle("p", {
      dimensionVector: { schema_grounding: 1.0, speed_to_value: -0.5 },
    });
    // Option only has schema_grounding; speed_to_value defaults to 0
    const opt = option("o", { schema_grounding: 0.6 });
    const { alignment, missingDimensions } = computeStructuredAlignment(opt, p);
    // (0.6*1.0 + 0*-0.5) / (1.0 + 0.5) = 0.6 / 1.5 = 0.4
    expect(alignment).toBeCloseTo(0.4, 3);
    expect(missingDimensions).toEqual(["speed_to_value"]);
  });

  it("returns alignment=0 and reports missing dimensions when the option supplies none", () => {
    const p = principle("p", {
      dimensionVector: { schema_grounding: 1.0, speed_to_value: -0.5 },
    });
    const opt = option("o", {}); // no features
    const { alignment, missingDimensions } = computeStructuredAlignment(opt, p);
    expect(alignment).toBe(0);
    expect(missingDimensions.sort()).toEqual([
      "schema_grounding",
      "speed_to_value",
    ]);
  });

  it("returns alignment=0 when the principle has an empty dimension vector (no shared axes)", () => {
    const p = principle("p", { dimensionVector: {} });
    const opt = option("o", { schema_grounding: 0.5 });
    const { alignment } = computeStructuredAlignment(opt, p);
    expect(alignment).toBe(0);
  });
});

// ─── computeSemanticAlignment ───────────────────────────────────────────────

describe("computeSemanticAlignment", () => {
  it("returns cosine similarity between option embedding and principle direction embedding", () => {
    const p = principle("p", { directionEmbedding: [1, 0, 0, 0] });
    const opt = option("o", {}, { embedding: [1, 0, 0, 0] });
    const { alignment, mode } = computeSemanticAlignment(opt, p);
    expect(alignment).toBeCloseTo(1.0, 5);
    expect(mode).toBe("semantic");
  });

  it("returns 0 for orthogonal embeddings", () => {
    const p = principle("p", { directionEmbedding: [1, 0] });
    const opt = option("o", {}, { embedding: [0, 1] });
    const { alignment } = computeSemanticAlignment(opt, p);
    expect(alignment).toBeCloseTo(0, 5);
  });

  it("returns 0 when either embedding is missing (degraded fallback)", () => {
    const p = principle("p", {}); // no embedding
    const opt = option("o", {}, { embedding: [1, 0] });
    const { alignment } = computeSemanticAlignment(opt, p);
    expect(alignment).toBe(0);
  });

  it("returns 0 when either embedding has zero norm", () => {
    const p = principle("p", { directionEmbedding: [0, 0, 0] });
    const opt = option("o", {}, { embedding: [1, 0, 0] });
    const { alignment } = computeSemanticAlignment(opt, p);
    expect(alignment).toBe(0);
  });
});

// ─── buildOptionScores (composite + contribution ledger) ───────────────────

describe("buildOptionScores", () => {
  it("composes the spec section 11.4 worked example end-to-end", () => {
    const principles: DecisionPrinciple[] = [
      principle("arch", {
        name: "Architecture Over Shortcuts",
        tier: "commandment",
        weight: 1.0,
        dimensionVector: {
          long_term_maintainability: 1.0,
          schema_grounding: 0.8,
          speed_to_value: -0.4,
        },
      }),
    ];
    const optionA = option("A", {
      long_term_maintainability: 0.1,
      schema_grounding: 0.3,
      speed_to_value: 0.9,
    });
    const optionB = option("B", {
      long_term_maintainability: 0.9,
      schema_grounding: 0.8,
      speed_to_value: 0.3,
    });

    const scores = buildOptionScores([optionA, optionB], principles);

    const a = scores.find((s) => s.optionId === "A")!;
    const b = scores.find((s) => s.optionId === "B")!;
    expect(a.composite).toBeCloseTo(-0.009, 3);
    expect(b.composite).toBeCloseTo(0.645, 3);
    expect(b.composite).toBeGreaterThan(a.composite);
  });

  it("returns one contribution per principle per option with weight and alignment recorded", () => {
    const p1 = principle("p1", {
      tier: "commandment",
      weight: 1.0,
      dimensionVector: { schema_grounding: 1.0 },
    });
    const p2 = principle("p2", {
      tier: "core",
      weight: 0.4,
      dimensionVector: { speed_to_value: 1.0 },
    });
    const o = option("o", { schema_grounding: 1.0, speed_to_value: 0.5 });

    const [score] = buildOptionScores([o], [p1, p2]);
    expect(score.contributions).toHaveLength(2);
    const c1 = score.contributions.find((c) => c.principleId === "p1")!;
    const c2 = score.contributions.find((c) => c.principleId === "p2")!;
    expect(c1.weight).toBe(1.0);
    expect(c1.alignment).toBeCloseTo(1.0, 5);
    expect(c1.contribution).toBeCloseTo(1.0, 5); // weight * alignment
    expect(c2.weight).toBe(0.4);
    expect(c2.alignment).toBeCloseTo(0.5, 5);
    expect(c2.contribution).toBeCloseTo(0.2, 5); // 0.4 * 0.5

    // Composite is the sum of contributions
    expect(score.composite).toBeCloseTo(1.0 + 0.2, 5);
  });

  it("falls back to semantic alignment when a principle has no dimension vector (mode='semantic')", () => {
    const p = principle("p", {
      directionEmbedding: [1, 0, 0],
      dimensionVector: {}, // empty → semantic fallback
    });
    const o = option("o", {}, { embedding: [1, 0, 0] });
    const [score] = buildOptionScores([o], [p]);
    expect(score.contributions[0].mode).toBe("semantic");
    expect(score.contributions[0].alignment).toBeCloseTo(1.0, 5);
  });

  it("marks contributions as structured when the principle has a dimension vector AND the option supplies at least one matching feature", () => {
    const p = principle("p", {
      dimensionVector: { schema_grounding: 1.0 },
      directionEmbedding: [1, 0, 0], // unused
    });
    const o = option("o", { schema_grounding: 0.7 });
    const [score] = buildOptionScores([o], [p]);
    expect(score.contributions[0].mode).toBe("structured");
  });

  it("attaches missingDimensions for structured contributions only", () => {
    const p = principle("p", {
      dimensionVector: { schema_grounding: 1.0, speed_to_value: -0.4 },
    });
    const o = option("o", { schema_grounding: 0.5 });
    const [score] = buildOptionScores([o], [p]);
    expect(score.contributions[0].mode).toBe("structured");
    expect(score.contributions[0].missingDimensions).toEqual(["speed_to_value"]);
  });

  it("handles the empty-options case as an empty result (no scores to compute)", () => {
    const p = principle("p", { dimensionVector: { schema_grounding: 1.0 } });
    expect(buildOptionScores([], [p])).toEqual([]);
  });

  it("handles the empty-principles case (each option gets a 0 composite, no contributions)", () => {
    const o = option("o", { schema_grounding: 1.0 });
    const [score] = buildOptionScores([o], []);
    expect(score.composite).toBe(0);
    expect(score.contributions).toEqual([]);
  });
});
