// BI-4EB33E54 (live, 2026-09-25): FB-D671B016's orchestrator was 22 minutes into its first
// Claude task and had written no BuildActivity since dispatch (it records task
// results only when the whole run ends). The contradictory-state reconciler saw
// a quiet build, cleared its checkpoint "for clean restart", and the stranded
// resumer would have dispatched a second pipeline on top of the live one.
import { describe, expect, it, vi } from "vitest";

import { recentlyActiveBuildIds, withOrchestrationRunning } from "./build-liveness";

const quietDb = () => ({ buildActivity: { findMany: vi.fn().mockResolvedValue([]) } });

describe("a running orchestration is live even when it writes no rows", () => {
  it("counts a build as live for the whole orchestration, and not after", async () => {
    const db = quietDb();
    let seenDuringRun: Set<string> | null = null;

    await withOrchestrationRunning("FB-LIVE", async () => {
      seenDuringRun = await recentlyActiveBuildIds(db as never, ["FB-LIVE", "FB-OTHER"], new Date());
    });

    expect(seenDuringRun).toEqual(new Set(["FB-LIVE"]));
    expect(await recentlyActiveBuildIds(db as never, ["FB-LIVE"], new Date())).toEqual(new Set());
  });

  it("releases the build when the orchestration throws", async () => {
    await expect(withOrchestrationRunning("FB-THROWS", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await recentlyActiveBuildIds(quietDb() as never, ["FB-THROWS"], new Date())).toEqual(new Set());
  });
});
