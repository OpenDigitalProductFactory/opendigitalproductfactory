import { describe, expect, it, vi } from "vitest";

import {
  observeGithubPullRequest,
  projectGithubPrReadiness,
  rerunFailedWorkflowJobs,
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

  it("keeps an armed PR armed and names its green exact-head conversation hold", () => {
    const url = "https://github.com/o/r/pull/42#discussion_r1";
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true, mergeStateStatus: "BLOCKED", unresolvedReviewThreads: 1,
      unresolvedReviewThreadUrls: [url],
    }))).toEqual({
      kind: "armed", headSha: "abc123",
      conversationHold: { reason: "review-threads-unresolved", count: 1, urls: [url] },
    });
  });

  it.each([
    { reviewThreadsComplete: false },
    { checksComplete: false },
    { unresolvedReviewThreads: 0 },
    { checks: [] },
    { checks: [{ name: "required", status: "IN_PROGRESS", conclusion: null }] },
    { checks: [{ name: "required", status: "COMPLETED", conclusion: "FAILURE" }] },
    { mergeStateStatus: "DIRTY" },
    { mergeStateStatus: "BEHIND" },
    { changesRequested: true },
    { mergeQueueEntry: true },
    { merged: true },
    { state: "CLOSED" },
  ] satisfies Partial<GithubPrObservation>[])("does not guess a conversation hold on %o", (other) => {
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true, mergeStateStatus: "BLOCKED", unresolvedReviewThreads: 2, ...other,
    }))).not.toHaveProperty("conversationHold");
  });

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

  it("distinguishes armed intent from provider-confirmed queue enrollment", () => {
    expect(projectGithubPrReadiness(observed({ autoMergeEnabled: true }))).toEqual({
      kind: "armed",
      headSha: "abc123",
    });
    expect(projectGithubPrReadiness(observed({ mergeQueueEntry: true }))).toEqual({
      kind: "queued",
      headSha: "abc123",
    });
  });

  it("keeps an armed PR armed while flagging terminal failing required checks (BI-BE9A160D)", () => {
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true,
      mergeStateStatus: "BLOCKED",
      checks: [
        { name: "Merge Readiness", status: "COMPLETED", conclusion: "FAILURE", required: true },
        { name: "DCO", status: "COMPLETED", conclusion: "SUCCESS", required: true },
      ],
    }))).toEqual({
      kind: "armed",
      headSha: "abc123",
      checksFailing: true,
    });
    // Still pending, incomplete check page, or non-required failure only: stay plain armed.
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true,
      checks: [
        { name: "Merge Readiness", status: "COMPLETED", conclusion: "FAILURE", required: true },
        { name: "UX Route Budget Sweep", status: "IN_PROGRESS", conclusion: null, required: true },
      ],
    }))).toEqual({ kind: "armed", headSha: "abc123" });
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true,
      checksComplete: false,
      checks: [{ name: "Merge Readiness", status: "COMPLETED", conclusion: "FAILURE", required: true }],
    }))).toEqual({ kind: "armed", headSha: "abc123" });
    expect(projectGithubPrReadiness(observed({
      autoMergeEnabled: true,
      checks: [
        { name: "Merge Readiness", status: "COMPLETED", conclusion: "SUCCESS", required: true },
        { name: "Failure Readiness", status: "COMPLETED", conclusion: "FAILURE", required: false },
      ],
    }))).toEqual({ kind: "armed", headSha: "abc123" });
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

