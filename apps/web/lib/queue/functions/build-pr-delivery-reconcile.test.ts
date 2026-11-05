import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  activityCreate: vi.fn(),
  observe: vi.fn(),
  createIssue: vi.fn(),
  postureDefault: vi.fn(),
  fetch: vi.fn(),
  verdict: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    workroom: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    workroomActivity: { create: mocks.activityCreate },
    featureBuild: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/contributor-change-lanes/github-rest-reader", () => ({
  resolveGithubToken: vi.fn().mockResolvedValue("token"),
}));
vi.mock("@/lib/build/github-pr-readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/build/github-pr-readiness")>();
  return { ...actual, observeGithubPullRequest: mocks.observe };
});
vi.mock("@/lib/work-management/workroom-posture-defaults", () => ({
  getWorkroomPostureDefault: mocks.postureDefault,
}));
vi.mock("@/lib/quality/platform-issue-reports", () => ({
  createPlatformIssueReport: mocks.createIssue,
}));
vi.mock("@/lib/build/build-studio-config", () => ({
  getAutonomousPlaybookMode: () => "off",
}));
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: () => ({}) } }));
vi.mock("@/lib/jobs/triggers", () => ({ cron: () => ({}) }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: vi.fn() }));
vi.mock("@/lib/change-review/failure-readiness-publication", () => ({ checkWorkroomFailureReadiness: mocks.verdict }));
vi.mock("@/lib/change-review/failure-readiness-status", () => ({ publishFailureReadinessStatus: mocks.publish }));

