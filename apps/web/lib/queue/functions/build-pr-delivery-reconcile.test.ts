import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  activityCreate: vi.fn(),
  observe: vi.fn(),
  createIssue: vi.fn(),
  postureDefault: vi.fn(),
  fetch: vi.fn(),
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

import { runBuildPrDeliveryReconcile } from "./build-pr-delivery-reconcile";

function room(overrides: Record<string, unknown>) {
  return {
    id: "row",
    capsuleId: "WC-X",
    featureBuildId: null,
    repositoryFullName: "o/r",
    pullRequestNumber: 9,
    pullRequestUrl: "https://github.com/o/r/pull/9",
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
});
