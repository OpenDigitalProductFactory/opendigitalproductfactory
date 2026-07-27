import { describe, expect, it, vi } from "vitest";

import {
  projectGithubPrReadiness,
  updatePullRequestBranch,
  type GithubPrObservation,
} from "./github-pr-readiness";

function observed(overrides: Partial<GithubPrObservation> = {}): GithubPrObservation {
  return {
    nodeId: "PR_node",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    state: "OPEN",
    merged: false,
    headSha: "abc123",
    mergeStateStatus: "CLEAN",
    unresolvedReviewThreads: 0,
    reviewThreadsComplete: true,
    checksComplete: true,
    checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }],
    autoMergeEnabled: false,
    mergeQueueEntry: false,
    ...overrides,
  };
}

describe("projectGithubPrReadiness", () => {
  it("requires an open, current PR with terminal passing checks and no unresolved threads", () => {
    expect(projectGithubPrReadiness(observed())).toEqual({
      kind: "ready",
      headSha: "abc123",
    });
  });

  it.each([
    [{ checks: [{ name: "test", status: "IN_PROGRESS", conclusion: null }] }, "checks-pending"],
    [{ checks: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }] }, "checks-failing"],
    [{ unresolvedReviewThreads: 1 }, "review-threads-unresolved"],
    [{ checksComplete: false }, "checks-incomplete"],
    [{ reviewThreadsComplete: false }, "review-threads-incomplete"],
  ] satisfies Array<[Partial<GithubPrObservation>, string]>)(
    "parks incomplete evidence (%s)",
    (overrides, reason) => {
      expect(projectGithubPrReadiness(observed(overrides))).toEqual({
        kind: "checking",
        headSha: "abc123",
        reason,
      });
    },
  );

  it("classifies stale heads for safe update", () => {
    expect(projectGithubPrReadiness(observed({ mergeStateStatus: "BEHIND" }))).toEqual({
      kind: "behind",
      headSha: "abc123",
    });
  });

  it("classifies true conflicts for escalation", () => {
    expect(projectGithubPrReadiness(observed({ mergeStateStatus: "DIRTY" }))).toEqual({
      kind: "conflict",
      headSha: "abc123",
    });
  });

  it("honors merged and closed-unmerged PRs", () => {
    expect(projectGithubPrReadiness(observed({ state: "MERGED", merged: true }))).toEqual({
      kind: "merged",
      headSha: "abc123",
    });
    expect(projectGithubPrReadiness(observed({ state: "CLOSED" }))).toEqual({
      kind: "closed",
      headSha: "abc123",
    });
  });

  it("recognizes queue enrollment without actuating it again", () => {
    expect(projectGithubPrReadiness(observed({ autoMergeEnabled: true }))).toEqual({
      kind: "queued",
      headSha: "abc123",
    });
    expect(projectGithubPrReadiness(observed({ mergeQueueEntry: true }))).toEqual({
      kind: "queued",
      headSha: "abc123",
    });
  });

  it("fails closed on missing identity or an unstable merge state", () => {
    expect(projectGithubPrReadiness(observed({ headSha: "" }))).toEqual({
      kind: "unknown",
      headSha: null,
      reason: "missing-head-sha",
    });
    expect(projectGithubPrReadiness(observed({ mergeStateStatus: "UNKNOWN" }))).toEqual({
      kind: "unknown",
      headSha: "abc123",
      reason: "merge-state-unknown",
    });
  });
});

describe("updatePullRequestBranch", () => {
  it("sends the expected head SHA and recognizes compare-and-swap loss", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 422 });
    await expect(updatePullRequestBranch({
      owner: "o",
      repo: "r",
      prNumber: 42,
      expectedHeadSha: "abc123",
      token: "secret",
      fetchImpl: fetchImpl as never,
    })).resolves.toBe("head-changed");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/pulls/42/update-branch",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ expected_head_sha: "abc123" }),
      }),
    );
  });

  it("accepts only GitHub's asynchronous update response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202 });
    await expect(updatePullRequestBranch({
      owner: "o",
      repo: "r",
      prNumber: 42,
      expectedHeadSha: "abc123",
      token: "secret",
      fetchImpl: fetchImpl as never,
    })).resolves.toBe("accepted");
  });
});
