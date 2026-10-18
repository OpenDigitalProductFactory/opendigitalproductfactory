import { beforeEach, describe, expect, it, vi } from "vitest";
import localCiSlotResources from "./local-ci-slot-resources.json";
const recordQueueTransition = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

import {
  claimNonprodEnvironmentLease,
  clampLeaseExpiry,
  listCapacityReservingNonprodEnvironmentLeases,
  listActiveNonprodEnvironmentLeases,
  listQueuedNonprodEnvironmentLeases,
  releaseNonprodEnvironmentLease,
  renewNonprodEnvironmentLease,
  reapExpiredNonprodEnvironmentLeases,
  admittedLeaseTtlMs,
  MAX_LEASE_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  LOCAL_CI_ACTIVE_LEASE_TTL_MS,
  NONPROD_OWNER_PROVIDERS,
} from "./environment-lease";

import { NOW, lease, db, admitted } from "./__tests__/environment-lease-fixtures";
import { leaseCleanupConsequenceForCall } from "./lease-cleanup-consequence";
beforeEach(() => {
  vi.clearAllMocks();
});
function configuredPool(requestedCapacity: 1 | 2 = 1) {
  return {
    value: {
      version: 1,
      requestedCapacity,
      ceilings: {
        minAvailableMemoryBytes: 8 * 1024 ** 3,
        maxSustainedCpuPercent: 75,
        minDiskFreeBytes: 100 * 1024 ** 3,
      },
      rollback: {
        maxServiceDurationRegressionPercent: 15,
        maxInfrastructureFailureRatePercent: 5,
        evidenceMismatchTolerance: 0,
      },
    },
  };
}

async function claim(mockDb: ReturnType<typeof db>, overrides = {}) {
  return claimNonprodEnvironmentLease({
    db: mockDb as never,
    environmentKey: "local-integration-ci",
    ownerProvider: "codex",
    ownerSessionId: "session-1",
    claimKey: "gate:session-1:sha",
    purpose: "CI",
    url: "http://localhost:3010",
    ports: [3010],
    expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
    now: NOW,
    ...overrides,
  });
}

describe("NONPROD_OWNER_PROVIDERS", () => {
  it("includes every supported host-worktree surface", () => {
    expect(NONPROD_OWNER_PROVIDERS).toEqual(
      expect.arrayContaining([
        "build-studio",
        "claude",
        "codex",
        "grok",
        "antigravity",
        "coworker",
      ]),
    );
    expect(NONPROD_OWNER_PROVIDERS).toHaveLength(6);
  });
});

