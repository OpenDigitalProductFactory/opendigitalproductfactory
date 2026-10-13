import { describe, expect, it } from "vitest";

import { SPLIT_2, SPLIT_NESTED } from "./__fixtures__/graph-shapes/parallel";
import { shapeLane, shapeSignature, touchesOutside } from "./shape-signature";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition, type WorkShapeStage } from "./work-shapes";

const stage = (overrides: Partial<WorkShapeStage>): WorkShapeStage => ({
  key: "sweep",
  title: "Sweep",
  accountablePrincipalRef: "agent:security-engineer",
  advance: { kind: "status-change", condition: "swept" },
  evidence: [],
  ...overrides,
});

describe("shapeLane — derived from the accountable principal, never declared", () => {
  it.each([
    ["agent:security-engineer", "AI"],
    ["role:owner", "Person"],
    ["person:PRN-1", "Person"],
    ["team:ops", "Unknown"],
  ] as const)("%s → %s", (ref, lane) => {
    expect(shapeLane({ accountablePrincipalRef: ref })).toBe(lane);
  });
});

describe("touchesOutside — a conversation with someone outside is a touchpoint", () => {
  it("marks a stage whose evidence is a conversation turn", () => {
    expect(touchesOutside({ evidence: ["conversation-turn"] })).toBe(true);
    expect(touchesOutside({ evidence: ["draft-artifact"] })).toBe(false);
  });
});

describe("shapeSignature", () => {
  it("reads trigger → steps → gate → ends, and shows who decides without inventing an authority", () => {
    const signature = shapeSignature({
      triggers: ["cadence"],
      stages: [
        stage({ key: "sweep" }),
        stage({ key: "raise" }),
        stage({
          key: "decide",
          accountablePrincipalRef: "role:owner",
          advance: { kind: "governed-decision", condition: "decided", decisionScope: "security-advisory-response" },
        }),
      ],
      stopConditions: [
        { kind: "success", condition: "resolved", disposition: "proceed" },
        { kind: "failure", condition: "refused", disposition: "refused" },
      ],
    });
    expect(signature).toBe("⏱ cadence · AI sweep → AI raise → ◇ Person decide [role:owner] → ● success | ⊗ failure");
    expect(signature).not.toMatch(/WWMD|WWWD|WSID/);
  });

  it("marks an outside touchpoint on the step", () => {
    const signature = shapeSignature({
      triggers: ["claim"],
      stages: [stage({ key: "reply", accountablePrincipalRef: "role:owner", evidence: ["conversation-turn"] })],
      stopConditions: [],
    });
    expect(signature).toBe("✋ claim · Person reply ⇄");
  });

  it("draws a declared parallel split as branches, not as a straight line", () => {
    expect(shapeSignature(SPLIT_2)).toContain("AI a → ( AI b ∥ AI c ) → AI d");
  });

  it("draws a split nested inside a branch", () => {
    expect(shapeSignature(SPLIT_NESTED)).toContain("AI a → ( AI b ∥ ( AI c ∥ AI d ) → AI e ) → AI f");
  });

  it("marks a rework edge on the stage it leaves", () => {
    const signature = shapeSignature({
      triggers: ["claim"],
      stages: [stage({ key: "draft" }), stage({ key: "review" })],
      stopConditions: [],
      flow: {
        nodes: [],
        edges: [
          { from: "draft", to: "review" },
          { from: "review", to: "draft", rework: { maxIterations: 3 } },
          { from: "review", to: "success" },
        ],
      },
    });
    expect(signature).toBe("✋ claim · AI draft → AI review ↺draft");
  });

  it("gives every current and frozen prior shape a signature with no unknown lane", () => {
    const all: WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
    const signatures = Object.fromEntries(
      all.map((definition) => [`${definition.key}@${definition.version}`, shapeSignature(definition)]),
    );
    expect(Object.keys(signatures)).toHaveLength(all.length);
    for (const [key, signature] of Object.entries(signatures)) {
      expect(signature, key).not.toContain("Unknown");
      expect(signature, key).toMatch(/^\S+ [a-z-]+.* · /);
    }
    // One reviewed record of every signature; a shape change shows up as a diff here.
    expect(signatures).toMatchSnapshot();
  });
});
