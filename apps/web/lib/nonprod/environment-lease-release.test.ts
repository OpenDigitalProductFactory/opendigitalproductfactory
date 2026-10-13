import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkpointNonprodLeaseWait, parseNonprodLeaseWait } from "./durable-wait";
import { releaseNonprodEnvironmentLease, DEFAULT_LEASE_TTL_MS } from "./environment-lease";
const recordQueueTransition = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

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

describe("release settles the existing durable wait", () => {
  it.each([
    ["expired", "expired", "terminal"],
    ["cancelled", "cancelled", "terminal"],
    ["released", "released", "admitted"],
    ["queued", "cancelled", "terminal"],
    ["active", "released", "admitted"],
  ])("projects %s as %s with wait state %s", async (status, releasedStatus, waitState) => {
    const mockDb = db();
    let task: Record<string, any> | null = null;
    const taskRun = {
      upsert: vi.fn(async ({ create }: any) => { task = create; return task; }),
      findUnique: vi.fn(async () => task),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: any) => { task = { ...task, ...data }; return task; }),
    };
    const database = { ...mockDb, taskRun };
    const wait = await checkpointNonprodLeaseWait({
      db: database as never,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
      now: NOW,
    });
    // Reproduce a wake delivered before the lease expired: capacity is not admission.
    await taskRun.update({ data: { progressPayload: {
      nonprodLeaseWait: { ...wait.wait, state: "capacity-available", eventConsumed: false },
    } } });
    taskRun.update.mockClear();
    const current = lease({ status, taskRunId: wait.taskRunId });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(current);
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue({ ...current, status: releasedStatus });
    mockDb.nonProductionEnvironmentLease.updateMany.mockClear();

    const result = await releaseNonprodEnvironmentLease({
      db: database as never, leaseId: current.leaseId, ownerSessionId: "session-1", now: NOW,
    });

    expect(result).toMatchObject({ leaseId: current.leaseId, taskRunId: wait.taskRunId, status: releasedStatus });
    expect(taskRun.upsert).toHaveBeenCalledTimes(1); // Only the original checkpoint.
    expect(taskRun.update).toHaveBeenCalledExactlyOnceWith({
      where: { taskRunId: wait.taskRunId },
      data: {
        status: "completed", completedAt: NOW,
        progressPayload: expect.objectContaining({
          nonprodLeaseWait: expect.objectContaining({ state: waitState, eventConsumed: true, queuePosition: null }),
        }),
      },
    });
    expect(parseNonprodLeaseWait(taskRun.update.mock.calls[0][0].data.progressPayload)).toMatchObject({
      leaseId: current.leaseId, claimKey: current.claimKey, ownerSessionId: "session-1", state: waitState,
    });
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
    expect(mockDb.externalEvidenceRecord.findUnique).not.toHaveBeenCalled();
    if (["expired", "cancelled", "released"].includes(status)) {
      expect(result).toBe(current);
      expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
      expect(mockDb.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
      expect(recordQueueTransition).not.toHaveBeenCalled();
    }
  });
});

describe("terminal release authority", () => {
  it.each(["active", "expired", "cancelled", "released"])("refuses subscriber release of a %s immutable gate lease", async (status) => {
    const mockDb = db();
    const winner = lease({
      status,
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

});
