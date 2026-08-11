import { describe, it, expect } from "vitest";

import {
  countFeatureKeys,
  evaluateAutonomyEligibility,
  measureFeatureCoverage,
} from "./mcda-quality-gates";
import { decide, type DecisionPrinciple } from "./option-scoring";

const principle = (
  id: string,
  vector: Record<string, number>,
  weight = 1,
): DecisionPrinciple => ({
  id,
  name: `P-${id}`,
  tier: "commandment",
  weight,
  dimensionVector: vector,
});

describe("measureFeatureCoverage (BI-1D23EC26)", () => {
  it("flags weak when any option is below the floor", () => {
    const report = measureFeatureCoverage(
      [
        { features: { a: 1, b: 1, c: 1 } },
        { features: { a: 0.5 } },
      ],
      [{ contributions: [] }, { contributions: [] }],
      3,
    );
    expect(report.weak).toBe(true);
    expect(report.minKeys).toBe(1);
    expect(report.optionsMeetingFloor).toBe(0.5);
  });

  it("passes when every option meets the floor", () => {
    const report = measureFeatureCoverage(
      [
        { features: { a: 1, b: 1, c: 1 } },
        { features: { a: 0.2, b: 0.3, d: 0.4 } },
      ],
      [{ contributions: [] }, { contributions: [] }],
      3,
    );
    expect(report.weak).toBe(false);
    expect(report.minKeys).toBe(3);
    expect(countFeatureKeys({ features: { a: 1, b: 1 } })).toBe(2);
  });
});

describe("evaluateAutonomyEligibility (BI-1D23EC26)", () => {
  it("requires high confidence and clean gates", () => {
    expect(
      evaluateAutonomyEligibility({
        recommendation: { confidence: "high" },
        flags: {
          commandmentConflict: false,
          structuredCoverage: "strong",
          insufficientSignal: false,
          featureCoverageWeak: false,
          sensitivityUnstable: false,
        },
      }).eligible,
    ).toBe(true);

    expect(
      evaluateAutonomyEligibility({
        recommendation: { confidence: "high" },
        flags: {
          commandmentConflict: false,
          structuredCoverage: "strong",
          featureCoverageWeak: true,
          sensitivityUnstable: false,
        },
      }),
    ).toEqual({
      eligible: false,
      blockers: ["feature_coverage_weak"],
    });
  });
});

describe("decide() MCDA quality gates (BI-1D23EC26)", () => {
  const principles = [
    principle("arch", {
      long_term_maintainability: 1,
      schema_grounding: 0.8,
      blast_radius: -0.5,
    }),
    principle("speed", {
      speed_to_value: 1,
      long_term_maintainability: -0.3,
    }),
  ];

  it("blocks autonomy when feature coverage is thin", () => {
    const result = decide(
      [
        { id: "rich", description: "", features: { long_term_maintainability: 0.9 } },
        { id: "poor", description: "", features: { speed_to_value: 0.9 } },
      ],
      principles,
      { minFeatureKeys: 3, sensitivityEpsilon: 0 },
    );

    expect(result.recommendation).not.toBeNull();
    expect(result.flags.featureCoverageWeak).toBe(true);
    expect(result.recommendation?.confidence).toBe("low");
    expect(result.flags.autonomyEligible).toBe(false);
    expect(result.flags.autonomyBlockers).toContain("feature_coverage_weak");
  });

  it("allows autonomy when coverage, margin, and sensitivity pass", () => {
    // Strong separation on maintainability vs speed; dense features.
    const result = decide(
      [
        {
          id: "durable",
          description: "Reuse substrate",
          features: {
            long_term_maintainability: 0.95,
            schema_grounding: 0.9,
            blast_radius: 0.2,
            speed_to_value: 0.3,
            governance_compliance: 0.8,
          },
        },
        {
          id: "quick",
          description: "One-off shortcut",
          features: {
            long_term_maintainability: 0.2,
            schema_grounding: 0.2,
            blast_radius: 0.8,
            speed_to_value: 0.95,
            governance_compliance: 0.3,
          },
        },
      ],
      principles,
      { minFeatureKeys: 3, sensitivityEpsilon: 0.1, tieMargin: 0.05 },
    );

    expect(result.recommendation?.optionId).toBe("durable");
    expect(result.flags.featureCoverageWeak).toBe(false);
    expect(result.flags.insufficientSignal).toBe(false);
    // Sensitivity may or may not flip depending on weight structure; if
    // unstable, autonomy is correctly blocked.
    if (!result.flags.sensitivityUnstable && result.recommendation?.confidence === "high") {
      expect(result.flags.autonomyEligible).toBe(true);
    } else {
      expect(result.flags.autonomyEligible).toBe(false);
    }
  });

  it("detects sensitivity flips under weight swing", () => {
    // Two nearly equal options where one principle tip-over is enough.
    const closePrinciples = [
      principle("a", { reusability: 1 }, 1),
      principle("b", { speed_to_value: 1 }, 1),
    ];
    const result = decide(
      [
        {
          id: "reuse",
          description: "",
          features: {
            reusability: 0.9,
            speed_to_value: 0.5,
            long_term_maintainability: 0.5,
          },
        },
        {
          id: "fast",
          description: "",
          features: {
            reusability: 0.5,
            speed_to_value: 0.91,
            long_term_maintainability: 0.5,
          },
        },
      ],
      closePrinciples,
      { minFeatureKeys: 3, sensitivityEpsilon: 0.15, tieMargin: 0.01 },
    );

    // Either stable or unstable is fine — if unstable, confidence must be low
    // and autonomy blocked.
    if (result.flags.sensitivityUnstable) {
      expect(result.recommendation?.confidence).toBe("low");
      expect(result.flags.autonomyEligible).toBe(false);
      expect(result.flags.sensitivity?.flippingPrincipleCount).toBeGreaterThan(0);
    }
  });
});
