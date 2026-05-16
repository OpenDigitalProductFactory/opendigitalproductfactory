import { describe, expect, it } from "vitest";

import {
  parseGitStatusPorcelain,
  parseBranchList,
  parsePrUrlFromText,
  parseWorktreeList,
  shouldSurfaceAdoptableBranch,
} from "./git-scanner";

describe("git scanner parsing", () => {
  it("parses dirty and untracked file counts", () => {
    const parsed = parseGitStatusPorcelain(" M apps/web/a.ts\n?? tmp/out.txt\nA  docs/new.md\n");

    expect(parsed.modifiedCount).toBe(2);
    expect(parsed.untrackedCount).toBe(1);
  });

  it("parses worktree list porcelain output", () => {
    const worktrees = parseWorktreeList(
      "worktree D:/DPF\nHEAD abc123\nbranch refs/heads/main\n\n" +
        "worktree D:/DPF-feature\nHEAD def456\nbranch refs/heads/feat/demo\n",
    );

    expect(worktrees).toEqual([
      { path: "D:/DPF", headSha: "abc123", branch: "main" },
      { path: "D:/DPF-feature", headSha: "def456", branch: "feat/demo" },
    ]);
  });

  it("extracts a PR URL from text", () => {
    expect(
      parsePrUrlFromText(
        "see https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/596",
      ),
    ).toBe("https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/596");
  });

  it("parses local branch names and trims empty lines", () => {
    expect(parseBranchList("main\nfeat/work-capsule\n  fix/recovery  \n\n")).toEqual([
      "main",
      "feat/work-capsule",
      "fix/recovery",
    ]);
  });

  it("surfaces dirty worktrees and recent ahead branches", () => {
    expect(shouldSurfaceAdoptableBranch({
      hasOpenPr: false,
      dirtyCount: 1,
      aheadCount: 0,
      lastCommitAt: null,
      now: new Date("2026-05-14"),
    })).toBe(true);
    expect(shouldSurfaceAdoptableBranch({
      hasOpenPr: false,
      dirtyCount: 0,
      aheadCount: 1,
      lastCommitAt: new Date("2026-05-01"),
      now: new Date("2026-05-14"),
    })).toBe(true);
    expect(shouldSurfaceAdoptableBranch({
      hasOpenPr: false,
      dirtyCount: 0,
      aheadCount: 1,
      lastCommitAt: new Date("2025-12-01"),
      now: new Date("2026-05-14"),
    })).toBe(false);
  });
});
