import { describe, expect, it, vi } from "vitest";

import { settleRenderRelevantBootReconcilers } from "./render-relevant-boot-reconcilers";

describe("settleRenderRelevantBootReconcilers", () => {
  it("settles the schedule and all three onboarding writers before measurement", async () => {
    const events: string[] = [];
    const task = (name: string) => vi.fn(async () => {
      events.push(`start:${name}`);
      await Promise.resolve();
      events.push(`end:${name}`);
    });
    const reconcilers = {
      infrastructurePruneSchedule: task("schedule"),
      archetypeWorkforce: task("workforce"),
      commercialCatalog: task("catalog"),
      discoveryEstate: task("discovery"),
    };

    await settleRenderRelevantBootReconcilers(true, reconcilers);

    expect(events).toEqual([
      "start:schedule",
      "end:schedule",
      "start:workforce",
      "end:workforce",
      "start:catalog",
      "end:catalog",
      "start:discovery",
      "end:discovery",
    ]);
    for (const reconciler of Object.values(reconcilers)) {
      expect(reconciler).toHaveBeenCalledOnce();
    }
  });
});
