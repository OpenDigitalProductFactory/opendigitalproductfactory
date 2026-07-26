import { describe, expect, it, vi } from "vitest";
import {
  parseBuildBranchIds,
  parseBuildWorktreeDirNames,
  runSandboxBuildGc,
  shouldGcSandboxBuildBranch,
  shouldGcSandboxWorktreeDir,
  SANDBOX_BUILD_GC_ENABLED_FLAG,
  SANDBOX_BUILD_GC_DELETE_BRANCHES_FLAG,
} from "./sandbox-build-gc";

describe("sandbox-build-gc pure rules (BI-8BD61C30)", () => {
  it("gc worktree dir for missing and terminal phases only", () => {
    expect(shouldGcSandboxWorktreeDir(null)).toBe(true);
    expect(shouldGcSandboxWorktreeDir("complete")).toBe(true);
    expect(shouldGcSandboxWorktreeDir("failed")).toBe(true);
    expect(shouldGcSandboxWorktreeDir("abandoned")).toBe(true);
    expect(shouldGcSandboxWorktreeDir("build")).toBe(false);
    expect(shouldGcSandboxWorktreeDir("ideate")).toBe(false);
  });

  it("gc build branch only for aged terminal builds", () => {
    const now = new Date("2026-07-26T00:00:00Z");
    const grace = 7 * 86400_000;
    expect(
      shouldGcSandboxBuildBranch({
        phase: "complete",
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        now,
        graceMs: grace,
      }),
    ).toBe(true);
    expect(
      shouldGcSandboxBuildBranch({
        phase: "complete",
        updatedAt: new Date("2026-07-25T00:00:00Z"),
        now,
        graceMs: grace,
      }),
    ).toBe(false);
    expect(
      shouldGcSandboxBuildBranch({
        phase: "build",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        now,
        graceMs: grace,
      }),
    ).toBe(false);
  });

  it("parses .builds dir names and build/* branches", () => {
    expect(parseBuildWorktreeDirNames("FB-ADA4BA8F\nFB-6AF43DEB\n.smoke-check\n")).toEqual([
      "FB-ADA4BA8F",
      "FB-6AF43DEB",
    ]);
    expect(parseBuildBranchIds("  build/FB-1\n* build/FB-2\n  main\n")).toEqual(["FB-1", "FB-2"]);
  });
});

describe("runSandboxBuildGc", () => {
  it("skips when flag off", async () => {
    const result = await runSandboxBuildGc({ env: {} });
    expect(result.skipped).toBe(true);
  });

  it("removes terminal/orphan worktrees and keeps active", async () => {
    const removeWorktree = vi.fn(async () => {});
    const deleteBranch = vi.fn(async () => {});
    const result = await runSandboxBuildGc({
      env: { [SANDBOX_BUILD_GC_ENABLED_FLAG]: "1" },
      sandboxUp: async () => true,
      listWorktreeDirs: async () => ["FB-OLD", "FB-LIVE", "FB-ORPHAN"],
      listBuildBranches: async () => ["FB-OLD", "FB-LIVE"],
      lookupPhases: async () =>
        new Map([
          ["FB-OLD", { phase: "complete", updatedAt: new Date("2026-01-01") }],
          ["FB-LIVE", { phase: "build", updatedAt: new Date() }],
        ]),
      removeWorktree,
      deleteBranch,
      now: new Date("2026-07-26"),
    });
    expect(result.skipped).toBe(false);
    expect(result.worktreesRemoved.sort()).toEqual(["FB-OLD", "FB-ORPHAN"].sort());
    expect(result.keptActive).toEqual(["FB-LIVE"]);
    expect(deleteBranch).not.toHaveBeenCalled(); // branch delete flag off
    expect(removeWorktree).toHaveBeenCalledTimes(2);
  });

  it("deletes aged terminal branches when branch flag on", async () => {
    const deleteBranch = vi.fn(async () => {});
    const result = await runSandboxBuildGc({
      env: {
        [SANDBOX_BUILD_GC_ENABLED_FLAG]: "1",
        [SANDBOX_BUILD_GC_DELETE_BRANCHES_FLAG]: "1",
      },
      sandboxUp: async () => true,
      listWorktreeDirs: async () => [],
      listBuildBranches: async () => ["FB-AGED", "FB-FRESH"],
      lookupPhases: async () =>
        new Map([
          ["FB-AGED", { phase: "abandoned", updatedAt: new Date("2026-01-01") }],
          ["FB-FRESH", { phase: "complete", updatedAt: new Date("2026-07-25") }],
        ]),
      removeWorktree: async () => {},
      deleteBranch,
      now: new Date("2026-07-26"),
    });
    expect(result.branchesDeleted).toEqual(["FB-AGED"]);
    expect(deleteBranch).toHaveBeenCalledWith("FB-AGED");
  });
});
