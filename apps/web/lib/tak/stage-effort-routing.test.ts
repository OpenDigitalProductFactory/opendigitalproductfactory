import { describe, expect, it } from "vitest";

import { TIER_MINIMUM_DIMENSIONS } from "@/lib/routing/quality-tiers";
import { deriveEffortWarrant } from "./effort-warrant";
import { applyDeclaredEffortRouting, scheduledStageEffortArgs } from "./stage-effort-routing";

// Phase G (proactivity & capacity allocation §6.1) — the ONE mapping from a
// declared stage tier to routing: low → cheapest capable, high → frontier floor.
describe("applyDeclaredEffortRouting", () => {
  const adequate = { ...TIER_MINIMUM_DIMENSIONS.adequate };

  it("leaves an undeclared turn untouched (same object contents)", () => {
    const config = { minimumDimensions: adequate, budgetClass: "quality_first" as const };
    expect(applyDeclaredEffortRouting(config, undefined)).toEqual(config);
    expect(applyDeclaredEffortRouting(config, null)).toEqual(config);
  });

  it("routes a low (or minimal) stage to the cheapest CAPABLE model: budget class only, floor kept", () => {
    const config = { minimumDimensions: adequate, budgetClass: "quality_first" as const };
    for (const tier of ["low", "minimal"] as const) {
      const out = applyDeclaredEffortRouting(config, tier);
      expect(out.budgetClass).toBe("minimize_cost");
      expect(out.minimumDimensions).toEqual(adequate);
    }
  });

  it("leaves a medium stage on the coworker's configured routing", () => {
    const config = { minimumDimensions: adequate, budgetClass: "balanced" as const };
    expect(applyDeclaredEffortRouting(config, "medium")).toEqual(config);
  });

  it("raises a high stage to at least the frontier floor, never lowering a stricter one", () => {
    const out = applyDeclaredEffortRouting({ minimumDimensions: adequate, budgetClass: "minimize_cost" }, "high");
    expect(out.minimumDimensions).toEqual(TIER_MINIMUM_DIMENSIONS.frontier);
    // Budget class is not raised — high is a capability floor, not a cost target.
    expect(out.budgetClass).toBe("minimize_cost");
    const stricter = applyDeclaredEffortRouting({ minimumDimensions: { reasoning: 95, safety: 60 } }, "high");
    expect(stricter.minimumDimensions).toEqual({ ...TIER_MINIMUM_DIMENSIONS.frontier, reasoning: 95, safety: 60 });
    expect(applyDeclaredEffortRouting<{ minimumDimensions?: Record<string, number> }>({}, "high").minimumDimensions).toEqual(TIER_MINIMUM_DIMENSIONS.frontier);
  });
});

describe("scheduledStageEffortArgs", () => {
  it("adds nothing for a task with no stage record — today's call, unchanged", () => {
    expect(scheduledStageEffortArgs(null, { toolNames: [], messageChars: 4000 })).toEqual({});
    expect(scheduledStageEffortArgs({ trigger: { kind: "time" } }, { toolNames: [], messageChars: 10 })).toEqual({});
  });

  it("derives the warrant from the declared stage tier", () => {
    const args = scheduledStageEffortArgs(
      { workroomStage: { shapeKey: "s", stageKey: "decide", effort: "high" } },
      { toolNames: ["list_backlog_items"], messageChars: 100 },
    );
    expect(args).toEqual({
      effortWarrant: deriveEffortWarrant({
        declaredEffort: "high", availableToolNames: ["list_backlog_items"], messageChars: 100,
      }),
    });
    expect(args.effortWarrant?.declaredEffort).toBe("high");
  });
});
