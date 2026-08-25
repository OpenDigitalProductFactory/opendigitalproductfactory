import { beforeEach, describe, expect, it, vi } from "vitest";

const recordQueueTransition = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

import {
  claimNonprodEnvironmentLease,
  DEFAULT_LEASE_TTL_MS,
  releaseNonprodEnvironmentLease,
} from "./environment-lease";

const NOW = new Date("2026-07-28T21:00:00.000Z");
const GiB = 1024 ** 3;

beforeEach(() => vi.clearAllMocks());

function lease(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    leaseId: "NPEL-1",
    claimKey: "host-resource:s1:42",
    environmentKey: "host-heavy-resource",
    activeKey: null,
    slotKey: null,
    status: "queued",
    ownerProvider: "codex",
    ownerSessionId: "s1",
    purpose: "host-resource:vitest",
    worktreePath: null,
    branchName: null,
    buildId: null,
    taskRunId: null,
    slotManifestVersion: null,
    url: "host://localhost",
    ports: [],
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
    resourceClass: "vitest",
    expectedMemoryBytes: BigInt(8 * GiB),
    ownerPid: 42,
    ownerProcessIdentity: "win32:638917704000000000",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function active(overrides: Record<string, unknown> = {}) {
  return lease({
    status: "active",
    slotKey: "slot-0",
    activeKey: "host-heavy-resource:slot-0",
    admittedAt: NOW,
    phase: "admitted",
    ...overrides,
  });
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
    externalEvidenceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation(
    async (body: (tx: typeof database) => Promise<unknown>) => body(database),
  );
  return database;
}

describe("host resource durable admission", () => {
  it("admits a typed claim through the existing lease transaction", async () => {
    const mockDb = db();
    const queued = lease();
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(active());
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([queued]);

    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "host-heavy-resource",
      ownerProvider: "codex",
      ownerSessionId: "s1",
      claimKey: "host-resource:s1:42",
      purpose: "host-resource:vitest",
      url: "host://localhost",
      ports: [],
      expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
      resourceClass: "vitest",
      expectedMemoryBytes: 8 * GiB,
      ownerProcessId: 42,
      ownerProcessIdentity: "win32:638917704000000000",
      hostResource: {
        totalMemoryBytes: 64 * GiB,
        availableMemoryBytes: 30 * GiB,
        inferenceResident: true,
      },
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "admitted",
      slotKey: "slot-0",
      poolPolicy: { source: "host-resource-profile", effectiveCapacity: 1 },
    });
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        environmentKey: "host-heavy-resource",
        resourceClass: "vitest",
        expectedMemoryBytes: 8 * GiB,
        ownerPid: 42,
        ownerProcessIdentity: "win32:638917704000000000",
      }),
    });
  });

  it("releases without promoting a waiter from stale memory evidence", async () => {
    const mockDb = db();
    const current = active();
    const waiting = lease({
      id: "row-2",
      leaseId: "NPEL-2",
      claimKey: "host-resource:s2:43",
      resourceClass: "next-build",
      expectedMemoryBytes: BigInt(16 * GiB),
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValueOnce(lease({
      ...current,
      status: "released",
      activeKey: null,
      releasedAt: NOW,
    }));
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([waiting]);

    await releaseNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      now: NOW,
    });

    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledTimes(1);
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-2" } }),
    );
  });
});
