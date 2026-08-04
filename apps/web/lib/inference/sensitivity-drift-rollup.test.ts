import { describe, expect, it } from "vitest";
import {
  rollUpSensitivityDrift,
  type SensitivityDriftSample,
} from "./sensitivity-drift-rollup";

function sample(over: Partial<SensitivityDriftSample> = {}): SensitivityDriftSample {
  return {
    taskType: "creative",
    agentId: "marketing-specialist",
    declaredSensitivity: "confidential",
    measuredSensitivity: "internal",
    sensitivityFloorApplied: true,
    ...over,
  };
}

describe("rollUpSensitivityDrift", () => {
  it("flags a group whose declared label sits above what its payload measures", () => {
    const rollup = rollUpSensitivityDrift([sample(), sample(), sample()]);

    expect(rollup.drifting).toHaveLength(1);
    const [group] = rollup.drifting;
    expect(group.agentId).toBe("marketing-specialist");
    expect(group.taskType).toBe("creative");
    expect(group.declared).toBe("confidential");
    expect(group.measured).toBe("internal");
    expect(group.observations).toBe(3);
    expect(group.flooredObservations).toBe(3);
    // One level of over-declaration: internal -> confidential.
    expect(group.levelsAbove).toBe(1);
  });

  it("does not flag a payload that justifies its declared level", () => {
    const rollup = rollUpSensitivityDrift([
      sample({ measuredSensitivity: "confidential", sensitivityFloorApplied: false }),
    ]);

    expect(rollup.drifting).toEqual([]);
    expect(rollup.aligned).toBe(1);
  });

  it("never flags a payload measuring ABOVE its declared label", () => {
    // The floor only raises. A payload measuring higher than the route label is
    // the screen doing its job, not a mislabelled route — reporting it as drift
    // would invert the meaning and invite someone to lower a correct label.
    const rollup = rollUpSensitivityDrift([
      sample({ declaredSensitivity: "internal", measuredSensitivity: "restricted" }),
    ]);

    expect(rollup.drifting).toEqual([]);
    expect(rollup.aligned).toBe(1);
  });

  it("separates receipts predating the drift fields from genuinely aligned ones", () => {
    // Receipts written before the drift fields shipped carry neither level.
    // Counting them as "aligned" would report a clean estate that was never
    // measured, so they are held in their own bucket.
    const rollup = rollUpSensitivityDrift([
      { taskType: "creative", agentId: "a" },
      sample(),
    ]);

    expect(rollup.observationsMissingDriftFields).toBe(1);
    expect(rollup.observationsWithDriftFields).toBe(1);
    expect(rollup.aligned).toBe(0);
  });

  it("groups independently per agent and task type", () => {
    const rollup = rollUpSensitivityDrift([
      sample(),
      sample({ agentId: "finance-analyst" }),
      sample({ taskType: "summarize" }),
    ]);

    expect(rollup.drifting).toHaveLength(3);
    expect(rollup.drifting.every((g) => g.observations === 1)).toBe(true);
  });

  it("ranks the worst over-declaration first, then by how often it is observed", () => {
    const rollup = rollUpSensitivityDrift([
      // 1 level above, seen twice
      sample({ agentId: "a", declaredSensitivity: "confidential", measuredSensitivity: "internal" }),
      sample({ agentId: "a", declaredSensitivity: "confidential", measuredSensitivity: "internal" }),
      // 3 levels above, seen once — the more severe mislabel
      sample({ agentId: "b", declaredSensitivity: "restricted", measuredSensitivity: "public" }),
    ]);

    expect(rollup.drifting.map((g) => g.agentId)).toEqual(["b", "a"]);
    expect(rollup.drifting[0].levelsAbove).toBe(3);
  });

  it("reports an empty estate without inventing a clean bill of health", () => {
    const rollup = rollUpSensitivityDrift([]);

    expect(rollup.drifting).toEqual([]);
    expect(rollup.aligned).toBe(0);
    expect(rollup.observationsWithDriftFields).toBe(0);
    expect(rollup.observationsMissingDriftFields).toBe(0);
  });
});
