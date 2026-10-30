import { describe, expect, it } from "vitest";

import { PLATFORM_DELIVERY_GRAMMAR } from "@/lib/lifecycle-grammars";

import { getWorkShape } from "./work-shapes";
import { it4itStageRefFor, WORK_SHAPE_STAGE_IT4IT } from "./workroom-stage-it4it";

describe("WORK_SHAPE_STAGE_IT4IT", () => {
  it("names only real stages of real shapes, and only references the delivery grammar covers", () => {
    const grammarStages = new Set(PLATFORM_DELIVERY_GRAMMAR.stages.map((stage) => stage.key));
    for (const [shapeKey, stages] of Object.entries(WORK_SHAPE_STAGE_IT4IT)) {
      const shape = getWorkShape(shapeKey);
      expect(shape, shapeKey).toBeTruthy();
      const shapeStages = new Set(shape!.stages.map((stage) => stage.key));
      for (const [stageKey, ref] of Object.entries(stages)) {
        expect(shapeStages.has(stageKey), `${shapeKey}:${stageKey}`).toBe(true);
        expect(grammarStages.has(ref), `${shapeKey}:${stageKey} → ${ref}`).toBe(true);
      }
    }
  });

  it("binds every stage of the four sequential delivery shapes", () => {
    for (const shapeKey of ["delivery-break-fix", "delivery-small", "delivery-medium", "delivery-large"]) {
      for (const stage of getWorkShape(shapeKey)!.stages) expect(it4itStageRefFor(`${shapeKey}@1.0.0`, stage.key), `${shapeKey}:${stage.key}`).not.toBeNull();
    }
  });

  it("resolves by shape key whatever the version, and returns null without a binding", () => {
    expect(it4itStageRefFor("delivery-small@9.0.0", "repair")).toBe("5.3.4");
    expect(it4itStageRefFor("dependency-advisory-watch@1.0.0", "triage")).toBeNull();
    expect(it4itStageRefFor(null, "repair")).toBeNull();
    expect(it4itStageRefFor("delivery-small@1.0.0", null)).toBeNull();
  });
});
