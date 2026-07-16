import { describe, it, expect } from "vitest";

import type { DecisionPrinciple } from "./option-scoring";
import { evaluateGoldenDrift, driftedScenarios } from "./decision-drift";
import { GOLDEN_SCENARIOS } from "./golden-decisions";

function commandment(
  id: string,
  dimensionVector: Record<string, number>,
  weight = 1,
): DecisionPrinciple {
  return { id, name: id, tier: "commandment", weight, dimensionVector };
}

// A corpus that holds BOTH golden winners: rewards maintainability/soundness
// (scenario 1 → proper fix) while penalizing blast radius and rewarding cost
// efficiency (scenario 2 → the cheap sound option, not the maximalist rebuild).
const HEALTHY_CORPUS: DecisionPrinciple[] = [
  commandment("proper-fix-over-quick-fix", {
    long_term_maintainability: 0.9,
    schema_grounding: 0.5,
    blast_radius: -0.3,
    speed_to_value: -0.4,
  }),
  commandment("remove-avoidable-failure", {
    blast_radius: -0.7,
    cost_efficiency: 0.7,
    long_term_maintainability: 0.3,
  }),
];

describe("evaluateGoldenDrift", () => {
  it("reports no drift when the corpus holds every golden winner", () => {
    const results = evaluateGoldenDrift(HEALTHY_CORPUS);
    expect(results).toHaveLength(GOLDEN_SCENARIOS.length);
    for (const r of results) {
      expect(r.actualWinner).toBe(r.expectedWinner);
      expect(r.drifted).toBe(false);
      expect(r.driftKind).toBeNull();
    }
    expect(driftedScenarios(results)).toHaveLength(0);
  });

  it("flags a flip when the corpus favors the shortcut", () => {
    // A corpus that only rewards speed flips the quick-vs-proper call.
    const speedOnly = [commandment("ship-fast", { speed_to_value: 1 })];
    const results = evaluateGoldenDrift(speedOnly);
    const s1 = results.find((r) => r.scenarioId === "quick-vs-proper-normal");
    expect(s1?.drifted).toBe(true);
    expect(s1?.driftKind).toBe("flip");
    expect(s1?.actualWinner).toBe("quick-runtime-patch");
    expect(s1?.actualWinner).not.toBe(s1?.expectedWinner);
    expect(s1?.topContributors.length).toBeGreaterThan(0);
  });

  it("flags drift when the corpus is empty (no doctrine to hold the call)", () => {
    const results = evaluateGoldenDrift([]);
    for (const r of results) {
      expect(r.drifted).toBe(true);
    }
  });

  it("driftedScenarios orders flips before thin margins", () => {
    const results = [
      { scenarioId: "a", rationale: "", expectedWinner: "x", actualWinner: "x", margin: 0.05, marginFloor: 0.1, drifted: true, driftKind: "thin-margin" as const, topContributors: [] },
      { scenarioId: "b", rationale: "", expectedWinner: "x", actualWinner: "y", margin: 0.4, marginFloor: 0.3, drifted: true, driftKind: "flip" as const, topContributors: [] },
      { scenarioId: "c", rationale: "", expectedWinner: "x", actualWinner: "x", margin: 0.5, marginFloor: 0.1, drifted: false, driftKind: null, topContributors: [] },
    ];
    const drifted = driftedScenarios(results);
    expect(drifted.map((d) => d.scenarioId)).toEqual(["b", "a"]);
  });
});
