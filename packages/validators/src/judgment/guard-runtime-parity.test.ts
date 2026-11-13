import { describe, expect, it } from "vitest";
import * as canonical from "./option-scoring.js";
import * as distribution from "../../../../scripts/generated/judgment/option-scoring.js";

const principle: canonical.DecisionPrinciple = {
  id: "synthetic-cost", name: "Higher cost magnitudes are worse", tier: "core", weight: .4,
  dimensionVector: { benefit: 1, effort: -1, quality: 1 },
};
const options: canonical.DecisionOption[] = [
  { id: "a", description: "Lower cost", features: { benefit: .8, effort: .1, quality: .9 } },
  { id: "b", description: "Higher cost", features: { benefit: .8, effort: .9, quality: .9 } },
];
const scenarios: { name: string; options: canonical.DecisionOption[]; principles: canonical.DecisionPrinciple[]; config?: canonical.DecideConfig }[] = [
  { name: "signed cost, contributions and sensitivity", options, principles: [principle] },
  { name: "empty corpus", options, principles: [] },
  { name: "missing-feature no-signal abstention", options: options.map((o) => ({ ...o, features: {} })), principles: [principle] },
  { name: "semantic fallback", options: options.map((o, i) => ({ ...o, features: {}, embedding: i === 0 ? [1, 0] : [0, 1] })), principles: [{ ...principle, dimensionVector: {}, directionEmbedding: [1, 0] }] },
  { name: "commandment conflict", options, principles: [{ ...principle, tier: "commandment", weight: 1, dimensionVector: { benefit: -1 } }] },
  { name: "tie and routine stakes", options: [options[0]!, { ...options[0]!, id: "tie" }], principles: [principle], config: { stakes: "routine" } },
  { name: "sensitivity winner flip", options, principles: [principle, { ...principle, id: "opposed", dimensionVector: { effort: 1 }, weight: .4 / 3 }], config: { sensitivityEpsilon: .5 } },
];

describe("generated Node20 guard distribution parity with canonical TypeScript", () => {
  it.each(scenarios)("$name preserves complete result and serialization", ({ options, principles, config }) => {
    const expected = canonical.decide(options, principles, config);
    const actual = distribution.decide(options, principles, config);
    expect(actual).toEqual(expected);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  });
  it("actually exercises an unstable sensitivity fixture", () => {
    const fixture = scenarios.find((scenario) => scenario.name === "sensitivity winner flip")!;
    expect(canonical.decide(fixture.options, fixture.principles, fixture.config).flags.sensitivityUnstable).toBe(true);
  });
  it("preserves legacy verdict reads when new fields are absent", () => {
    const value = canonical.decide(options, [principle]);
    const legacy = { ...value.recommendation!, verdict: undefined, verdictCause: undefined };
    expect(distribution.readVerdict(legacy, value.flags)).toEqual(canonical.readVerdict(legacy, value.flags));
  });
});
