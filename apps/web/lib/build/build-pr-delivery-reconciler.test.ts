import { describe, expect, it, vi } from "vitest";

import { decideBuildPrDeliveryAction, executeBuildPrDeliveryAction } from "./build-pr-delivery-reconciler";
import { projectGithubPrReadiness, type GithubPrObservation } from "./github-pr-readiness";
import { createBuildPrDeliveryState } from "./build-pr-delivery-state";

const state = createBuildPrDeliveryState({
  repository: "o/r",
  prNumber: 42,
  prUrl: "https://github.com/o/r/pull/42",
});

describe("decideBuildPrDeliveryAction", () => {
  it("queues an evidence-cleared exact head once", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "ready", headSha: "abc" },
    })).toEqual({ kind: "queue", headSha: "abc" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, lastActuatedHeadSha: "abc", status: "queued" },
      readiness: { kind: "ready", headSha: "abc" },
    })).toEqual({ kind: "wait", status: "queued", headSha: "abc", reason: "already-actuated" });
  });

  it("updates a stale head within budget and escalates when exhausted", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "behind", headSha: "abc" },
    })).toEqual({ kind: "update-branch", headSha: "abc" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, staleUpdateAttempts: 2 },
      readiness: { kind: "behind", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "stale-update-budget-exhausted" });
  });

  it("never auto-edits conflicts and honors closure", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "conflict", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "true-merge-conflict" });
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "closed", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "closed", headSha: "abc", reason: "pull-request-closed-unmerged" });
  });

  it("keeps merge distinct from governed deployment", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "merged", headSha: "abc" },
    })).toEqual({ kind: "wait", status: "awaiting-release", headSha: "abc", reason: "merged-awaiting-governed-release" });
  });

  it("parks checks and bounds unknown observations", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "checking", headSha: "abc", reason: "checks-pending" },
    })).toEqual({ kind: "wait", status: "checking", headSha: "abc", reason: "checks-pending" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, reconciliationAttempts: 6 },
      readiness: { kind: "unknown", headSha: "abc", reason: "merge-state-unknown" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "observation-budget-exhausted:merge-state-unknown" });
  });
});

function observation(overrides: Partial<GithubPrObservation> = {}): GithubPrObservation {
  return {
    nodeId: "PR_node",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    state: "OPEN",
    merged: false,
    headSha: "sha1",
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

/** A GitHub fake that records every call and answers each endpoint as GitHub does. */
function githubFake() {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body ?? null });
    if (url.endsWith("/graphql")) return { ok: true, status: 200, json: async () => ({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 42 } } } }) };
    if (url.endsWith("/rerun-failed-jobs")) return { status: 201 };
    if (url.endsWith("/update-branch")) return { status: 202 };
    return { status: 404 };
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function run(input: {
  observed: GithubPrObservation;
  mode?: "off" | "shadow" | "enforce";
  actuationAllowed?: boolean;
  repairAuthority?: "dispatch" | "propose" | "record";
  dispatchRepair?: Parameters<typeof executeBuildPrDeliveryAction>[0]["dispatchRepair"];
  from?: typeof state;
}) {
  const github = githubFake();
  const outcome = await executeBuildPrDeliveryAction({
    state: input.from ?? state,
    observation: input.observed,
    readiness: projectGithubPrReadiness(input.observed),
    mode: input.mode ?? "enforce",
    token: "t",
    owner: "o",
    repo: "r",
    fetchImpl: github.fetchImpl,
    actuationAllowed: input.actuationAllowed,
    repairAuthority: input.repairAuthority,
    dispatchRepair: input.dispatchRepair,
  });
  return { ...outcome, calls: github.calls };
}