describe("observeGithubPullRequest check detail (BI-88341B5D)", () => {
  it("counts provider-unresolved conversations even if outdated, and keeps same-PR links", async () => {
    const prUrl = "https://github.com/o/r/pull/42";
    const url = prUrl + "#discussion_r42";
    const pr = {
      id: "PR_node", number: 42, url: prUrl, state: "OPEN", headRefOid: "author-head",
      mergeStateStatus: "BLOCKED", autoMergeRequest: { enabledAt: "2026-11-26T08:00:00Z" },
      reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [
        { isResolved: false, isOutdated: true, comments: { nodes: [{ url }] } },
        { isResolved: false, comments: { nodes: [] } },
        { isResolved: true, comments: { nodes: [{ url: prUrl + "#discussion_r43" }] } },
      ] },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: {
        pageInfo: { hasNextPage: false },
        nodes: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true }],
      } } } }] },
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { repository: { pullRequest: pr } } }),
    });
    const read = () => observeGithubPullRequest({ owner: "o", repo: "r", prNumber: 42, token: "t", fetchImpl: fetchImpl as never });
    const observed = await read();
    expect(observed.reviewThreadsComplete).toBe(true);
    expect(projectGithubPrReadiness(observed)).toMatchObject({
      kind: "armed", conversationHold: { count: 2, urls: [url] },
    });
    pr.reviewThreads.pageInfo.hasNextPage = true;
    expect(projectGithubPrReadiness(await read())).not.toHaveProperty("conversationHold");
    // A missing page is not proof for the new hold, but preserves the old readiness adapter.
    delete (pr.reviewThreads as { pageInfo?: { hasNextPage: boolean } }).pageInfo;
    const missing = await read();
    expect(missing.reviewThreadsComplete).toBe(true);
    expect(missing.reviewConversationPageComplete).toBe(false);
    expect(projectGithubPrReadiness(missing)).not.toHaveProperty("conversationHold");
  });

  it("keeps a removed group's failed check separate from green author-head checks", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { repository: { pullRequest: {
        id: "PR_node", number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN",
        headRefOid: "author-head", mergeStateStatus: "CLEAN",
        timelineItems: { nodes: [{
          __typename: "RemovedFromMergeQueueEvent", id: "removed-1", createdAt: "2026-11-25T22:54:08Z", reason: "failed_checks",
          beforeCommit: { oid: "group-head", statusCheckRollup: { contexts: { nodes: [
            { name: "UX Route Budget Sweep", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/actions/runs/9" },
            { name: "DCO", status: "COMPLETED", conclusion: "SUCCESS" },
          ] } } },
        }] },
        commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
          { name: "UX Route Budget Sweep", status: "COMPLETED", conclusion: "SUCCESS" },
        ] } } } }] },
      } } } }),
    });
    const observation = await observeGithubPullRequest({ owner: "o", repo: "r", prNumber: 42, token: "t", fetchImpl: fetchImpl as never });
    expect(observation.checks).toEqual([expect.objectContaining({ conclusion: "SUCCESS" })]);
    expect(projectGithubPrReadiness(observation)).toEqual({
      kind: "queue-hold", headSha: "author-head",
      event: { kind: "removed", id: "removed-1", at: "2026-11-25T22:54:08Z", reason: "failed_checks",
        groupHeadSha: "group-head", failingChecks: [
          { name: "UX Route Budget Sweep", conclusion: "FAILURE", url: "https://github.com/o/r/actions/runs/9" },
        ] },
    });
  });

  it("carries each failing run's page and workflow run id so the room can name and re-run it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          repository: {
            pullRequest: {
              id: "PR_node", number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", merged: false,
              headRefOid: "abc123", mergeStateStatus: "BLOCKED", autoMergeRequest: null, mergeQueueEntry: null,
              reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
              commits: { nodes: [{ commit: { statusCheckRollup: { contexts: {
                nodes: [
                  { name: "typecheck", status: "COMPLETED", conclusion: "FAILURE",
                    detailsUrl: "https://github.com/o/r/actions/runs/9/job/1", checkSuite: { workflowRun: { databaseId: 9 } } },
                  { context: "legacy", state: "ERROR", targetUrl: "https://ci.example/1" },
                ],
                pageInfo: { hasNextPage: false },
              } } } }] },
            },
          },
        },
      }),
    });
    const observation = await observeGithubPullRequest({ owner: "o", repo: "r", prNumber: 42, token: "t", fetchImpl: fetchImpl as never });
    expect(observation.checks).toEqual([
      { name: "typecheck", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/actions/runs/9/job/1", workflowRunId: 9 },
      { name: "legacy", status: "COMPLETED", conclusion: "ERROR", detailsUrl: "https://ci.example/1", workflowRunId: null },
    ]);
  });
});

