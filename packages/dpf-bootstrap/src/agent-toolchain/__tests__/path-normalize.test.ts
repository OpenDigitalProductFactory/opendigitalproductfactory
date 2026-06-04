import { describe, it, expect } from "vitest";

import { normalizeRepoPath, repoPathsMatch } from "../path-normalize";

describe("normalizeRepoPath", () => {
  it("collapses Windows-native double-backslash to forward slashes", () => {
    expect(normalizeRepoPath("D:\\DPF\\.claude\\worktrees\\X")).toBe("d:/DPF/.claude/worktrees/X");
  });

  it("collapses single-backslash to forward slashes", () => {
    expect(normalizeRepoPath("D:\\DPF\\X")).toBe("d:/DPF/X");
  });

  it("leaves forward-slash form unchanged except drive-letter lowercase", () => {
    expect(normalizeRepoPath("D:/DPF/.claude/worktrees/X")).toBe("d:/DPF/.claude/worktrees/X");
  });

  it("leaves MSYS bash form unchanged", () => {
    expect(normalizeRepoPath("/d/DPF/.claude/worktrees/X")).toBe("/d/DPF/.claude/worktrees/X");
  });

  it("leaves POSIX form unchanged", () => {
    expect(normalizeRepoPath("/home/dev/dpf")).toBe("/home/dev/dpf");
  });

  it("strips trailing slashes", () => {
    expect(normalizeRepoPath("C:\\Users\\Test\\dpf\\")).toBe("c:/Users/Test/dpf");
    expect(normalizeRepoPath("D:/DPF/")).toBe("d:/DPF");
  });

  it("preserves a single root slash", () => {
    expect(normalizeRepoPath("/")).toBe("/");
  });

  it("collapses repeated slashes", () => {
    expect(normalizeRepoPath("D://DPF////X")).toBe("d:/DPF/X");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeRepoPath("")).toBe("");
  });

  it("does not lowercase non-drive-letter colons", () => {
    expect(normalizeRepoPath("/some:path/X")).toBe("/some:path/X");
  });

  it("matches the operator's actual mixed-format scenario from Phase 5", () => {
    // Phase 5 functional finding: installed_plugins.json had backslash form,
    // bridge passed forward-slash form, strict equality failed → re-plan loop.
    const fromInstalledPlugins = "D:\\DPF\\.claude\\worktrees\\agent-toolchain-phase-5";
    const fromBridge = "D:/DPF/.claude/worktrees/agent-toolchain-phase-5";
    expect(normalizeRepoPath(fromInstalledPlugins)).toBe(normalizeRepoPath(fromBridge));
  });
});

describe("repoPathsMatch", () => {
  it("returns true for forms that normalize to the same string", () => {
    expect(repoPathsMatch("D:\\DPF\\X", "D:/DPF/X")).toBe(true);
    expect(repoPathsMatch("D:/DPF/X/", "D:\\DPF\\X")).toBe(true);
  });

  it("returns false for genuinely distinct paths", () => {
    expect(repoPathsMatch("D:/DPF/X", "D:/DPF/Y")).toBe(false);
    expect(repoPathsMatch("D:/DPF/X", "C:/DPF/X")).toBe(false);
  });

  it("treats MSYS form as distinct from Windows-native form (intentional)", () => {
    // See path-normalize.ts § "Note on MSYS form" — they are distinct shell
    // conventions and the planner should not silently coalesce them. The
    // stale-entry reconcile flow handles cleanup when both forms exist.
    expect(repoPathsMatch("/d/DPF/X", "D:/DPF/X")).toBe(false);
  });

  it("is symmetric", () => {
    const a = "D:\\DPF\\X";
    const b = "d:/DPF/X";
    expect(repoPathsMatch(a, b)).toBe(repoPathsMatch(b, a));
  });
});