describe("durable nonproduction admission", () => {
  it("binds fresh immediate versioned admission to its authenticated user inside the lease transaction", async () => {
    const mockDb = db();
    const taskRun = { upsert: vi.fn().mockImplementation(async ({ create }) => create) };
    const queued = lease({ slotManifestVersion: 1, worktreePath: "D:/worktrees/fix-x", branchName: "fix/x" });
    const active = admitted({ ...queued, status: "active", slotKey: "slot-0", activeKey: "local-integration-ci:slot-0" });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(active);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);
    mockDb.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 1 });
    Object.assign(mockDb, { taskRun });
    const result = await claim(mockDb, { authenticatedUserId: "user-1", slotManifestVersion: 1 });
    expect(taskRun.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "user-1", status: "completed",
        progressPayload: expect.objectContaining({ nonprodLeaseWait: expect.objectContaining({
          state: "admitted", leaseId: "NPEL-1", ownerSessionId: "session-1", eventConsumed: true,
        }) }),
      }), update: {},
    }));
    const taskRunId = taskRun.upsert.mock.calls[0]![0].create.taskRunId;
    expect(result.lease.taskRunId).toBe(taskRunId);
    expect(result.lease.expiresAt).toEqual(active.expiresAt);
    expect(mockDb.nonProductionEnvironmentLease.updateMany).toHaveBeenCalledWith({
      where: { id: active.id, status: "active", taskRunId: null }, data: { taskRunId },
    });
    const task = taskRun.upsert.mock.calls[0]![0].create;
    const read = { nonProductionEnvironmentLease: { findUnique: async () => result.lease },
      taskRun: { findUnique: async () => task } };
    const cleanupCall = { toolName: "release_nonprod_environment_lease", userId: "user-1",
      params: { leaseId: result.lease.leaseId, ownerSessionId: "session-1" } };
    const loadStance = async () => ({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    expect(await leaseCleanupConsequenceForCall(cleanupCall, { db: read, loadStance }))
      .toMatchObject({ consequence: null, reason: "owned-development-lease-cleanup" });
    expect(await leaseCleanupConsequenceForCall({ ...cleanupCall, userId: "foreign-user" }, { db: read, loadStance }))
      .toMatchObject({ consequence: "authority" });
  });

  it.each(["legacy", "unauthenticated", "existing-task", "replay"])("does not establish new provenance for %s admission", async (kind) => {
    const mockDb = db();
    const taskRun = { upsert: vi.fn() };
    const queued = lease({ slotManifestVersion: kind === "legacy" ? null : 1,
      taskRunId: kind === "existing-task" ? "TR-CALLER-OWNED" : null });
    const active = admitted({ ...queued, status: "active", slotKey: "slot-0", activeKey: "local-integration-ci:slot-0" });
    Object.assign(mockDb, { taskRun });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(kind === "replay" ? active : null)
      .mockResolvedValueOnce(active);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);
    const result = await claim(mockDb, { authenticatedUserId: kind === "unauthenticated" ? undefined : "user-1" });
    expect(result.status).toBe("admitted");
    expect(result.lease.taskRunId).toBe(queued.taskRunId);
    expect(taskRun.upsert).not.toHaveBeenCalled();
  });

  it("rejects the admission transaction when immediate provenance cannot be persisted", async () => {
    const mockDb = db();
    const queued = lease({ slotManifestVersion: 1 });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(admitted({ ...queued, status: "active", slotKey: "slot-0" }));
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);
    Object.assign(mockDb, { taskRun: { upsert: vi.fn().mockRejectedValue(new Error("task-store-unavailable")) } });
    await expect(claim(mockDb, { authenticatedUserId: "user-1" })).rejects.toThrow("task-store-unavailable");
    await expect(mockDb.$transaction.mock.results[0]!.value).rejects.toThrow("task-store-unavailable");
    expect(recordQueueTransition).not.toHaveBeenCalled();
  });

  it("uses relative duration after approval but preserves the independent queued deadline", async () => {
    const mockDb = db();
    const deadline = new Date(NOW.getTime() + 600_000);
    const queued = lease({ requestedTtlMs: 120_000, expiresAt: deadline });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null).mockResolvedValueOnce(admitted());
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);
    const result = await claim(mockDb, {
      expiresAt: new Date(NOW.getTime() - 60_000), requestedTtlMs: 120_000, waitDeadlineAt: deadline,
    });
    expect(result.status).toBe("admitted");
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestedTtlMs: 120_000, expiresAt: deadline }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({ status: "active", expiresAt: new Date(NOW.getTime() + 120_000) }),
    });
  });

  it("does not revive a cancelled identity when new relative timing is valid", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(lease({ status: "cancelled" }));
    const result = await claim(mockDb, {
      claimKey: "plain-request", requestedTtlMs: 120_000, waitDeadlineAt: new Date(NOW.getTime() + 600_000),
    });
    expect(result.status).toBe("terminal");
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("refuses an expired absolute proposal without lease or queue mutations", async () => {
    const mockDb = db();
    await expect(claim(mockDb, { expiresAt: NOW }))
      .rejects.toThrow("nonprod_lease_request_expired");
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
    expect(recordQueueTransition).not.toHaveBeenCalled();
  });

  it("rechecks expiry after waiting for the environment lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const mockDb = db();
      mockDb.$executeRaw.mockImplementation(async () => {
        vi.setSystemTime(new Date(NOW.getTime() + 2_000));
        return 1;
      });
      await expect(claim(mockDb, {
        now: undefined, expiresAt: new Date(NOW.getTime() + 1_000),
      })).rejects.toThrow("nonprod_lease_request_expired");
      expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
      expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
      expect(mockDb.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists admitted and queued leases without changing the legacy admitted list", async () => {
    const mockDb = db();
    await listActiveNonprodEnvironmentLeases({ db: mockDb as never, now: NOW });
    await listQueuedNonprodEnvironmentLeases({ db: mockDb as never, now: NOW });

    expect(mockDb.nonProductionEnvironmentLease.findMany).toHaveBeenNthCalledWith(1, {
      where: { status: "active", expiresAt: { gt: NOW } },
      orderBy: { createdAt: "desc" },
    });
    expect(mockDb.nonProductionEnvironmentLease.findMany).toHaveBeenNthCalledWith(2, {
      where: { status: "queued", expiresAt: { gt: NOW } },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    });
  });

  it("reads active and queued capacity reservations in one FIFO snapshot", async () => {
    const mockDb = db();
    await listCapacityReservingNonprodEnvironmentLeases({
      db: mockDb as never,
      now: NOW,
    });

    expect(mockDb.nonProductionEnvironmentLease.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["active", "queued"] },
        expiresAt: { gt: NOW },
      },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    });
  });

  it("creates a queued row, serializes reconciliation, and admits slot-0", async () => {
    let finishEnqueued: (() => void) | undefined;
    const enqueuedRecorded = new Promise<void>((resolve) => {
      finishEnqueued = resolve;
    });
    recordQueueTransition
      .mockReturnValueOnce(enqueuedRecorded)
      .mockResolvedValueOnce(undefined);
    const mockDb = db();
    const queued = lease();
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(admitted());
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);

    const result = await claim(mockDb);

    expect(result.status).toBe("admitted");
    expect(result).toMatchObject({ slotKey: "slot-0" });
    expect(mockDb.$executeRaw).toHaveBeenCalledOnce();
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimKey: "gate:session-1:sha",
        status: "queued",
        activeKey: null,
        slotKey: null,
        queuedAt: NOW,
        heartbeatAt: NOW,
      }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        status: "active",
        slotKey: "slot-0",
        activeKey: "local-integration-ci:slot-0",
        admittedAt: NOW,
      }),
    });
    expect(recordQueueTransition.mock.calls.map(([event]) => event.transition))
      .toEqual(["enqueued"]);
    finishEnqueued?.();
    await vi.waitFor(() => {
      expect(recordQueueTransition.mock.calls.map(([event]) => event.transition))
        .toEqual(["enqueued", "started"]);
    });
  });

  it("returns the same queued row for an idempotent claim retry", async () => {
    const mockDb = db();
    const waiting = lease();
    const occupied = admitted({ id: "active-row", leaseId: "NPEL-ACTIVE" });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(waiting)
      .mockResolvedValueOnce(waiting);
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([occupied, waiting])
      .mockResolvedValueOnce([{ id: "row-1" }]);

    const result = await claim(mockDb);

    expect(result).toMatchObject({
      status: "queued",
      queuePosition: 1,
      lease: { leaseId: "NPEL-1" },
    });
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
  });

  it("subscribes a different owner to the same immutable claim without stealing or renewing it", async () => {
    const mockDb = db();
    const winner = admitted({
      ownerProvider: "claude",
      ownerSessionId: "winner-session",
      heartbeatAt: new Date(NOW.getTime() - 30_000),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(winner);

    const result = await claim(mockDb, { ownerSessionId: "subscriber-session" });

    expect(result).toMatchObject({
      status: "subscribed",
      lease: {
        leaseId: "NPEL-1",
        ownerSessionId: "winner-session",
      },
      executionStatus: "admitted",
    });
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.findMany).not.toHaveBeenCalled();
  });

  it("recovers a concurrent claimKey uniqueness conflict by observing the winner", async () => {
    const mockDb = db();
    const winner = admitted();
    const conflict = Object.assign(new Error("unique claimKey"), { code: "P2002" });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(winner);
    mockDb.nonProductionEnvironmentLease.create.mockRejectedValueOnce(conflict);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([winner]);

    const result = await claim(mockDb);

    expect(result).toMatchObject({
      status: "admitted",
      lease: { leaseId: "NPEL-1" },
    });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledOnce();
  });

  it("cancels a queued local-CI lease without promoting from stale pressure", async () => {
    const mockDb = db();
    const current = lease();
    const next = lease({
      id: "row-2",
      leaseId: "NPEL-2",
      claimKey: "gate:session-2:sha",
      ownerSessionId: "session-2",
      queuedAt: new Date(NOW.getTime() + 1),
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValueOnce(lease({
      status: "cancelled",
      cancelledAt: NOW,
      releasedAt: NOW,
    }));
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([next]);

    const released = await releaseNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      now: NOW,
    });

    expect(released.status).toBe("cancelled");
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenNthCalledWith(1, {
      where: { leaseId: "NPEL-1" },
      data: expect.objectContaining({
        status: "cancelled",
        cancelledAt: NOW,
        activeKey: null,
      }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledTimes(1);
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { leaseId: "NPEL-1" },
      data: expect.objectContaining({
        ownerPid: null,
        ownerProcessIdentity: null,
      }),
    });
  });

  it("refuses to let a subscriber release the canonical immutable gate lease", async () => {
    const mockDb = db();
    const winner = admitted({
      claimKey: `gate:${"a".repeat(64)}`,
      ownerSessionId: "winner-session",
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(winner);

    await expect(releaseNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "subscriber-session",
      now: NOW,
    })).rejects.toThrow(/owner/i);

    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("expires lapsed local-CI owners without promoting from stale pressure", async () => {
    const mockDb = db();
    const lapsed = admitted({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const waiting = lease({ id: "row-2", leaseId: "NPEL-2" });
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([{ id: "row-1", environmentKey: "local-integration-ci" }])
      .mockResolvedValueOnce([lapsed, waiting]);

    const result = await reapExpiredNonprodEnvironmentLeases({
      db: mockDb as never,
      now: NOW,
    });

    expect(result).toEqual({ reaped: 1 });
    expect(mockDb.nonProductionEnvironmentLease.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["row-1"] } },
      data: expect.objectContaining({
        status: "expired",
        activeKey: null,
        ownerPid: null,
        ownerProcessIdentity: null,
      }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("admits a slot-aware FIFO waiter to slot-1 only under a safe capacity-two policy", async () => {
    const mockDb = db();
    const slot0Owner = admitted({ id: "owner-0" });
    const waiting = lease({ slotManifestVersion: 1 });
    const slot1Owner = admitted({
      ...waiting,
      status: "active",
      slotKey: "slot-1",
      activeKey: "local-integration-ci:slot-1",
      slotManifestVersion: 1,
    });
    mockDb.platformConfig.findUnique.mockResolvedValue(configuredPool(2));
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(slot1Owner);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([
      slot0Owner,
      waiting,
    ]);

    const hostPressure = {
      observedAt: NOW.toISOString(),
      availableMemoryBytes: 8 * 1024 ** 3
        + 2 * localCiSlotResources.builderPolicy.memoryBytes,
      sustainedCpuPercent: 20,
      diskFreeBytes: 500 * 1024 ** 3,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    };
    const result = await claim(mockDb, {
      slotManifestVersion: 1,
      hostPressure,
      capacityBroker: async () => ({
        ...hostPressure,
        dockerAvailableMemoryBytes: 32 * 1024 ** 3,
        builderMemoryUsageBytes: [0, 0],
      }),
    });

    expect(result).toMatchObject({
      status: "admitted",
      slotKey: "slot-1",
      poolPolicy: { effectiveCapacity: 2, rollbackReason: null },
    });
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slotManifestVersion: 1 }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        slotKey: "slot-1",
        phase: "admitted-unbound",
      }),
    });
  });

  it("does not reserve an exact-gate builder envelope for a contributor preview", async () => {
    const gib = 1024 ** 3;
    const mockDb = db();
    const waiting = lease({
      purpose: "Contributor preview (:3001)",
      url: "http://localhost:3001",
      ports: [3001],
      slotManifestVersion: null,
    });
    const previewOwner = admitted({
      ...waiting,
      status: "active",
      slotKey: "slot-0",
      activeKey: "local-integration-ci:slot-0",
    });
    mockDb.platformConfig.findUnique.mockResolvedValue(configuredPool());
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(previewOwner);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([waiting]);

    const hostPressure = {
      observedAt: NOW.toISOString(),
      availableMemoryBytes: 24 * gib,
      sustainedCpuPercent: 20,
      diskFreeBytes: 500 * gib,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    };
    const result = await claim(mockDb, {
      purpose: "Contributor preview (:3001)",
      url: "http://localhost:3001",
      ports: [3001],
      hostPressure,
      capacityBroker: async () => ({
        ...hostPressure,
        availableMemoryBytes: 8 * gib,
        builderMemoryUsageBytes: [0, 0],
      }),
    });

    expect(result).toMatchObject({
      status: "admitted",
      slotKey: "slot-0",
      poolPolicy: { effectiveCapacity: 1, rollbackReason: "requested-singleton" },
    });
  });

  it("keeps a slot-aware claimant queued when policy or host evidence is absent", async () => {
    const mockDb = db();
    const waiting = lease({ slotManifestVersion: 1 });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(waiting);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([
      admitted({ id: "owner-0" }),
      waiting,
    ]).mockResolvedValueOnce([{ id: "row-1" }]);

    const result = await claim(mockDb, { slotManifestVersion: 1 });

    expect(result).toMatchObject({
      status: "queued",
      poolPolicy: {
        effectiveCapacity: 1,
        rollbackReason: "config-absent",
      },
    });
  });

  it("lets canonical server pressure contract a configured singleton to zero", async () => {
    const mockDb = db();
    const waiting = lease({ slotManifestVersion: 1 });
    mockDb.platformConfig.findUnique.mockResolvedValue(configuredPool());
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(waiting);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([admitted({ id: "owner-0" }), waiting])
      .mockResolvedValueOnce([{ id: "row-1" }]);

    const result = await claim(mockDb, {
      slotManifestVersion: 1,
      hostPressure: {
        observedAt: NOW.toISOString(),
        availableMemoryBytes: 12 * 1024 ** 3,
        sustainedCpuPercent: 20,
        diskFreeBytes: 500 * 1024 ** 3,
        dockerHealthy: true,
        convergenceActive: false,
        fencesHealthy: true,
        evidenceIsolationHealthy: true,
      },
      capacityBroker: async () => ({
        observedAt: NOW.toISOString(),
        availableMemoryBytes: 4 * 1024 ** 3,
        sustainedCpuPercent: 20,
        diskFreeBytes: 500 * 1024 ** 3,
        dockerHealthy: true,
        convergenceActive: false,
        fencesHealthy: true,
        evidenceIsolationHealthy: true,
      }),
    });

    expect(result).toMatchObject({
      status: "queued",
      poolPolicy: {
        effectiveCapacity: 0,
        rollbackReason: "host-build-headroom-low",
      },
    });
  });

  it("keeps a claimant queued when the next host-native stage would spend the continuation floor", async () => {
    const gib = 1024 ** 3;
    const mockDb = db();
    const waiting = lease({ slotManifestVersion: 1 });
    mockDb.platformConfig.findUnique.mockResolvedValue(configuredPool());
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(waiting);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([waiting])
      .mockResolvedValueOnce([{ id: "row-1" }]);

    const hostPressure = {
      observedAt: NOW.toISOString(),
      availableMemoryBytes: 8 * gib + localCiSlotResources.hostStagePolicy.admissionReserveBytes - 1, // one byte short of a stage above the floor (BI-E58B57EC)
      sustainedCpuPercent: 20,
      diskFreeBytes: 500 * gib,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    };
    const result = await claim(mockDb, {
      slotManifestVersion: 1,
      hostPressure,
      capacityBroker: async () => ({
        ...hostPressure,
        availableMemoryBytes: 40 * gib,
        dockerAvailableMemoryBytes: 40 * gib,
        builderMemoryUsageBytes: [0, 0],
      }),
    });

    expect(result).toMatchObject({
      status: "queued",
      queuePosition: 1,
      poolPolicy: {
        effectiveCapacity: 0,
        rollbackReason: "host-stage-headroom-low",
      },
    });
  });
});

describe("lease liveness windows", () => {
  it("rejects an invalid admitted-owner TTL instead of writing an unusable expiry", () => {
    expect(() => admittedLeaseTtlMs("local-integration-ci", Number.NaN))
      .toThrow("nonprod_lease_ttl_must_be_positive");
    expect(() => admittedLeaseTtlMs("local-integration-ci", 0))
      .toThrow("nonprod_lease_ttl_must_be_positive");
  });

  it("clamps requested holds to the maximum window", () => {
    const requested = new Date(NOW.getTime() + 8 * 60 * 60_000);
    expect(clampLeaseExpiry(NOW, requested).getTime())
      .toBe(NOW.getTime() + MAX_LEASE_TTL_MS);
  });

  it("grants a fresh TTL when a queued lease is admitted", async () => {
    const mockDb = db();
    const queued = lease({
      requestedTtlMs: 60_000,
      expiresAt: new Date(NOW.getTime() + 1),
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(admitted({ expiresAt: new Date(NOW.getTime() + 60_000) }));
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);

    await claim(mockDb, {
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    });
  });

  it("caps an admitted local-CI owner independently of its longer queue TTL", async () => {
    const mockDb = db();
    const queued = lease({
      requestedTtlMs: MAX_LEASE_TTL_MS,
      expiresAt: new Date(NOW.getTime() + MAX_LEASE_TTL_MS),
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(admitted({
        expiresAt: new Date(NOW.getTime() + LOCAL_CI_ACTIVE_LEASE_TTL_MS),
      }));
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);

    await claim(mockDb, {
      expiresAt: new Date(NOW.getTime() + MAX_LEASE_TTL_MS),
    });

    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedTtlMs: MAX_LEASE_TTL_MS,
        expiresAt: new Date(NOW.getTime() + MAX_LEASE_TTL_MS),
      }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        expiresAt: new Date(NOW.getTime() + LOCAL_CI_ACTIVE_LEASE_TTL_MS),
      }),
    });
  });

  it("renews only an active owned unexpired lease and stamps heartbeat", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(
      admitted({ expiresAt: new Date(NOW.getTime() + 60_000) }),
    );
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue(admitted());

    const result = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      now: NOW,
    });

    expect(result.status).toBe("renewed");
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { leaseId: "NPEL-1" },
      data: expect.objectContaining({
        expiresAt: new Date(NOW.getTime() + LOCAL_CI_ACTIVE_LEASE_TTL_MS),
        heartbeatAt: NOW,
        phase: "running",
      }),
    });
  });

  it("atomically binds the assigned slot manifest before a slot-aware runner mutates", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(
      admitted({
        slotKey: "slot-1",
        activeKey: "local-integration-ci:slot-1",
        slotManifestVersion: 1,
        phase: "admitted-unbound",
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue(admitted({
      slotKey: "slot-1",
      slotManifestVersion: 1,
      phase: "running",
    }));
    const slotBinding = {
      manifestVersion: 1 as const,
      slotKey: "slot-1" as const,
      url: "http://localhost:3011",
      ports: [3011, 15433],
      cleanupCommand: "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-1",
    };

    const result = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      slotBinding,
      now: NOW,
    });

    expect(result.status).toBe("renewed");
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { leaseId: "NPEL-1" },
      data: expect.objectContaining({
        url: slotBinding.url,
        ports: slotBinding.ports,
        cleanupCommand: slotBinding.cleanupCommand,
        phase: "running",
      }),
    });
  });

  it("keeps the existing renewal window for non-local-CI environments", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(
      admitted({
        environmentKey: "active-candidate",
        activeKey: "active-candidate:slot-0",
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue(admitted());

    const result = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      now: NOW,
    });

    expect(result.status).toBe("renewed");
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { leaseId: "NPEL-1" },
      data: expect.objectContaining({
        expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
      }),
    });
  });

  it("does not revive an expired active lease", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(
      admitted({ expiresAt: new Date(NOW.getTime() - 1) }),
    );

    const result = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      now: NOW,
    });

    expect(result).toEqual({ status: "lost", reason: "expired" });
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });
});
