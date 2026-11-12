import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES, deriveOperationalValueStream, deriveTwinValueStreamBinding } from "@dpf/storefront-templates";

import { bindWorkroomStageQueues, boundShapeRefs, it4itStreamOf, workroomQueuesByStage } from "./workroom-stage-binding";

const archetype = (id: string) => ALL_ARCHETYPES.find((a) => a.archetypeId === id)!;

describe("bindWorkroomStageQueues", () => {
  it("binds delivery-shape stages on Integrate and Deploy to a software platform's Deliver stage", () => {
    const def = archetype("software-platform");
    const bound = bindWorkroomStageQueues(deriveTwinValueStreamBinding(def), deriveOperationalValueStream(def).it4itStageBinding, ["delivery-small@1.0.0"]);
    const deliver = bound.stages.find((stage) => stage.stageKey === "deliver")!;
    expect(deliver.queueKeys).toEqual(expect.arrayContaining([
      "wr:delivery-small@1.0.0:reproduce",
      "wr:delivery-small@1.0.0:repair",
      "wr:delivery-small@1.0.0:merge",
      "wr:delivery-small@1.0.0:runtime-check",
    ]));
    expect(bound.queueToStage["wr:delivery-small@1.0.0:repair"]).toBe("deliver");
    expect(workroomQueuesByStage(bound).get("deliver")).toHaveLength(4);
    expect([...boundShapeRefs(bound)]).toEqual(["delivery-small@1.0.0"]);
  });

  it("binds nothing for an archetype whose IT4IT binding covers no delivery stream", () => {
    const binding = deriveTwinValueStreamBinding(archetype("software-platform"));
    expect(bindWorkroomStageQueues(binding, ["request-to-fulfill"], ["delivery-small@1.0.0"])).toBe(binding);
  });

  it("leaves the archetype's own twin queues where they were", () => {
    const def = archetype("software-platform");
    const binding = deriveTwinValueStreamBinding(def);
    const bound = bindWorkroomStageQueues(binding, ["requirement-to-deploy"], ["delivery-small@1.0.0"]);
    for (const stage of binding.stages) {
      const after = bound.stages.find((candidate) => candidate.stageKey === stage.stageKey)!;
      expect(after.queueKeys.filter((key) => !key.startsWith("wr:"))).toEqual(stage.queueKeys);
    }
  });
});

describe("it4itStreamOf", () => {
  it("names the 3.0.1 stream a stage reference belongs to", () => {
    expect(it4itStreamOf("5.3.4")).toBe("Integrate");
    expect(it4itStreamOf("5.4.4")).toBe("Deploy");
    expect(it4itStreamOf("9.9.9")).toBeNull();
  });
});
