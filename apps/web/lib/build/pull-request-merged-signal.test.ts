import { describe, expect, it } from "vitest";

import {
  describePullRequestMergedSkip,
  readPullRequestMergedSignal,
} from "./pull-request-merged-signal";

const SHA = "a".repeat(40);
const MERGE_SHA = "b".repeat(40);

const mergedPayload = (overrides: Record<string, unknown> = {}) => ({
  action: "closed",
  repository: { full_name: "OpenDigitalProductFactory/opendigitalproductfactory" },
  pull_request: {
    number: 5228,
    merged: true,
    merged_at: "2026-09-09T01:50:00Z",
    merge_commit_sha: MERGE_SHA,
    title: "fix(guards): the room-addressing guard fails shut",
    head: { ref: "fix/room-addressing-guard-fails-shut", sha: SHA },
    base: { ref: "main" },
    ...overrides,
  },
});

describe("readPullRequestMergedSignal", () => {
  it("reads the identity a merge contributes to the delivery record", () => {
    const verdict = readPullRequestMergedSignal("pull_request", mergedPayload());
    expect(verdict.merged).toBe(true);
    if (!verdict.merged) return;
    expect(verdict.signal).toEqual({
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      number: 5228,
      headRefName: "fix/room-addressing-guard-fails-shut",
      headSha: SHA,
      mergeCommitSha: MERGE_SHA,
      mergedAt: "2026-09-09T01:50:00Z",
      baseRefName: "main",
      title: "fix(guards): the room-addressing guard fails shut",
    });
  });

  // The error that would matter most: a closed-unmerged PR carries the SAME
  // action. Treating it as a merge would record delivery evidence for
  // abandoned work and reap the worktree holding the only copy of the branch.
  it("does not mistake a closed-unmerged pull request for a merge", () => {
    const verdict = readPullRequestMergedSignal(
      "pull_request",
      mergedPayload({ merged: false, merged_at: null, merge_commit_sha: null }),
    );
    expect(verdict).toEqual({ merged: false, reason: "closed-unmerged" });
    expect(describePullRequestMergedSkip("closed-unmerged")).toMatch(/without merging/);
  });

  it("ignores the pull_request actions that are not a close", () => {
    for (const action of ["opened", "synchronize", "reopened", "edited", "labeled"]) {
      const verdict = readPullRequestMergedSignal("pull_request", { ...mergedPayload(), action });
      expect(verdict).toEqual({ merged: false, reason: "not-a-close-action" });
    }
  });

  it("ignores events that are not pull_request at all, including push", () => {
    for (const event of ["push", "issues", "workflow_run", "ping"]) {
      expect(readPullRequestMergedSignal(event, mergedPayload())).toEqual({
        merged: false,
        reason: "not-a-pull-request-event",
      });
    }
  });

  // A rebase merge has no merge commit. That is legitimate and must not read
  // as malformed, because downstream keys on headRefName + number.
  it("accepts a rebase merge, which has no merge commit sha", () => {
    const verdict = readPullRequestMergedSignal(
      "pull_request",
      mergedPayload({ merge_commit_sha: null }),
    );
    expect(verdict.merged).toBe(true);
    if (!verdict.merged) return;
    expect(verdict.signal.mergeCommitSha).toBeNull();
    expect(verdict.signal.headRefName).toBe("fix/room-addressing-guard-fails-shut");
  });

  it("refuses to guess when the identity downstream keys on is missing", () => {
    const cases: Array<Record<string, unknown>> = [
      { head: { ref: "", sha: SHA } },
      { head: { ref: "branch", sha: "not-a-sha" } },
      { number: "5228" },
    ];
    for (const override of cases) {
      expect(readPullRequestMergedSignal("pull_request", mergedPayload(override))).toEqual({
        merged: false,
        reason: "incomplete-identity",
      });
    }
    const noRepo = mergedPayload();
    delete (noRepo as Record<string, unknown>).repository;
    expect(readPullRequestMergedSignal("pull_request", noRepo)).toEqual({
      merged: false,
      reason: "incomplete-identity",
    });
  });

  it("does not throw on a malformed or empty payload", () => {
    for (const payload of [null, undefined, {}, { action: "closed" }, "nonsense"]) {
      expect(() => readPullRequestMergedSignal("pull_request", payload)).not.toThrow();
    }
  });
});
