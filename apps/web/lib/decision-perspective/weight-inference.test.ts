import { describe, expect, it } from "vitest";
import {
  inferWeightProposals,
  WEIGHT_INFERENCE_DEFAULTS,
  PROPOSED_CONFIDENCE_WEIGHT,
  ruledTierForProposal,
  type WeightInferenceObservation,
} from "./weight-inference";
import { STANCE_TIERS } from "./stance-promotion";

// BI-D88DFEEA. The engine turns override history into weight-adjustment
// PROPOSALS. These tests pin the properties that keep it honest: it never
// mutates, it refuses to learn from too few samples, it only fires on a
// consistent and non-trivial direction, and a fresh proposal can never out-vote
// an authored stance before a human rules on it.

/** N decisions where the human chose an option scoring `chosen` on `axis` and
 *  the kernel recommended one scoring `recommended`. */
function decisions(
  n: number,
  axis: string,
  chosen: number,
  recommended: number,
  opts: { domainClass?: string; profileId?: string } = {},
): WeightInferenceObservation[] {
  return Array.from({ length: n }, () => ({
    domainClass: opts.domainClass ?? "plan-readiness",
    profileId: opts.profileId ?? "prof-1",
    chosenVector: { [axis]: chosen },
    recommendedVector: { [axis]: recommended },
  }));
}

describe("inferWeightProposals — the sample floor", () => {
  it("emits nothing below minSampleSize, however consistent", () => {
    // 5 perfectly-consistent overrides, floor is 8.
    const obs = decisions(5, "long_term_maintainability", 0.9, 0.2);
    expect(inferWeightProposals(obs)).toEqual([]);
  });

  it("fires once the floor is met", () => {
    const obs = decisions(8, "long_term_maintainability", 0.9, 0.2);
    const [p] = inferWeightProposals(obs);
    expect(p).toBeDefined();
    expect(p.axis).toBe("long_term_maintainability");
    expect(p.sampleSize).toBe(8);
  });
});

describe("inferWeightProposals — direction", () => {
  it("proposes INCREASE when the human consistently chose higher on the axis", () => {
    const [p] = inferWeightProposals(decisions(10, "schema_grounding", 0.9, 0.3));
    expect(p.direction).toBe("increase");
    expect(p.meanSeparation).toBeCloseTo(0.6);
  });

  it("proposes DECREASE when the human consistently chose lower on the axis", () => {
    const [p] = inferWeightProposals(decisions(10, "speed_to_value", 0.2, 0.9));
    expect(p.direction).toBe("decrease");
    expect(p.meanSeparation).toBeCloseTo(-0.7);
  });
});

describe("inferWeightProposals — noise rejection", () => {
  it("rejects an axis with no consistent direction", () => {
    // Half the decisions go each way — no systematic override.
    const up = decisions(6, "blast_radius", 0.8, 0.2);
    const down = decisions(6, "blast_radius", 0.2, 0.8);
    expect(inferWeightProposals([...up, ...down])).toEqual([]);
  });

  it("rejects a consistent but negligibly small separation", () => {
    // Always higher, but by 0.05 — below minMeanSeparation 0.1.
    const [p] = inferWeightProposals(decisions(12, "reusability", 0.55, 0.5));
    expect(p).toBeUndefined();
  });

  it("counts agreements in the base but does not let them manufacture a signal", () => {
    // Human agreed with the kernel every time on this axis (sep 0). No proposal.
    expect(inferWeightProposals(decisions(10, "governance_compliance", 0.5, 0.5))).toEqual([]);
  });
});

describe("inferWeightProposals — grouping and floors are per (domainClass, profile)", () => {
  it("does not pool observations across groups to clear the floor", () => {
    // 5 in one group + 5 in another = 10 total, but neither group reaches 8.
    const g1 = decisions(5, "long_term_maintainability", 0.9, 0.2, { domainClass: "a" });
    const g2 = decisions(5, "long_term_maintainability", 0.9, 0.2, { domainClass: "b" });
    expect(inferWeightProposals([...g1, ...g2])).toEqual([]);
  });

  it("keeps proposals scoped to their own group", () => {
    const g1 = decisions(8, "schema_grounding", 0.9, 0.2, { profileId: "prof-A" });
    const g2 = decisions(8, "speed_to_value", 0.2, 0.9, { profileId: "prof-B" });
    const proposals = inferWeightProposals([...g1, ...g2]);
    const byProfile = Object.fromEntries(proposals.map((p) => [p.profileId, p]));
    expect(byProfile["prof-A"].axis).toBe("schema_grounding");
    expect(byProfile["prof-A"].direction).toBe("increase");
    expect(byProfile["prof-B"].axis).toBe("speed_to_value");
    expect(byProfile["prof-B"].direction).toBe("decrease");
  });
});

describe("inferWeightProposals — a missing axis is 'not exhibited', i.e. 0", () => {
  it("treats an axis absent from the recommended option as 0", () => {
    const obs: WeightInferenceObservation[] = Array.from({ length: 8 }, () => ({
      domainClass: "plan-readiness",
      profileId: "prof-1",
      chosenVector: { data_privacy: 0.8 },
      recommendedVector: {}, // kernel pick did not exhibit data_privacy at all
    }));
    const [p] = inferWeightProposals(obs);
    expect(p.axis).toBe("data_privacy");
    expect(p.direction).toBe("increase");
    expect(p.meanSeparation).toBeCloseTo(0.8);
  });
});

describe("proposal authority — never out-votes an authored stance on arrival", () => {
  it("enters strictly below the lowest authored stance tier", () => {
    const [p] = inferWeightProposals(decisions(8, "long_term_maintainability", 0.9, 0.2));
    expect(p.entersAtTier).toBe("proposed");
    expect(p.entersAtConfidenceWeight).toBe(PROPOSED_CONFIDENCE_WEIGHT);
    expect(p.entersAtConfidenceWeight).toBeLessThan(STANCE_TIERS.unconfirmed.confidenceWeight);
  });

  it("reaches the same `ruled` rung as authored material once a human rules", () => {
    // Reuse, not a second authority model.
    expect(ruledTierForProposal()).toBe("ruled");
    expect(STANCE_TIERS[ruledTierForProposal()].confidenceWeight).toBe(1.0);
  });
});

describe("inferWeightProposals — output ordering", () => {
  it("returns the strongest signal first", () => {
    const strong = decisions(10, "schema_grounding", 1.0, 0.0, { profileId: "p1" }); // consistency 1.0
    const weaker = [
      ...decisions(8, "reusability", 0.9, 0.2, { profileId: "p2" }),
      ...decisions(2, "reusability", 0.2, 0.9, { profileId: "p2" }), // one dissent → lower consistency
    ];
    const proposals = inferWeightProposals([...strong, ...weaker]);
    expect(proposals[0].axis).toBe("schema_grounding");
    expect(proposals[0].consistency).toBeGreaterThanOrEqual(proposals[1].consistency);
  });
});

describe("config is honored", () => {
  it("respects a lowered floor", () => {
    const obs = decisions(3, "long_term_maintainability", 0.9, 0.2);
    const relaxed = { ...WEIGHT_INFERENCE_DEFAULTS, minSampleSize: 3 };
    expect(inferWeightProposals(obs, relaxed)).toHaveLength(1);
  });
});
