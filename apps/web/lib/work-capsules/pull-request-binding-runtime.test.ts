import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubReaderResult } from "@/lib/contributor-change-lanes/github-rest-reader";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { reconcileInventoryPullRequestBindings } from "./pull-request-binding-runtime";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), snapshots: vi.fn(), rooms: vi.fn(), roomFindFirst: vi.fn(),
  roomCreate: vi.fn(), update: vi.fn(), journal: vi.fn(), relationCreateMany: vi.fn(),
  transaction: vi.fn(), storefrontConfig: vi.fn(), organization: vi.fn(), platformDevConfig: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  contributorInventorySyncRun: { findUnique: mocks.run },
  contributorInventorySnapshot: { findMany: mocks.snapshots },
  workroom: { findMany: mocks.rooms, findFirst: mocks.roomFindFirst, create: mocks.roomCreate },
  storefrontConfig: { findFirst: mocks.storefrontConfig },
  organization: { findFirst: mocks.organization },
  platformDevConfig: { findUnique: mocks.platformDevConfig },
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
const openRow = {
  sourceKey: String(observation.number),
  payload: observation,
  custodySource: {
    baseBranch: "main", baseSha: "1".repeat(40), headRepositoryFullName: repository,
    authorLogin: "dependabot[bot]", authorType: "Bot",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockResolvedValue({ completedAt: now, perSourceResult: { "github-pr": { ok: true, snapshotRunId: "retained-run" } } });
  mocks.snapshots.mockResolvedValue([{ payload: observation }]);
  mocks.rooms.mockResolvedValue([room]);
  mocks.roomFindFirst.mockResolvedValue(null);
  mocks.roomCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "created-room-row",
    ...data,
  }));
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.relationCreateMany.mockResolvedValue({ count: 1 });
  mocks.storefrontConfig.mockResolvedValue({ archetype: { category: "software-platform" } });
  mocks.organization.mockResolvedValue({ topAccountablePrincipalId: "principal-owner" });
  mocks.platformDevConfig.mockResolvedValue({ upstreamRemoteUrl: `https://github.com/${repository}.git` });
  mocks.transaction.mockImplementation(async (fn) => fn({
    workroom: { findFirst: mocks.roomFindFirst, create: mocks.roomCreate, updateMany: mocks.update },
    workroomActivity: { create: mocks.journal },
    workroomRelation: { createMany: mocks.relationCreateMany },
  }));
});

