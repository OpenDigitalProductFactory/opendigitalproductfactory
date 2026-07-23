// BI-85341A52: the kernel-evolution discipline (spec 2026-05-24 §4.3) makes an
// overlap scan mandatory before any new principle merges, and prescribes running
// it as a `principle_decide` call carrying the candidate's principleDirection as
// a FEATURELESS option — the contribution ledger is then read to find the closest
// existing principles.
//
// That procedure returned an all-zero ledger against the live kernel
// (DI-69C4965333C3). Mode selection read only the principle side, so any
// principle declaring a dimension vector — nearly the whole kernel — forced the
// structured path, where a featureless option is arithmetically pinned to
// alignment 0. BI-3C1A6451 had already made the MCP pack embed the option
// description server-side for precisely this case; the embedding was computed
// and then never consulted.
//
// These tests pin the both-sides rule: zero shared dimensions falls through to
// semantic, and any shared dimension still scores structured exactly as before.

import { describe, it, expect } from "vitest";

import {
  buildOptionScores,
  decide,
  hasScoreableOverlap,
  type DecisionOption,
  type DecisionPrinciple,
} from "./option-scoring";

/** A unit vector pointing along `axis`, so cosine similarity is readable by eye. */
const unit = (axis: 0 | 1 | 2): number[] => [0, 1, 2].map((i) => (i === axis ? 1 : 0));

const vectoredPrinciple = (
  id: string,
  directionEmbedding?: number[],
): DecisionPrinciple => ({
  id,
  name: `Principle ${id}`,
  tier: "commandment",
  weight: 1,
  // The shape that made the scan unrunnable: a real dimension vector, which is
  // what every commandment and most core principles carry.
  dimensionVector: { long_term_maintainability: 0.9, reusability: 0.7 },
  directionEmbedding,
});

const featurelessOption = (id: string, embedding?: number[]): DecisionOption => ({
  id,
  description: `candidate direction ${id}`,
  features: {},
  embedding,
});

describe("hasScoreableOverlap", () => {
  it("is false when the option scores none of the principle's dimensions", () => {
    expect(
      hasScoreableOverlap(featurelessOption("a"), vectoredPrinciple("p1")),
    ).toBe(false);
  });

  it("is false when the option's features share no key with the vector", () => {
    const option: DecisionOption = {
      id: "a",
      description: "",
      features: { public_safety: 0.8 },
    };
    expect(hasScoreableOverlap(option, vectoredPrinciple("p1"))).toBe(false);
  });

  it("is true on partial overlap — one shared dimension is enough", () => {
    const option: DecisionOption = {
      id: "a",
      description: "",
      features: { reusability: 0.4 },
    };
    expect(hasScoreableOverlap(option, vectoredPrinciple("p1"))).toBe(true);
  });

  it("is false when the principle declares no dimensions at all", () => {
    const semanticOnly: DecisionPrinciple = {
      id: "p2",
      name: "Principle p2",
      tier: "core",
      weight: 0.4,
      dimensionVector: {},
    };
    const option: DecisionOption = {
      id: "a",
      description: "",
      features: { reusability: 0.4 },
    };
    expect(hasScoreableOverlap(option, semanticOnly)).toBe(false);
  });
});

describe("overlap scan — featureless option against a vectored principle (BI-85341A52)", () => {
  it("scores semantically instead of returning a zero structured row", () => {
    // Both embeddings present is the real MCP path: the pack embeds the
    // principle's direction AND the option's description when features are empty.
    const near = vectoredPrinciple("near", unit(0));
    const far = vectoredPrinciple("far", unit(1));

    const [score] = buildOptionScores(
      [featurelessOption("candidate", unit(0))],
      [near, far],
    );

    const rows = Object.fromEntries(
      score.contributions.map((c) => [c.principleId, c]),
    );

    expect(rows.near.mode).toBe("semantic");
    expect(rows.far.mode).toBe("semantic");
    // The whole point of the scan: the ledger now RANKS, so the closest existing
    // principle is identifiable.
    expect(rows.near.alignment).toBeCloseTo(1, 5);
    expect(rows.far.alignment).toBeCloseTo(0, 5);
    expect(rows.near.alignment).toBeGreaterThan(rows.far.alignment);
  });

  it("produces a non-zero ledger and no insufficient-signal flag", () => {
    const result = decide(
      [
        featurelessOption("candidate-a", unit(0)),
        featurelessOption("candidate-b", unit(1)),
      ],
      [vectoredPrinciple("p1", unit(0))],
    );

    expect(result.flags.insufficientSignal).toBe(false);
    expect(result.scores.some((s) => s.composite !== 0)).toBe(true);
  });

  it("reports the fallback honestly as weak structured coverage", () => {
    // A scan is 100% semantic by construction. The caller should be told that,
    // not shown a confident-looking structured ledger of zeros.
    const result = decide(
      [
        featurelessOption("candidate-a", unit(0)),
        featurelessOption("candidate-b", unit(1)),
      ],
      [vectoredPrinciple("p1", unit(0))],
    );

    expect(result.flags.semanticFallbackRatio).toBe(1);
    expect(result.flags.structuredCoverage).toBe("weak");
  });
});

describe("no regression for callers that supply features", () => {
  it("keeps structured mode and missingDimensions on partial coverage", () => {
    const option: DecisionOption = {
      id: "a",
      description: "",
      // Overlaps on one of the principle's two axes.
      features: { long_term_maintainability: 1 },
      embedding: unit(2),
    };

    const [score] = buildOptionScores([option], [vectoredPrinciple("p1", unit(2))]);
    const row = score.contributions[0];

    expect(row.mode).toBe("structured");
    expect(row.missingDimensions).toEqual(["reusability"]);
    // 1 × 0.9 / (0.9 + 0.7)
    expect(row.alignment).toBeCloseTo(0.5625, 5);
  });

  it("still returns no recommendation when there is genuinely no signal", () => {
    // Featureless AND embedding-less: semantic cannot fire either, so the
    // BI-5CE7CF0B zero-signal guard must still hold rather than crowning
    // input order.
    const result = decide(
      [featurelessOption("warn_only"), featurelessOption("hard_gate_all")],
      [vectoredPrinciple("p1"), vectoredPrinciple("p2")],
    );

    expect(result.recommendation).toBeNull();
    expect(result.flags.insufficientSignal).toBe(true);
  });
});
