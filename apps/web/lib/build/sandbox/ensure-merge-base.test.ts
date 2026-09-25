// BI-21F77660 (live, 2026-09-25): the sandbox repository is shallow (origin/main had a
// history of one commit), so the in-platform gauntlet found "no merge base
// against origin/main", ran every guard unscoped, and the diff guards failed on
// changes the build never made (FB-D671B016: 15 failed guards).
import { describe, expect, it, vi } from "vitest";

import { ensureMergeBaseWithMain } from "./ensure-merge-base";

describe("ensureMergeBaseWithMain", () => {
  it("does nothing when a merge base already exists", async () => {
    const exec = vi.fn().mockResolvedValueOnce("b763bddeeb05\n__MB_OK__\n");
    expect(await ensureMergeBaseWithMain({ exec, containerId: "c", workdir: "/w" })).toEqual({ found: true, deepened: 0 });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("deepens origin/main until the merge base appears, bounded", async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce("__MB_NONE__\n")   // probe
      .mockResolvedValueOnce("")                  // deepen 1
      .mockResolvedValueOnce("__MB_NONE__\n")   // probe
      .mockResolvedValueOnce("")                  // deepen 2
      .mockResolvedValueOnce("b763bdd\n__MB_OK__\n");
    expect(await ensureMergeBaseWithMain({ exec, containerId: "c", workdir: "/w" })).toEqual({ found: true, deepened: 2 });
    expect(exec).toHaveBeenCalledWith("c", expect.stringContaining("git fetch -q --deepen="));
  });

  it("reports honestly when no merge base can be reached", async () => {
    const exec = vi.fn(async (_c: string, cmd: string) => (cmd.includes("merge-base") ? "__MB_NONE__\n" : ""));
    expect(await ensureMergeBaseWithMain({ exec, containerId: "c", workdir: "/w", maxRounds: 3 })).toEqual({ found: false, deepened: 3 });
  });
});