describe("inventory Workroom binding", () => {
  it("binds an old open PR missing from the recent inventory to its exact room", async () => {
    mocks.run.mockResolvedValue({ completedAt: now, perSourceResult: { "github-pr": { ok: false } } });
    mocks.rooms.mockResolvedValue([{ ...room, baseBranch: "main" }]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now, {
      ok: true, rows: [openRow],
    })).toMatchObject({ bound: 1, openCoverage: { status: "complete", count: 1 } });
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ confirmedAt: now.toISOString(), headRepositoryFullName: repository, baseBranch: "main" }),
    }) }));
  });

  it("does not bind a fork with the same branch and head from either open list", async () => {
    mocks.rooms.mockResolvedValue([{ ...room, baseBranch: "main" }]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now, {
      ok: true, rows: [{ ...openRow, custodySource: { ...openRow.custodySource, headRepositoryFullName: "fork/platform" } }],
    })).toMatchObject({ bound: 0, openCoverage: { status: "complete", count: 1 } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    { ...room, baseBranch: "release" },
    { ...room, baseBranch: "main", headSha: "b".repeat(40) },
    { ...room, baseBranch: "main", headSha: null },
  ])("does not bind an open PR to a room whose base or authored head differs", async (candidate) => {
    mocks.rooms.mockResolvedValue([candidate]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now, {
      ok: true, rows: [openRow],
    })).toMatchObject({ bound: 0, openCoverage: { status: "complete", count: 1 } });
  });

  it.each([
    { ok: false, error: "page incomplete", state: "error" },
    { ok: true, rows: [], unchanged: true },
    { ok: true, rows: [openRow, openRow] },
    { ok: true, rows: [{ ...openRow, payload: { ...observation, number: 99 } }] },
  ] satisfies GithubReaderResult[])("reports unknown open coverage without binding from cached open observations", async (scan) => {
    expect(await reconcileInventoryPullRequestBindings("current-run", now, scan)).toMatchObject({
      bound: 0, openCoverage: { status: "unknown" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("distinguishes a confirmed empty open population from unknown coverage", async () => {
    expect(await reconcileInventoryPullRequestBindings("current-run", now, { ok: true, rows: [] }))
      .toMatchObject({ bound: 0, openCoverage: { status: "complete", count: 0 } });
  });

  it("waits for another observation when the fresh and recent sources disagree on state", async () => {
    const closed = createPullRequestObservation({ ...observation, state: "closed" });
    mocks.snapshots.mockResolvedValue([{ payload: closed }]);
    mocks.rooms.mockResolvedValue([{ ...room, baseBranch: "main" }]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now, { ok: true, rows: [openRow] }))
      .toMatchObject({ bound: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not replace a current PR from a closed snapshot when open coverage is unknown", async () => {
    const closed = createPullRequestObservation({ ...observation, state: "closed", number: 41,
      url: `https://github.com/${repository}/pull/41` });
    mocks.snapshots.mockResolvedValue([{ payload: closed }]);
    mocks.rooms.mockResolvedValue([{ ...room, pullRequestNumber: observation.number, pullRequestUrl: observation.url }]);
    expect(await reconcileInventoryPullRequestBindings("current-run", now, {
      ok: false, error: "incomplete page", state: "error",
    })).toMatchObject({ bound: 0, openCoverage: { status: "unknown" } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("binds a room whose head is still its claim-time base (BI-A7797C2C)", async () => {
    const base = "1".repeat(40);
    mocks.rooms.mockResolvedValue([{ ...room, headSha: base, baseSha: base }]);
    expect((await reconcileInventoryPullRequestBindings("current-run", now)).bound).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: room.id, headSha: base, pullRequestNumber: null }),
      data: { pullRequestNumber: observation.number, pullRequestUrl: observation.url },
    }));
  });

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

describe("FLOW-PR-1 open PR custody adoption and lapsed-lease reconciliation", () => {
  const standingRoom = {
    id: "standing-pr-flow-id",
    capsuleId: "WC-PRFLOW",
    createdByPrincipalId: null,
    requestedByPrincipalId: null,
    participants: [{ principalId: "principal-owner", roles: ["accountable"] }],
  };

  it("adopts an unmatched same-repo open PR into one Build Studio Workroom under the standing duty", async () => {
    mocks.run.mockResolvedValue({ completedAt: now, perSourceResult: { "github-pr": { ok: false } } });
    mocks.rooms.mockResolvedValue([]);
    mocks.roomFindFirst
      .mockResolvedValueOnce(standingRoom) // standing room lookup
      .mockResolvedValueOnce(null); // inside tx existence check

    const res = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );

    expect(res.custody).toMatchObject({
      adopted: 1,
      handedOff: 0,
      alreadyOwned: 0,
      awaitingAuthorization: 0,
      staleSkipped: 0,
      compareAndSwapLost: 0,
      skippedReason: null,
    });
    expect(mocks.roomCreate).toHaveBeenCalledTimes(1);
    const createdData = mocks.roomCreate.mock.calls[0][0].data;
    expect(createdData).toMatchObject({
      source: "scheduled-steward",
      status: "ready",
      portfolioRole: "manufactureAndDeliver",
      executorKind: "build-studio",
      executorRef: "standing-room:WC-PRFLOW",
      repositoryFullName: repository,
      baseBranch: "main",
      baseSha: "1".repeat(40),
      headBranch: "fix/review",
      headSha: observation.headSha,
      pullRequestNumber: 42,
      pullRequestUrl: observation.url,
      idempotencyKey: `pull-request-custody:${repository}#42`,
      createdByPrincipalId: "principal-owner",
      requestedByPrincipalId: "principal-owner",
      leaseHolderPrincipalId: "principal-owner",
      leaseExpiresAt: null,
    });
    expect(createdData.workspaceState).toMatchObject({
      prCustody: expect.objectContaining({
        mode: "build-studio-custody",
        recoveryReason: null,
        accountableOwnerPrincipalId: "principal-owner",
        standingRoomCapsuleId: "WC-PRFLOW",
      }),
      prDelivery: expect.objectContaining({
        prNumber: 42,
        prUrl: observation.url,
      }),
    });
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "adopted",
        payload: expect.objectContaining({
          pullRequestNumber: 42,
          custodyMode: "build-studio-custody",
          recoveryReason: null,
        }),
      }),
    }));
    expect(mocks.relationCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ fromWorkroomId: "standing-pr-flow-id", toWorkroomId: "created-room-row", relation: "contains" }],
      skipDuplicates: true,
    }));
  });

  it("converges on one room across replays and concurrent unique-constraint races", async () => {
    mocks.rooms.mockResolvedValue([]);
    mocks.roomFindFirst
      .mockResolvedValueOnce(standingRoom)
      .mockResolvedValueOnce(null);
    const uniqueErr = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mocks.roomCreate.mockRejectedValueOnce(uniqueErr);

    const res = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(res.custody).toMatchObject({ adopted: 0, compareAndSwapLost: 1 });
    expect(mocks.journal).not.toHaveBeenCalled();

    // Replay when a Build Studio room already owns PR #42 leaves one room with zero writes
    mocks.roomCreate.mockClear();
    mocks.rooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ...room,
        baseBranch: "main",
        pullRequestNumber: 42,
        pullRequestUrl: observation.url,
        executorKind: "build-studio",
        executorRef: "standing-room:WC-PRFLOW",
        featureBuildId: null,
        leaseHolderPrincipalId: "principal-owner",
        leaseExpiresAt: null,
        createdByPrincipalId: "principal-owner",
        requestedByPrincipalId: "principal-owner",
        lastSyncedAt: now,
        workspaceState: {},
      }]);
    mocks.roomFindFirst.mockResolvedValueOnce(standingRoom);

    const replayRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(replayRes.custody).toMatchObject({ adopted: 0, alreadyOwned: 1, handedOff: 0 });
    expect(mocks.roomCreate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps a fork PR sharing the same branch ref visible without colliding on branch identity", async () => {
    const forkRow = {
      ...openRow,
      custodySource: { ...openRow.custodySource, headRepositoryFullName: "fork/platform" },
    };
    mocks.rooms.mockResolvedValueOnce([]); // custody pass: no existing room bound to PR #42
    mocks.roomFindFirst
      .mockResolvedValueOnce(standingRoom)
      .mockResolvedValueOnce(null);

    const res = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [forkRow] },
      { reconcileCustody: true },
    );

    expect(res.bound).toBe(0);
    expect(res.custody).toMatchObject({ adopted: 1, awaitingAuthorization: 1 });
    const createdData = mocks.roomCreate.mock.calls[0][0].data;
    expect(createdData).toMatchObject({
      headBranch: null,
      executorKind: "human",
      pullRequestNumber: 42,
      idempotencyKey: `pull-request-custody:${repository}#42`,
    });
    expect(createdData.scopeClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workroomPosture: expect.objectContaining({ actionBoundary: "advise" }),
        }),
      ]),
    );
    expect(createdData.workspaceState).toMatchObject({
      prCustody: expect.objectContaining({
        mode: "observe-only",
        recoveryReason: "fork-pull-request",
        headRepositoryFullName: "fork/platform",
        headRef: "fix/review",
        accountableOwnerPrincipalId: "principal-owner",
      }),
    });
  });

  it("records draft PRs and missing accountable owners as observe-only with explicit recovery reasons", async () => {
    const draftObs = createPullRequestObservation({ ...observation, isDraft: true });
    const draftRow = { ...openRow, payload: draftObs };
    mocks.rooms.mockResolvedValue([]);
    mocks.roomFindFirst
      .mockResolvedValueOnce(standingRoom)
      .mockResolvedValueOnce(null);

    const draftRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [draftRow] },
      { reconcileCustody: true },
    );
    expect(draftRes.custody).toMatchObject({ adopted: 1, awaitingAuthorization: 1 });
    expect(mocks.roomCreate.mock.calls[0][0].data).toMatchObject({
      headBranch: "fix/review",
      executorKind: "human",
      workspaceState: expect.objectContaining({
        prCustody: expect.objectContaining({
          mode: "observe-only",
          recoveryReason: "draft-pull-request",
        }),
      }),
    });

    mocks.roomCreate.mockClear();
    mocks.organization.mockResolvedValue({ topAccountablePrincipalId: null });
    mocks.roomFindFirst
      .mockResolvedValueOnce(null) // no standing room
      .mockResolvedValueOnce(null); // tx check

    const noOwnerRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(noOwnerRes.custody).toMatchObject({ adopted: 1, awaitingAuthorization: 1 });
    expect(mocks.roomCreate.mock.calls[0][0].data).toMatchObject({
      executorKind: "human",
      createdByPrincipalId: null,
      workspaceState: expect.objectContaining({
        prCustody: expect.objectContaining({
          mode: "observe-only",
          recoveryReason: "accountable-owner-missing",
        }),
      }),
    });
  });

  it("preserves a live lease and hands off an eligible same-owner lapsed lease with a CAS fence", async () => {
    const liveRoom = {
      ...room,
      baseBranch: "main",
      pullRequestNumber: 42,
      pullRequestUrl: observation.url,
      executorKind: "codex-desktop",
      executorRef: "session-1",
      featureBuildId: null,
      leaseHolderPrincipalId: "principal-owner",
      leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
      createdByPrincipalId: "principal-owner",
      requestedByPrincipalId: "principal-owner",
      lastSyncedAt: now,
      workspaceState: {},
    };
    mocks.rooms
      .mockResolvedValueOnce([]) // binding pass: none unbound
      .mockResolvedValueOnce([liveRoom]); // custody pass: live lease room
    mocks.roomFindFirst.mockResolvedValueOnce(standingRoom);

    const liveRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(liveRes.custody).toMatchObject({ adopted: 0, handedOff: 0, alreadyOwned: 1 });
    expect(mocks.update).not.toHaveBeenCalled();

    // Now test eligible same-owner lapsed lease
    const lapsedAt = new Date(now.getTime() - 60_000);
    const lapsedRoom = { ...liveRoom, leaseExpiresAt: lapsedAt };
    mocks.rooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([lapsedRoom]);
    mocks.roomFindFirst.mockResolvedValueOnce(standingRoom);

    const lapsedRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(lapsedRes.custody).toMatchObject({ adopted: 0, handedOff: 1, alreadyOwned: 0 });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: lapsedRoom.id,
        updatedAt: lapsedRoom.updatedAt,
        executorKind: "codex-desktop",
        leaseHolderPrincipalId: "principal-owner",
        leaseExpiresAt: lapsedAt,
      }),
      data: expect.objectContaining({
        executorKind: "build-studio",
        executorRef: "standing-room:WC-PRFLOW",
        leaseHolderPrincipalId: "principal-owner",
        leaseExpiresAt: null,
      }),
    }));
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "executor-changed",
        payload: expect.objectContaining({
          fromExecutorKind: "codex-desktop",
          toExecutorKind: "build-studio",
          reason: "lapsed-lease-pr-custody-handoff",
          pullRequestNumber: 42,
        }),
      }),
    }));
  });

  it("refuses lapsed-lease takeover for a different human owner and skips non-software-platform installs", async () => {
    const otherOwnerLapsed = {
      ...room,
      baseBranch: "main",
      pullRequestNumber: 42,
      pullRequestUrl: observation.url,
      executorKind: "codex-desktop",
      executorRef: "session-other",
      featureBuildId: null,
      leaseHolderPrincipalId: "different-owner",
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      createdByPrincipalId: "different-owner",
      requestedByPrincipalId: "different-owner",
      lastSyncedAt: now,
      workspaceState: {},
    };
    mocks.rooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([otherOwnerLapsed]);
    mocks.roomFindFirst.mockResolvedValueOnce(standingRoom);

    const mismatchRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(mismatchRes.custody).toMatchObject({ handedOff: 0, awaitingAuthorization: 1 });
    expect(mocks.update).not.toHaveBeenCalled();

    // Non-software-platform archetype
    mocks.storefrontConfig.mockResolvedValue({ archetype: { category: "food-hospitality" } });
    mocks.rooms.mockResolvedValue([]);
    const nonSoftwareRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(nonSoftwareRes.custody).toMatchObject({
      adopted: 0,
      skippedReason: "archetype-not-applicable",
    });
    expect(mocks.roomCreate).not.toHaveBeenCalled();
  });

  it("skips custody adoption on unknown open coverage and stale head observations", async () => {
    const unknownRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: false, error: "provider outage", state: "error" },
      { reconcileCustody: true },
    );
    expect(unknownRes.custody).toMatchObject({ adopted: 0, skippedReason: "provider outage" });
    expect(mocks.roomCreate).not.toHaveBeenCalled();

    const newerRoom = {
      ...room,
      baseBranch: "main",
      pullRequestNumber: 42,
      pullRequestUrl: observation.url,
      headSha: "c".repeat(40),
      executorKind: "codex-desktop",
      executorRef: "session-1",
      featureBuildId: null,
      leaseHolderPrincipalId: "principal-owner",
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      createdByPrincipalId: "principal-owner",
      requestedByPrincipalId: "principal-owner",
      lastSyncedAt: new Date(now.getTime() + 60_000),
      workspaceState: {},
    };
    mocks.rooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([newerRoom]);
    mocks.roomFindFirst.mockResolvedValueOnce(standingRoom);

    const staleRes = await reconcileInventoryPullRequestBindings(
      "current-run",
      now,
      { ok: true, rows: [openRow] },
      { reconcileCustody: true },
    );
    expect(staleRes.custody).toMatchObject({ adopted: 0, handedOff: 0, staleSkipped: 1 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
