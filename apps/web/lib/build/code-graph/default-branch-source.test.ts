// BI-86EF5900 acceptance 1: "The index is built from the default branch, and
// lastIndexedBranch proves it."
//
// Live evidence for why: the graph was fully healthy (47,544 nodes, 56,593
// edges) and still answered "no" for MileageRate, because PROJECT_ROOT is
// /sandbox-workspace parked on client/5727856b-… — a Build Studio sandbox
// branch that genuinely lacks the model.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyExec: () => execMock,
  lazyPath: () => ({ resolve: (...p: string[]) => p.join("/") }),
  getCwd: () => "/cwd",
}));

import {
  CODE_GRAPH_WORKTREE_DIRNAME,
  resolveDefaultBranchRef,
  resolveIndexSource,
} from "./default-branch-source";

const ok = (stdout: string) => ({ stdout, stderr: "" });
const SHA = "0ad91e688c2f5f3a4512d11ce0a845c4aa63d9ca";

beforeEach(() => execMock.mockReset());

describe("resolveDefaultBranchRef", () => {
  it("prefers origin/main and reports the branch label without the remote", async () => {
    execMock.mockResolvedValueOnce(ok(`${SHA}\n`));
    expect(await resolveDefaultBranchRef("/repo")).toEqual({
      ref: "origin/main",
      branch: "main",
      sha: SHA,
    });
  });

  it("falls through the candidate list when origin/main is absent", async () => {
    execMock
      .mockRejectedValueOnce(new Error("unknown revision"))   // origin/main
      .mockRejectedValueOnce(new Error("unknown revision"))   // origin/master
      .mockResolvedValueOnce(ok(`${SHA}\n`));                 // main
    const r = await resolveDefaultBranchRef("/repo");
    expect(r?.ref).toBe("main");
    expect(r?.branch).toBe("main");
  });

  it("returns null when no default branch exists at all", async () => {
    // Empty stdout is the same "no such ref" signal as a throw, without
    // manufacturing rejected promises the runner reports as unhandled.
    execMock.mockResolvedValue(ok(""));
    expect(await resolveDefaultBranchRef("/repo")).toBeNull();
  });

  it("scopes safe.directory so container ownership cannot block resolution", async () => {
    execMock.mockResolvedValueOnce(ok(`${SHA}\n`));
    await resolveDefaultBranchRef("/sandbox-workspace");
    expect(String(execMock.mock.calls[0]?.[0])).toContain('-c safe.directory="/sandbox-workspace"');
  });
});

describe("resolveIndexSource", () => {
  it("indexes the pinned default-branch worktree and records that branch", async () => {
    execMock
      .mockResolvedValueOnce(ok(`${SHA}\n`))   // rev-parse origin/main
      .mockResolvedValueOnce(ok(`${SHA}\n`));  // rev-parse HEAD in the worktree — already pinned

    const src = await resolveIndexSource("/sandbox-workspace");

    expect(src.usedDefaultBranch).toBe(true);
    expect(src.root).toBe(`/sandbox-workspace/${CODE_GRAPH_WORKTREE_DIRNAME}`);
    expect(src.branch).toBe("main");
    expect(src.sha).toBe(SHA);
    expect(src.warning).toBeNull();
  });

  it("creates the worktree when none exists yet", async () => {
    execMock
      .mockResolvedValueOnce(ok(`${SHA}\n`))                        // rev-parse origin/main
      .mockRejectedValueOnce(new Error("not a git repository"))     // no worktree yet
      .mockResolvedValueOnce(ok("Preparing worktree\n"));           // worktree add

    const src = await resolveIndexSource("/sandbox-workspace");

    expect(src.usedDefaultBranch).toBe(true);
    expect(String(execMock.mock.calls[2]?.[0])).toContain("worktree add --detach --force");
  });

  it("fast-forwards a worktree parked on an older sha", async () => {
    execMock
      .mockResolvedValueOnce(ok(`${SHA}\n`))     // origin/main
      .mockResolvedValueOnce(ok("olddeadbeef\n")) // worktree HEAD differs
      .mockResolvedValueOnce(ok("HEAD is now at\n"));

    const src = await resolveIndexSource("/sandbox-workspace");
    expect(src.usedDefaultBranch).toBe(true);
    expect(String(execMock.mock.calls[2]?.[0])).toContain(`reset --hard ${SHA}`);
  });

  // Degrading to the host tree must stay possible AND explained — a graph that
  // silently indexes the wrong branch is the defect, not the fallback.
  it("falls back to the host tree WITH a reason when the worktree cannot be prepared", async () => {
    execMock
      .mockResolvedValueOnce(ok(`${SHA}\n`))                    // origin/main
      .mockRejectedValueOnce(new Error("not a git repository")) // no worktree
      .mockRejectedValueOnce(new Error("fatal: cannot add"))    // add fails
      .mockRejectedValueOnce(new Error("nope"));                // worktree list

    const src = await resolveIndexSource("/sandbox-workspace");

    expect(src.usedDefaultBranch).toBe(false);
    expect(src.root).toBe("/sandbox-workspace");
    expect(src.warning).toContain("Could not prepare the default-branch worktree");
  });

  it("falls back with a reason when the repo has no default branch", async () => {
    execMock.mockResolvedValue(ok(""));
    const src = await resolveIndexSource("/repo");
    expect(src.usedDefaultBranch).toBe(false);
    expect(src.warning).toContain("No default branch");
  });
});
