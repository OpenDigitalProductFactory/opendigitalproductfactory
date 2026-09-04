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

const NOW = new Date("2026-07-28T21:00:00.000Z");
beforeEach(() => {
  vi.clearAllMocks();
});
function lease(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    leaseId: "NPEL-1",
    claimKey: "gate:session-1:sha",
    environmentKey: "local-integration-ci",
    activeKey: null,
    slotKey: null,
    status: "queued",
    ownerProvider: "codex",
    ownerSessionId: "session-1",
    purpose: "CI",
    worktreePath: null,
    branchName: null,
    buildId: null,
    taskRunId: null,
    slotManifestVersion: null,
    url: "http://localhost:3010",
    ports: [3010],
    cleanupCommand: null,
    resourceClass: null,
    expectedMemoryBytes: null,
    ownerPid: null,
    ownerProcessIdentity: null,
    evidenceRecordId: null,
    requestedTtlMs: DEFAULT_LEASE_TTL_MS,
    expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
    releasedAt: null,
    queuedAt: NOW,
    admittedAt: null,
    cancelledAt: null,
    heartbeatAt: NOW,
    phase: "waiting",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function db() {
  const database = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    nonProductionEnvironmentLease: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(lease()),
      update: vi.fn().mockResolvedValue(lease()),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    platformConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    externalEvidenceRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation(
    async (body: (tx: typeof database) => Promise<unknown>) => body(database),
  );
  return database;
}

function admitted(overrides: Record<string, unknown> = {}) {
  return lease({
    status: "active",
    slotKey: "slot-0",
    activeKey: "local-integration-ci:slot-0",
    admittedAt: NOW,
    phase: "admitted",
    ...overrides,
  });
}

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
