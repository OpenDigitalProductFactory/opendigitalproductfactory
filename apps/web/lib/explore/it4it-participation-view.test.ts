import { describe, it, expect } from "vitest";
import { shapeIt4itParticipationGrid, type It4itStageParticipationRow } from "./it4it-participation-view";
import type { It4itComponentCoverage } from "./reference-model-types";

function component(over: Partial<It4itComponentCoverage> & { id: string; name: string; capabilityGroup: string }): It4itComponentCoverage {
  return {
    status: "partial",
    score: 50,
    confidence: null,
    criteriaCount: 0,
    requiredCriteriaCount: 0,
    criteria: [],
    ...over,
  };
}

const components: It4itComponentCoverage[] = [
  component({ id: "ea", name: "Enterprise Architecture", capabilityGroup: "Strategy to Portfolio", status: "implemented", score: 100 }),
  component({ id: "pr", name: "Problem", capabilityGroup: "Detect to Correct", status: "partial", score: 65 }),
];

const stages: It4itStageParticipationRow[] = [
  { stream: "Evaluate", participation: { "Enterprise Architecture": "●", Problem: null } },
  { stream: "Evaluate", participation: { "Enterprise Architecture": "●" } }, // second Evaluate stage, union
  { stream: "Operate", participation: { Problem: "●", "Enterprise Architecture": null } },
];

describe("shapeIt4itParticipationGrid", () => {
  it("returns empty when there are no components", () => {
    const g = shapeIt4itParticipationGrid({ components: [], valueStreams: ["Evaluate"], stageParticipation: stages });
    expect(g.hasData).toBe(false);
  });

  it("de-duplicates streams and orders groups canonically", () => {
    const g = shapeIt4itParticipationGrid({
      components,
      valueStreams: ["Evaluate", "Operate", "Evaluate"],
      stageParticipation: stages,
    });
    expect(g.hasData).toBe(true);
    expect(g.streams).toEqual(["Evaluate", "Operate"]);
    expect(g.groups.map((x) => x.group)).toEqual(["Strategy to Portfolio", "Detect to Correct"]);
  });

  it("collapses stage participation up to the value stream and cross-tabs by component", () => {
    const g = shapeIt4itParticipationGrid({ components, valueStreams: ["Evaluate", "Operate"], stageParticipation: stages });
    const ea = g.groups.flatMap((x) => x.rows).find((r) => r.componentId === "ea")!;
    expect(ea.participatesIn).toEqual({ Evaluate: true, Operate: false });
    expect(ea.streamCount).toBe(1);
    expect(ea.status).toBe("implemented");
    const pr = g.groups.flatMap((x) => x.rows).find((r) => r.componentId === "pr")!;
    expect(pr.participatesIn).toEqual({ Evaluate: false, Operate: true });
  });

  it("treats null / blank marks as non-participation", () => {
    const g = shapeIt4itParticipationGrid({
      components: [component({ id: "ea", name: "Enterprise Architecture", capabilityGroup: "Strategy to Portfolio" })],
      valueStreams: ["Evaluate"],
      stageParticipation: [{ stream: "Evaluate", participation: { "Enterprise Architecture": null } }],
    });
    expect(g.groups[0].rows[0].participatesIn.Evaluate).toBe(false);
    expect(g.groups[0].rows[0].streamCount).toBe(0);
  });
});
