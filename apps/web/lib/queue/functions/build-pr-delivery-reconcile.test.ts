import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  jobUpsert: vi.fn(),
  jobUpdateMany: vi.fn(),
  updateMany: vi.fn(),
  activityCreate: vi.fn(),
  observe: vi.fn(),
  createIssue: vi.fn(),
  postureDefault: vi.fn(),
  fetch: vi.fn(),
  verdict: vi.fn(),
  publish: vi.fn(),
  dispatch: vi.fn(),
  buildLookup: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    workroom: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    workroomActivity: { create: mocks.activityCreate },
    scheduledJob: { upsert: mocks.jobUpsert, updateMany: mocks.jobUpdateMany },
    featureBuild: { findUnique: mocks.buildLookup },
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
vi.mock("@/lib/build/pr-ci-repair", () => ({ dispatchBuildPrCiRepair: mocks.dispatch }));

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
    mocks.jobUpsert.mockResolvedValue({ id: "pr-job", runCursor: null, enabled: true });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
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

  it("eventually observes every eligible room despite repeated unrelated drive timestamp writes", async () => {
    let clock = Date.parse("2026-11-01T00:00:00Z");
    let cursor: string | null = null;
    const rows = Array.from({ length: 100 }, (_, index) => room({
      id: `row-${String(index).padStart(3, "0")}`,
      capsuleId: `WC-${index}`,
      pullRequestNumber: index + 1,
      updatedAt: new Date(++clock),
    }));
    const observed = new Set<number>();
    mocks.jobUpsert.mockImplementation(async () => ({ id: "pr-job", runCursor: cursor, enabled: true }));
    mocks.jobUpdateMany.mockImplementation(async ({ where, data }) => {
      if (where.runCursor !== cursor) return { count: 0 };
      cursor = data.runCursor;
      return { count: 1 };
    });
    // Repository fixture honors the real query's keyset boundary, order and cap.
    // It does not substitute a preselected batch for the production selector.
    mocks.findMany.mockImplementation(async ({ where, orderBy, take }) => {
      const key = Object.keys(orderBy)[0] as "id" | "updatedAt";
      return rows.filter(row => !where.id?.gt || row.id > where.id.gt)
        .sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)
        .slice(0, take).map(row => ({ ...row }));
    });
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      const row = rows.find(row => row.id === where.id);
      if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(++clock) });
      return { count: 1 };
    });
    mocks.observe.mockImplementation(async ({ prNumber }) => {
      observed.add(prNumber);
      return observation([{ name: "ci", status: "IN_PROGRESS", conclusion: null }]);
    });

    for (let tick = 0; tick < 12; tick++) {
      if (tick % 3 === 0) {
        // The existing standing drive writes a quiet snapshot every 15 minutes.
        for (const row of rows) row.updatedAt = new Date(++clock);
      }
      await runBuildPrDeliveryReconcile();
    }

    expect(observed.size).toBe(100);
    expect(observed.has(100)).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
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

  it("does not contact GitHub after losing the durable batch claim", async () => {
    mocks.findMany.mockResolvedValue([room({})]);
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    expect(await runBuildPrDeliveryReconcile()).toEqual({ observed: 0, actuated: 0, escalated: 0, compareAndSwapLost: 0 });
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("claims progress before a stale head or GitHub failure without rebinding the stale room", async () => {
    mocks.findMany.mockResolvedValue([
      room({ id: "a-stale", headSha: "current-head", pullRequestNumber: 1 }),
      room({ id: "b-network", pullRequestNumber: 2 }),
    ]);
    mocks.observe.mockImplementation(async ({ prNumber }) => {
      if (prNumber === 2) throw new Error("GitHub unavailable");
      return observation([], "CLEAN");
    });
    const result = await runBuildPrDeliveryReconcile();
    expect(result).toMatchObject({ observed: 1, actuated: 0 });
    expect(mocks.jobUpdateMany.mock.calls[0]?.[0].data.runCursor).toBe("b-network");
    expect(mocks.jobUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.observe.mock.invocationCallOrder[0]!);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany.mock.calls[0]?.[0].where.id).toBe("b-network");
    expect(mocks.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("headSha");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("performs no GitHub effects if durable progress cannot be recorded", async () => {
    mocks.findMany.mockResolvedValue([room({})]);
    mocks.jobUpdateMany.mockRejectedValue(new Error("cursor store unavailable"));
    await expect(runBuildPrDeliveryReconcile()).rejects.toThrow("cursor store unavailable");
    expect(mocks.observe).not.toHaveBeenCalled();
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

// BI-085A37EC: a Build Studio PR red on a real defect goes back to the build's
// own repair loop. PR #6983 (FB-2F2D46D5) was only staged for a person.
describe("runBuildPrDeliveryReconcile — Build Studio PR repair dispatch (BI-085A37EC)", () => {
  const red = () => observation([
    { name: "Unit tests (mobile jest)", status: "COMPLETED", conclusion: "FAILURE", workflowRunId: 7, detailsUrl: "https://github.com/o/r/actions/runs/7/job/70" },
    { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
  ]);
  const buildRoom = (overrides: Record<string, unknown> = {}) =>
    room({ id: "build-room", capsuleId: "WC-8B8A9D6F", featureBuildId: "fb-row", executorKind: "build-studio", ...overrides });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE = "enforce";
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpsert.mockResolvedValue({ id: "pr-job", runCursor: null, enabled: true });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.activityCreate.mockResolvedValue({});
    mocks.createIssue.mockResolvedValue({ reportId: "PIR-1" });
    mocks.postureDefault.mockResolvedValue(null);
    mocks.verdict.mockResolvedValue({ mayPublish: true, reason: "reviewed" });
    mocks.publish.mockResolvedValue(undefined);
    mocks.buildLookup.mockResolvedValue({ buildId: "FB-2F2D46D5" });
    mocks.dispatch.mockResolvedValue("dispatched");
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    delete process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE;
    vi.unstubAllGlobals();
  });

  it("dispatches the build's repair with the failing check, and asks no person", async () => {
    mocks.findMany.mockResolvedValue([buildRoom()]);
    mocks.observe.mockResolvedValue(red());

    const result = await runBuildPrDeliveryReconcile();

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    const [input] = mocks.dispatch.mock.calls[0];
    expect(input.buildId).toBe("FB-2F2D46D5");
    expect(input.packet.headSha).toBe("sha1");
    expect(input.packet.failingChecks.map((c: { name: string }) => c.name)).toEqual(["Unit tests (mobile jest)"]);
    expect(input.github).toEqual({ owner: "o", repo: "r", token: "token" });
    expect(result.actuated).toBe(1);
    const write = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "build-room")?.[0];
    expect(write.data.workspaceState.prDelivery.followThrough.hold).toBe("repairing");
    expect(write.data.workspaceState.prDelivery.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(1);
    expect(String(mocks.activityCreate.mock.calls[0]?.[0]?.data?.summary)).toContain("dispatched repair attempt 1 of 2");
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("stages the repair for a person, spending nothing, when the build cannot take it", async () => {
    mocks.dispatch.mockResolvedValue("unavailable");
    mocks.findMany.mockResolvedValue([buildRoom()]);
    mocks.observe.mockResolvedValue(red());

    await runBuildPrDeliveryReconcile();

    const write = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "build-room")?.[0];
    expect(write.data.workspaceState.prDelivery.followThrough.hold).toBe("awaiting-person");
    expect(write.data.workspaceState.prDelivery.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
  });

  it("escalates once, naming the failing check, when the repair budget is spent", async () => {
    const spent = createBuildPrDeliveryState({ repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9" });
    spent.followThrough.attempts.attempts["post-push-ci-failure"] = 2;
    mocks.findMany.mockResolvedValue([buildRoom({ workspaceState: writeBuildPrDeliveryState({}, spent) })]);
    mocks.observe.mockResolvedValue(red());

    await runBuildPrDeliveryReconcile();

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    expect(String(mocks.createIssue.mock.calls[0]?.[0]?.description)).toContain("repair-budget-exhausted");
    expect(String(mocks.createIssue.mock.calls[0]?.[0]?.description)).toContain("Unit tests (mobile jest)");
  });

  it("a quiet Build Studio room only records", async () => {
    mocks.findMany.mockResolvedValue([buildRoom({ scopeClaims: [{ workroomPosture: { proactivityLevel: "quiet" }, recordedAt: "2026-10-01T00:00:00Z" }] })]);
    mocks.observe.mockResolvedValue(red());

    await runBuildPrDeliveryReconcile();

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });
});

// BI-0EDCF2EC: a room stopped only because GitHub had not yet decided the
// merge state (WC-8B8A9D6F, PR #6983) is looked at again and carried on.
describe("runBuildPrDeliveryReconcile — re-evaluating stopped rooms (BI-0EDCF2EC)", () => {
  const stoppedOnUnknown = () => ({
    ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9" }),
    status: "escalated" as const,
    lastError: "observation-budget-exhausted:merge-state-unknown",
    escalationKey: "build-pr-delivery:9:observation-budget-exhausted:merge-state-unknown",
    lastReadiness: "unknown" as const,
    lastObservedHeadSha: "sha1",
    lastObservedAt: "2026-11-13T08:02:06.317Z",
    reconciliationAttempts: 8,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE = "enforce";
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpsert.mockResolvedValue({ id: "pr-job", runCursor: null, enabled: true });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.activityCreate.mockResolvedValue({});
    mocks.createIssue.mockResolvedValue({ reportId: "PIR-1" });
    mocks.postureDefault.mockResolvedValue(null);
    mocks.publish.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    delete process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE;
    vi.unstubAllGlobals();
  });

  it("resumes the stopped room, records why, and arms the queue once its review is publishable", async () => {
    mocks.verdict.mockResolvedValue({ mayPublish: true, reason: "reviewed" });
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 9 } } } }) });
    mocks.findMany.mockResolvedValue([room({ id: "stopped", workspaceState: writeBuildPrDeliveryState({}, stoppedOnUnknown()) })]);
    mocks.observe.mockResolvedValue(observation([
      { name: "Merge Readiness", status: "COMPLETED", conclusion: "SUCCESS", required: true },
      { name: "Failure Readiness", status: "COMPLETED", conclusion: "FAILURE", required: false },
    ], "UNSTABLE"));

    const result = await runBuildPrDeliveryReconcile();

    expect(result).toMatchObject({ observed: 1, actuated: 1, escalated: 0 });
    const write = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "stopped")?.[0];
    expect(write.data.workspaceState.prDelivery).toMatchObject({ status: "queued", escalationKey: null });
    expect(mocks.activityCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "stopped", kind: "workroom-pr-delivery-resumed",
    }) });
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("holds a resumed room without a publishable review instead of queueing it to fail", async () => {
    mocks.verdict.mockResolvedValue({ mayPublish: false, reason: "No failure-analysis review exists for this final change." });
    mocks.findMany.mockResolvedValue([room({ id: "stopped", workspaceState: writeBuildPrDeliveryState({}, stoppedOnUnknown()) })]);
    mocks.observe.mockResolvedValue(observation([
      { name: "Merge Readiness", status: "COMPLETED", conclusion: "SUCCESS", required: true },
      { name: "Failure Readiness", status: "COMPLETED", conclusion: "FAILURE", required: false },
    ], "UNSTABLE"));

    await runBuildPrDeliveryReconcile();

    const write = mocks.updateMany.mock.calls.find((call) => call[0].where.id === "stopped")?.[0];
    expect(write.data.workspaceState.prDelivery).toMatchObject({ status: "checking", escalationKey: null, lastReadiness: "checking" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps a conflict stop while the conflict holds, recording only that it looked", async () => {
    const conflict = { ...stoppedOnUnknown(), lastError: "true-merge-conflict", escalationKey: "build-pr-delivery:9:true-merge-conflict" };
    mocks.findMany.mockResolvedValue([room({ id: "conflicted", workspaceState: writeBuildPrDeliveryState({}, conflict) })]);
    mocks.observe.mockResolvedValue(observation([], "DIRTY"));

    const result = await runBuildPrDeliveryReconcile();

    expect(result).toMatchObject({ observed: 1, actuated: 0, escalated: 0 });
    const write = mocks.updateMany.mock.calls[0]?.[0];
    expect(write.data.workspaceState.prDelivery).toMatchObject({ status: "escalated", escalationKey: conflict.escalationKey, reconciliationAttempts: 8 });
    expect(write.data.workspaceState.prDelivery.lastObservedAt).not.toBe(conflict.lastObservedAt);
    expect(mocks.createIssue).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("routes an undecided merge state away from the owner once past the budget, and keeps observing", async () => {
    const streak = {
      ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9" }),
      status: "checking" as const, lastReadiness: "unknown" as const, lastObservedHeadSha: "sha1", unknownObservations: 5,
    };
    mocks.findMany.mockResolvedValue([room({ id: "undecided", workspaceState: writeBuildPrDeliveryState({}, streak) })]);
    mocks.observe.mockResolvedValue(observation([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], "UNKNOWN"));

    await runBuildPrDeliveryReconcile();

    const write = mocks.updateMany.mock.calls[0]?.[0];
    expect(write.data.workspaceState.prDelivery).toMatchObject({ status: "checking", unknownObservations: 6, escalationKey: null });
    expect(write.data.workspaceState.prDelivery.nextObservationAt).toEqual(expect.any(String));
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    // Waiting on GitHub is not damaging, so the escalation gate keeps it away
    // from the owner (BI-5E067004): it is filed as routed work, not a
    // needs-human report.
    expect(mocks.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      type: "routed-repair",
      dedupeKey: "build-pr-delivery:9:merge-state-undecided:sha1:routed",
    }));
    expect(mocks.createIssue.mock.calls[0][0].selfFixClass).toBeUndefined();
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
