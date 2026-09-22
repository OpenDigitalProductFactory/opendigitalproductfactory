import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { reconcileInventoryPullRequestBindings } from "./pull-request-binding-runtime";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), snapshots: vi.fn(), rooms: vi.fn(), update: vi.fn(), journal: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  contributorInventorySyncRun: { findUnique: mocks.run },
  contributorInventorySnapshot: { findMany: mocks.snapshots },
  workroom: { findMany: mocks.rooms },
  $transaction: mocks.transaction,
} }));
const now = new Date("2026-09-12T23:00:00.000Z");
const repository = "example/platform";
const observation = createPullRequestObservation({
  repositoryFullName: repository, number: 42, url: `https://github.com/${repository}/pull/42`,
  title: "Review evidence", headBranch: "fix/review", headSha: "a".repeat(40),
  state: "open", isDraft: false, mergeStateStatus: null, mergeCommitSha: null, mergedAt: null,
  providerUpdatedAt: now.toISOString(), observedAt: now.toISOString(),
});
const room = {
  id: "room-row", capsuleId: "WC-TEST", repositoryFullName: repository, headBranch: "fix/review",
  headSha: observation.headSha, pullRequestNumber: null, pullRequestUrl: null, updatedAt: now,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockResolvedValue({ completedAt: now, perSourceResult: { "github-pr": { ok: true, snapshotRunId: "retained-run" } } });
  mocks.snapshots.mockResolvedValue([{ payload: observation }]);
  mocks.rooms.mockResolvedValue([room]);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (fn) => fn({ workroom: { updateMany: mocks.update }, workroomActivity: { create: mocks.journal } }));
});

describe("inventory Workroom binding", () => {
  it("retains previous PR history when the current full head selects a replacement", async () => {
    const previousUrl = `https://github.com/${repository}/pull/41`;
    mocks.rooms.mockResolvedValue([{ ...room, pullRequestNumber: 41, pullRequestUrl: previousUrl }]);
    expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      headSha: observation.headSha, pullRequestNumber: 41, pullRequestUrl: previousUrl,
    }) }));
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ previousPullRequestNumber: 41, previousPullRequestUrl: previousUrl }),
    }) }));
  });
  it("binds an external room from retained observations and records evidence atomically", async () => {
    expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(1);
    expect(mocks.snapshots).toHaveBeenCalledWith(expect.objectContaining({ where: { syncRunId: "retained-run", source: "github-pr" } }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: room.id, updatedAt: now, headSha: observation.headSha, pullRequestNumber: null }),
      data: { pullRequestNumber: 42, pullRequestUrl: observation.url },
    }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      workCapsuleId: room.id, payload: expect.objectContaining({ syncRunId: "current-run", observationFingerprint: observation.observationFingerprint }),
    }) }));
  });

  it("does not journal a duplicate or concurrent binding", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect(await reconcileInventoryPullRequestBindings("current-run", now)).toMatchObject({ bound: 0, compareAndSwapLost: 1 });
    expect(mocks.journal).not.toHaveBeenCalled();
  });

  it("does not rewrite or journal an already current binding", async () => {
    mocks.rooms.mockResolvedValue([{ ...room, pullRequestNumber: observation.number, pullRequestUrl: observation.url }]);
    expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.journal).not.toHaveBeenCalled();
  });

  it("journals the matching head when retained observations include an older head of the same PR", async () => {
    const old = createPullRequestObservation({ ...observation, headSha: "b".repeat(40) });
    mocks.snapshots.mockResolvedValue([{ payload: old }, { payload: observation }]);
    expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(1);
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ headSha: observation.headSha, observationFingerprint: observation.observationFingerprint }),
    }) }));
  });

  it.each([null, { completedAt: now, perSourceResult: { "github-pr": { ok: false } } },
    { completedAt: new Date(now.getTime() - 21 * 60_000), perSourceResult: { "github-pr": { ok: true } } }])(
    "refuses missing, failed, or stale confirmation", async (run) => {
      mocks.run.mockResolvedValue(run);
      expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(0);
      expect(mocks.snapshots).not.toHaveBeenCalled();
    },
  );

  it("rejects a tampered observation", async () => {
    mocks.snapshots.mockResolvedValue([{ payload: { ...observation, number: 43 } }]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now)).toMatchObject({ bound: 0, invalidObservations: 1 });
    expect(mocks.rooms).not.toHaveBeenCalled();
  });

  it("reports the batch bound and leaves overflow for the next existing tick", async () => {
    mocks.rooms.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ ...room, id: `room-${index}`, capsuleId: `WC-${index}` })));
    expect(await reconcileInventoryPullRequestBindings("current-run", now)).toMatchObject({ bound: 100, hasMore: true });
    expect(mocks.journal).toHaveBeenCalledTimes(100);
    expect(mocks.rooms.mock.calls[0][0].where.OR[0]).toMatchObject({
      repositoryFullName: repository, headBranch: room.headBranch,
      AND: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([{ headSha: observation.headSha }]) })]),
    });
  });

  it("does not treat a truncated provider batch as complete coverage", async () => {
    mocks.snapshots.mockResolvedValue(Array.from({ length: 1001 }, () => ({ payload: observation })));
    expect(await reconcileInventoryPullRequestBindings("current-run", now)).toMatchObject({ bound: 0, hasMore: true, reason: "snapshot-limit" });
    expect(mocks.rooms).not.toHaveBeenCalled();
  });

  it("propagates journal failure through the transaction for rollback and retry", async () => {
    mocks.journal.mockRejectedValue(new Error("journal unavailable"));
    await expect(reconcileInventoryPullRequestBindings("current-run", now)).rejects.toThrow("journal unavailable");
  });
});
