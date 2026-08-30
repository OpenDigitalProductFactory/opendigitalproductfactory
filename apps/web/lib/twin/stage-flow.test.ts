import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { deriveTwinValueStreamBinding } from "@dpf/storefront-templates";

import { buildStageFlow } from "./stage-flow";

function bindingFor(archetypeId: string) {
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!archetype) throw new Error(`no archetype ${archetypeId}`);
  return deriveTwinValueStreamBinding(archetype);
}

describe("buildStageFlow", () => {
  it("marks a stage observable only when a queue or a zone binds to it", () => {
    const binding = bindingFor("pet-rescue");
    const flow = buildStageFlow(binding, {});

    for (const stage of flow) {
      const bound = binding.stages.find((s) => s.stageKey === stage.stageKey)!;
      expect(stage.observable).toBe(bound.queueKeys.length > 0 || bound.zoneKeys.length > 0);
    }
  });

  it("finds pet-rescue's day is almost entirely unobservable — the reason the strip read all zeros", () => {
    const flow = buildStageFlow(bindingFor("pet-rescue"), {});

    expect(flow).toHaveLength(16);
    const observable = flow.filter((s) => s.observable).map((s) => s.stageKey);
    expect(observable).toEqual(["intake-capacity-decision"]);
  });

  it("still carries the demand it is given for a stage that is observed", () => {
    const flow = buildStageFlow(bindingFor("pet-rescue"), {
      "intake-capacity-decision": { count: 3, longestWaitMs: 90 * 60_000 },
    });

    const stage = flow.find((s) => s.stageKey === "intake-capacity-decision")!;
    expect(stage).toMatchObject({ observable: true, count: 3, longestWait: "2h" });
  });

  it("does not report an archetype as fully unobservable when it is not", () => {
    const flow = buildStageFlow(bindingFor("restaurant"), {});
    expect(flow.filter((s) => s.observable).length).toBeGreaterThan(0);
    expect(flow.filter((s) => !s.observable).length).toBeGreaterThan(0);
  });
});
