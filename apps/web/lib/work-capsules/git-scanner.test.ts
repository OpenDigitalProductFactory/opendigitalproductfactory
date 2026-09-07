import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  isReachableFromTrunk,
  parseGitStatusPorcelain,
  parseBranchList,
  parsePrUrlFromText,
  parseWorktreeList,
  shouldSurfaceAdoptableBranch,
  trunkHasMergedPullRequest,
  trunkRefExists,
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

// Real-git contract tests for the workroom-closeout DELIVERED signal. Read-only
// (rev-parse / merge-base --is-ancestor), no mutation. Environment-tolerant:
// the trunk-dependent assertions run only where a local trunk ref is present, so
// the file stays green in a checkout that has not fetched origin/main.
describe("delivered-signal git helpers (procedural, local)", () => {
  it("trunkRefExists is false for a non-repo path", async () => {
    expect(await trunkRefExists(tmpdir())).toBe(false);
  });

  it("isReachableFromTrunk returns null for a missing sha (no git call)", async () => {
    expect(await isReachableFromTrunk(process.cwd(), null)).toBeNull();
    expect(await isReachableFromTrunk(process.cwd(), undefined)).toBeNull();
  });

  it("decides reachability against a present local trunk", async () => {
    const repoRoot = process.cwd();
    if (!(await trunkRefExists(repoRoot))) return; // no local trunk here → skip
    // The trunk tip is trivially an ancestor of itself → reachable/merged.
    expect(await isReachableFromTrunk(repoRoot, "origin/main")).toBe(true);
    // A well-formed but nonexistent sha is indeterminate → null, never a false merged.
    expect(await isReachableFromTrunk(repoRoot, "0000000000000000000000000000000000000000")).toBeNull();
  });
});

describe("trunkHasMergedPullRequest (BI-AFE8BB73)", () => {
  it("is null for an invalid number or a non-repo path, never a false merged", async () => {
    expect(await trunkHasMergedPullRequest(process.cwd(), null)).toBeNull();
    expect(await trunkHasMergedPullRequest(process.cwd(), 0)).toBeNull();
    expect(await trunkHasMergedPullRequest(tmpdir(), 5119)).toBeNull();
  });

  it("finds a merged PR's squash commit on a present local trunk and not a never-merged number", async () => {
    const repoRoot = process.cwd();
    if (!(await trunkRefExists(repoRoot))) return; // no local trunk here → skip
    // #5119 landed on main on 2026-09-06 (fix(readiness): child inherits parent scope).
    expect(await trunkHasMergedPullRequest(repoRoot, 5119)).toBe(true);
    expect(await trunkHasMergedPullRequest(repoRoot, 99999999)).toBe(false);
  });
});