describe("required checks decide readiness (BI-D081EDD0)", () => {
  const ok = { name: "Unit Tests", status: "COMPLETED", conclusion: "SUCCESS", required: true };

  it("projects ready when only non-required checks fail, as GitHub's merge queue does", () => {
    expect(projectGithubPrReadiness(observed({
      mergeStateStatus: "UNSTABLE",
      checks: [ok, { name: "Analyze (go)", status: "COMPLETED", conclusion: "FAILURE", required: false }],
    }))).toEqual({ kind: "ready", headSha: "abc123" });
  });

  it("does not wait on a non-required check that is still running", () => {
    expect(projectGithubPrReadiness(observed({
      checks: [ok, { name: "Analyze (javascript-typescript)", status: "IN_PROGRESS", conclusion: null, required: false }],
    }))).toEqual({ kind: "ready", headSha: "abc123" });
  });

  it("still blocks on a failing required check, and on a failing check whose required-ness is unknown", () => {
    expect(projectGithubPrReadiness(observed({
      checks: [{ ...ok, conclusion: "FAILURE" }],
    }))).toMatchObject({ kind: "checking", reason: "checks-failing" });
    expect(projectGithubPrReadiness(observed({
      checks: [ok, { name: "legacy", status: "COMPLETED", conclusion: "FAILURE" }],
    }))).toMatchObject({ kind: "checking", reason: "checks-failing" });
  });

  it("reads isRequired from GitHub for check runs and commit statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { repository: { pullRequest: {
          id: "PR_node", number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", merged: false,
          headRefOid: "abc123", mergeStateStatus: "UNSTABLE", autoMergeRequest: null, mergeQueueEntry: null,
          reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: {
            nodes: [
              { name: "Analyze (go)", status: "COMPLETED", conclusion: "FAILURE", isRequired: false,
                detailsUrl: null, checkSuite: { workflowRun: { databaseId: 7 } } },
              { context: "dpf/failure-readiness", state: "SUCCESS", targetUrl: null, isRequired: true },
            ],
            pageInfo: { hasNextPage: false },
          } } } }] },
        } } },
      }),
    });
    const observation = await observeGithubPullRequest({ owner: "o", repo: "r", prNumber: 42, token: "t", fetchImpl: fetchImpl as never });
    expect(observation.checks.map((c) => [c.name, c.required])).toEqual([["Analyze (go)", false], ["dpf/failure-readiness", true]]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as { query: string };
    expect(body.query).toContain("isRequired(pullRequestNumber:$number)");
  });
});

describe("rerunFailedWorkflowJobs", () => {
  it("re-runs only the failed jobs and reports a run GitHub will not re-run", async () => {
    const accepted = vi.fn().mockResolvedValue({ status: 201 });
    await expect(rerunFailedWorkflowJobs({ owner: "o", repo: "r", workflowRunId: 9, token: "t", fetchImpl: accepted as never }))
      .resolves.toBe("accepted");
    expect(accepted).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/actions/runs/9/rerun-failed-jobs",
      expect.objectContaining({ method: "POST" }),
    );
    const refused = vi.fn().mockResolvedValue({ status: 403 });
    await expect(rerunFailedWorkflowJobs({ owner: "o", repo: "r", workflowRunId: 9, token: "t", fetchImpl: refused as never }))
      .resolves.toBe("not-rerunnable");
    const broken = vi.fn().mockResolvedValue({ status: 500 });
    await expect(rerunFailedWorkflowJobs({ owner: "o", repo: "r", workflowRunId: 9, token: "t", fetchImpl: broken as never }))
      .rejects.toThrow("HTTP 500");
  });
});
