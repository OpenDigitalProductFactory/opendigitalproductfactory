import { beforeEach, describe, expect, it, vi } from "vitest";

const recordQueueTransition = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

import {
  claimNonprodEnvironmentLease,
  clampLeaseExpiry,
  listActiveNonprodEnvironmentLeases,
  listQueuedNonprodEnvironmentLeases,
  releaseNonprodEnvironmentLease,
  renewNonprodEnvironmentLease,
  reapExpiredNonprodEnvironmentLeases,
  MAX_LEASE_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
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
    url: "http://localhost:3010",
    ports: [3010],
    cleanupCommand: null,
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

  it("cancels a queued lease and promotes the next FIFO waiter", async () => {
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
    mockDb.nonProductionEnvironmentLease.update
      .mockResolvedValueOnce(lease({
        status: "cancelled",
        cancelledAt: NOW,
        releasedAt: NOW,
      }))
      .mockResolvedValueOnce(admitted({
        ...next,
        status: "active",
        slotKey: "slot-0",
        activeKey: "local-integration-ci:slot-0",
        admittedAt: NOW,
      }));
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([next]);

    const released = await releaseNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
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
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenNthCalledWith(2, {
      where: { id: "row-2" },
      data: expect.objectContaining({
        status: "active",
        slotKey: "slot-0",
      }),
    });
  });

  it("expires lapsed owners and promotes a live waiter", async () => {
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
      }),
    });
    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-2" },
      data: expect.objectContaining({ status: "active", slotKey: "slot-0" }),
    });
  });
});

describe("lease liveness windows", () => {
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
        expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
        heartbeatAt: NOW,
        phase: "running",
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
