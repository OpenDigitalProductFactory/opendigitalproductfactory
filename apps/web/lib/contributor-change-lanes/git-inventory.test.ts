import { describe, expect, it } from "vitest";

import {
  mergeFilesystemAndRegisteredWorktrees,
  parseGitBranchList,
  parseGitWorktreeList,
} from "./git-inventory";

const PORCELAIN_SAMPLE = `worktree D:/DPF
HEAD 5dbe23b0aaaa
branch refs/heads/main

worktree D:/DPF/.claude/worktrees/ccl-phase-1
HEAD 1234567890abcdef
branch refs/heads/feat/contributor-change-lanes-phase-1

worktree D:/DPF/.claude/worktrees/detached
HEAD deadbeef
detached

worktree D:/DPF/.claude/worktrees/bare
bare
`;

const FOR_EACH_REF_SAMPLE = [
  "refs/remotes/origin/main\t5dbe23b0\t2026-05-26T20:00:00Z\tmerged",
  "refs/remotes/origin/feat/ccl\t1234abcd\t2026-05-26T21:00:00Z\t",
  "refs/remotes/origin/HEAD\t\t\t",
  "refs/remotes/origin/feat/orphan\tabcd1234\t2026-04-01T00:00:00Z\t",
].join("\n");

describe("parseGitWorktreeList", () => {
  it("parses each non-bare block into a worktree snapshot, normalizing paths to forward slashes", () => {
    const result = parseGitWorktreeList(PORCELAIN_SAMPLE);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      path: "D:/DPF",
      branch: "main",
      headSha: "5dbe23b0aaaa",
      isRegistered: true,
    });
    expect(result[1]!.branch).toBe("feat/contributor-change-lanes-phase-1");
    expect(result[2]!.branch).toBeNull();
  });

  it("returns an empty array for empty input", () => {
    expect(parseGitWorktreeList("")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const crlf = PORCELAIN_SAMPLE.replace(/\n/g, "\r\n");
    const result = parseGitWorktreeList(crlf);
    expect(result).toHaveLength(3);
  });
});

describe("parseGitBranchList", () => {
  it("strips the refs/remotes/origin/ prefix and parses the lastCommit date + merged flag", () => {
    const result = parseGitBranchList(FOR_EACH_REF_SAMPLE);
    const main = result.find((b) => b.name === "main");
    const ccl = result.find((b) => b.name === "feat/ccl");
    const orphan = result.find((b) => b.name === "feat/orphan");

    expect(main).toBeDefined();
    expect(main!.isMerged).toBe(true);
    expect(main!.headSha).toBe("5dbe23b0");
    expect(main!.lastCommitAt).toEqual(new Date("2026-05-26T20:00:00Z"));

    expect(ccl).toBeDefined();
    expect(ccl!.isMerged).toBe(false);

    expect(orphan).toBeDefined();
    expect(orphan!.lastCommitAt).toEqual(new Date("2026-04-01T00:00:00Z"));
  });

  it("skips the HEAD symbolic ref", () => {
    const result = parseGitBranchList(FOR_EACH_REF_SAMPLE);
    expect(result.find((b) => b.name === "HEAD")).toBeUndefined();
  });

  it("returns an empty array on empty input", () => {
    expect(parseGitBranchList("")).toEqual([]);
  });
});

describe("mergeFilesystemAndRegisteredWorktrees", () => {
  it("adds filesystem paths that are not registered git worktrees", () => {
    const registered = parseGitWorktreeList(PORCELAIN_SAMPLE);
    const merged = mergeFilesystemAndRegisteredWorktrees(registered, [
      "D:/DPF/.claude/worktrees/orphan-dir",
      "D:\\DPF\\.claude\\worktrees\\ccl-phase-1",
    ]);
    expect(merged.length).toBe(registered.length + 1);
    const additions = merged.filter((wt) => !wt.isRegistered);
    expect(additions).toHaveLength(1);
    expect(additions[0]!.path).toBe("D:/DPF/.claude/worktrees/orphan-dir");
  });
});