import { observesRoomHead, runBuildPrDeliveryReconcile } from "./build-pr-delivery-reconcile";
import { createBuildPrDeliveryState, writeBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";

function room(overrides: Record<string, unknown>) {
  return {
    id: "row",
    capsuleId: "WC-X",
    featureBuildId: null,
    repositoryFullName: "o/r",
    pullRequestNumber: 9,
    pullRequestUrl: "https://github.com/o/r/pull/9",
    headSha: "sha1",
    scopeClaims: [],
    workspaceState: {},
    updatedAt: new Date("2026-10-06T00:00:00Z"),
    ...overrides,
  };
}

function observation(checks: Array<Record<string, unknown>>, mergeStateStatus = "BLOCKED") {
  return {
    nodeId: "PR_node", number: 9, url: "https://github.com/o/r/pull/9", state: "OPEN", merged: false,
    headSha: "sha1", mergeStateStatus, unresolvedReviewThreads: 0, reviewThreadsComplete: true,
    checksComplete: true, checks, autoMergeEnabled: false, mergeQueueEntry: false,
  };
}

describe("runBuildPrDeliveryReconcile — every room with a PR, whichever client opened it (BI-88341B5D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE = "enforce";
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.activityCreate.mockResolvedValue({});
    mocks.createIssue.mockResolvedValue({ reportId: "PIR-1" });
    mocks.postureDefault.mockResolvedValue(null);
    mocks.verdict.mockResolvedValue({ mayPublish: true, reason: "reviewed" });
    mocks.publish.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    delete process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE;
    vi.unstubAllGlobals();
  });

  it("selects rooms without a Build Studio build and skips rooms the reconciler stopped on", async () => {
    mocks.findMany.mockResolvedValue([
      room({ id: "stopped", capsuleId: "WC-STOP", workspaceState: { prDelivery: {
        schemaVersion: 1, status: "escalated", repository: "o/r", prNumber: 8, prUrl: "https://github.com/o/r/pull/8",
      } } }),
      room({ id: "codex", capsuleId: "WC-CODEX" }),
    ]);
    mocks.observe.mockResolvedValue(observation([
      { name: "typecheck", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/9", workflowRunId: 9 },
    ]));

    const result = await runBuildPrDeliveryReconcile();

    const where = mocks.findMany.mock.calls[0]?.[0]?.where;
    expect(where).not.toHaveProperty("featureBuildId");
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(result.observed).toBe(1);

    const write = mocks.updateMany.mock.calls[0]?.[0];
    expect(write.where).toEqual({ id: "codex", updatedAt: expect.any(Date) });
    expect(write.data.workspaceState.prDelivery.followThrough).toEqual(expect.objectContaining({
      hold: "awaiting-person",
      judgedHeadSha: "sha1",
    }));
    // A red defect with no repair worker wired is staged for a person, on the room and in the inbox.
    expect(mocks.activityCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "codex",
      kind: "workroom-pr-follow-through",
    }) });
    expect(mocks.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      type: "build-stall-escalation",
      source: "workroom-pr-follow-through",
      dedupeKey: "WC-CODEX:follow-through:repair-propose:sha1",
    }));
    // Nothing was merged, pushed or re-run.
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not let a stale PR observation overwrite or actuate a newly adopted head", async () => {
    const currentHead = "b".repeat(40);
    const staleHead = "a".repeat(40);
    mocks.findMany.mockResolvedValue([room({ id: "re-adopted", headSha: currentHead })]);
    mocks.observe.mockResolvedValue({ ...observation([], "CLEAN"), headSha: staleHead });

    const result = await runBuildPrDeliveryReconcile();

    expect(mocks.findMany.mock.calls[0]?.[0]?.select).toMatchObject({ headSha: true });
    expect(result).toMatchObject({ observed: 1, actuated: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  // BI-ECA50241: the reconciler's own update-branch moves the PR head to
  // GitHub's merge commit; the room follows it instead of freezing in updating.
  it("follows a PR head moved by its own update-branch and records the new head", async () => {
    const roomHead = "a".repeat(40);
    const mergedHead = "c".repeat(40);
    const updating = { ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9" }), status: "updating" as const, lastObservedHeadSha: roomHead };
    mocks.findMany.mockResolvedValue([room({ id: "updated", headSha: roomHead, workspaceState: writeBuildPrDeliveryState({}, updating) })]);
    mocks.observe.mockResolvedValue({ ...observation([], "BLOCKED"), headSha: mergedHead });

    const result = await runBuildPrDeliveryReconcile();

    expect(result).toMatchObject({ observed: 1 });
    expect(mocks.updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ headSha: mergedHead });
  });

  it("arms auto-merge for a green PR in a non-Build-Studio room, and withholds it in a quiet room", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 9 } } } }) });
    mocks.findMany.mockResolvedValue([
      room({ id: "green" }),
      room({ id: "quiet", scopeClaims: [{ workroomPosture: { proactivityLevel: "quiet" }, recordedAt: "2026-10-01T00:00:00Z" }] }),
    ]);
    mocks.observe.mockResolvedValue(observation([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], "CLEAN"));

    const result = await runBuildPrDeliveryReconcile();

    expect(result.actuated).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetch.mock.calls[0]?.[1]?.body)).toContain("enablePullRequestAutoMerge");
    const quietWrite = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "quiet")?.[0];
    expect(quietWrite.data.workspaceState.prDelivery.lastError).toBe("withheld:queue");
  });

  // BI-4D0B2AAB: a passed review's status expires after an hour, and the merge queue re-checks it.
  it("republishes Failure Readiness before arming auto-merge, and withholds a PR with no publishable review", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 9 } } } }) });
    mocks.findMany.mockResolvedValue([room({ id: "reviewed", capsuleId: "WC-OK" }), room({ id: "unreviewed", capsuleId: "WC-NONE" })]);
    mocks.verdict.mockImplementation(async (capsuleId: string) => capsuleId === "WC-OK"
      ? { mayPublish: true, reason: "reviewed" } : { mayPublish: false, reason: "No failure-analysis review exists for this final change." });
    const order: string[] = [];
    mocks.publish.mockImplementation(async () => { order.push("publish"); });
    mocks.fetch.mockImplementation(async () => { order.push("arm"); return { ok: true, status: 200, json: async () => ({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 9 } } } }) }; });
    mocks.observe.mockResolvedValue(observation([{ name: "Failure Readiness", status: "COMPLETED", conclusion: "SUCCESS" }], "CLEAN"));

    const result = await runBuildPrDeliveryReconcile();

    expect(mocks.publish).toHaveBeenCalledWith("WC-OK");
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["publish", "arm"]);
    expect(result.actuated).toBe(1);
    const withheld = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "unreviewed")?.[0];
    expect(withheld.data.workspaceState.prDelivery.status).not.toBe("queued");
    expect(withheld.data.workspaceState.prDelivery.lastReadiness).toBe("checking");
  });

  it("clears a PR whose only red check is an expired Failure Readiness status, without staging a repair", async () => {
    mocks.findMany.mockResolvedValue([room({ id: "expired", capsuleId: "WC-OK" })]);
    mocks.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    mocks.observe
      .mockResolvedValueOnce(observation([
        { name: "Failure Readiness", status: "COMPLETED", conclusion: "FAILURE", workflowRunId: 41 },
        { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
      ], "BLOCKED"))
      .mockResolvedValueOnce(observation([
        { name: "Failure Readiness", status: "IN_PROGRESS", conclusion: null, workflowRunId: 41 },
        { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
      ], "BLOCKED"));

    await runBuildPrDeliveryReconcile();

    expect(mocks.publish).toHaveBeenCalledWith("WC-OK");
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("/actions/runs/41/rerun-failed-jobs");
    expect(mocks.observe).toHaveBeenCalledTimes(2);
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });
});

describe("observesRoomHead", () => {
  const head = "a".repeat(40);
  const other = "b".repeat(40);
  it("observes the room's own head, and any head when the room has none", () => {
    expect(observesRoomHead(head, head.toUpperCase(), null)).toBe(true);
    expect(observesRoomHead(null, other, null)).toBe(true);
  });
  it("skips a different head unless the room's head is the one it updated from (#6148)", () => {
    expect(observesRoomHead(head, other, { status: "checking", lastObservedHeadSha: head })).toBe(false);
    expect(observesRoomHead(head, other, { status: "updating", lastObservedHeadSha: other })).toBe(false);
    expect(observesRoomHead(head, other, { status: "updating", lastObservedHeadSha: head })).toBe(true);
  });
});