const redDefect = observation({
  mergeStateStatus: "BLOCKED",
  checks: [{ name: "typecheck", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/run/9", workflowRunId: 9 }],
});
const redInfra = observation({
  mergeStateStatus: "BLOCKED",
  checks: [{ name: "build", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "https://x/run/5", workflowRunId: 5 }],
});

describe("executeBuildPrDeliveryAction — PR follow-through (BI-88341B5D)", () => {
  it("arms auto-merge through the merge queue when checks are green, and never merges by hand", async () => {
    const outcome = await run({ observed: observation() });
    expect(outcome.actuated).toBe(true);
    expect(outcome.state.status).toBe("queued");
    expect(outcome.calls).toHaveLength(1);
    expect(outcome.calls[0]?.body).toContain("enablePullRequestAutoMerge");
    expect(outcome.calls.some((call) => /mergePullRequest|\/merge"?$/.test(`${call.url} ${call.body ?? ""}`))).toBe(false);
  });

  it("withholds GitHub actuation when the room's boundary does, but still records the state", async () => {
    const outcome = await run({ observed: observation(), actuationAllowed: false });
    expect(outcome.actuated).toBe(false);
    expect(outcome.calls).toHaveLength(0);
    expect(outcome.state.lastError).toBe("withheld:queue");
  });

  it("re-runs only the failed jobs of an infrastructure failure, once", async () => {
    const first = await run({ observed: redInfra });
    expect(first.followThrough.kind).toBe("rerun-infrastructure");
    expect(first.calls.map((call) => call.url)).toEqual(["https://api.github.com/repos/o/r/actions/runs/5/rerun-failed-jobs"]);
    expect(first.actuated).toBe(true);

    const second = await run({ observed: redInfra, from: first.state });
    expect(second.calls).toHaveLength(0);
    expect(second.followThrough).toEqual(expect.objectContaining({ kind: "attention", target: "platform-operator", reason: "infrastructure-persists" }));
  });

  it("does not count a re-run it did not perform in shadow mode", async () => {
    const outcome = await run({ observed: redInfra, mode: "shadow" });
    expect(outcome.calls).toHaveLength(0);
    expect(outcome.state.followThrough.infraReruns).toBe(null);
    expect(outcome.state.lastError).toBe("withheld:rerun-infrastructure");
  });

  it("dispatches a repair at full proactivity through the injected worker and holds the room as repairing", async () => {
    const dispatchRepair = vi.fn().mockResolvedValue("dispatched");
    const outcome = await run({ observed: redDefect, repairAuthority: "dispatch", dispatchRepair });
    expect(dispatchRepair).toHaveBeenCalledWith(expect.objectContaining({ headSha: "sha1", attempt: 1, bound: 2 }));
    expect(outcome.followThrough).toEqual(expect.objectContaining({ kind: "repair", mode: "dispatch" }));
    expect(outcome.state.followThrough.hold).toBe("repairing");
    expect(outcome.state.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(1);
    expect(outcome.calls).toHaveLength(0);
  });

  it("stages the packet for a person, spending no budget, when no repair worker is available", async () => {
    const outcome = await run({ observed: redDefect, repairAuthority: "dispatch" });
    expect(outcome.followThrough).toEqual(expect.objectContaining({ kind: "repair", mode: "propose" }));
    expect(outcome.state.followThrough.hold).toBe("awaiting-person");
    expect(outcome.state.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();
    expect(outcome.state.lastError).toBe("repair-worker-unavailable");
    expect(outcome.state.followThrough.attentionKey).toBe("follow-through:repair-propose:sha1");
  });

  it("decides the same way whichever client opened the PR: the inputs carry no client identity", async () => {
    // The follow-through record and decision take only the PR observation and
    // the room's boundary. Two rooms with the same PR facts and boundary get the
    // same decision, so a Codex room and a Claude room behave identically.
    const a = await run({ observed: redDefect, repairAuthority: "propose" });
    const b = await run({ observed: redDefect, repairAuthority: "propose" });
    expect(a.followThrough).toEqual(b.followThrough);
    expect(a.state.followThrough).toEqual(b.state.followThrough);
  });
});
