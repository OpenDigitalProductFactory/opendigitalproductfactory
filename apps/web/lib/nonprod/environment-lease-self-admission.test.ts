import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-B1CB7EC3 — a local-CI claim admits only itself, and only past waiters
// that cannot prove they are still attached to a process.

vi.mock("@/lib/queue/queue-telemetry", () => ({
  recordQueueTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/operate/metrics", () => ({
  gateRunDispositionsTotal: { inc: vi.fn() },
}));
vi.mock("./durable-wait", () => ({
  afterNonprodLeaseRelease: vi.fn().mockResolvedValue(undefined),
  publishNonprodCapacityForHead: vi.fn().mockResolvedValue({ notified: 0, headLeaseId: null }),
}));

import {
  claimNonprodEnvironmentLease,
  DEFAULT_LEASE_TTL_MS,
  LOCAL_CI_ACTIVE_LEASE_TTL_MS,
} from "./environment-lease";

const NOW = new Date("2026-09-02T18:26:07.000Z");

function lease(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-claimant",
    leaseId: "NPEL-CLAIMANT",
    claimKey: "gate:session-claimant:sha",
    environmentKey: "local-integration-ci",
    activeKey: null,
    slotKey: null,
    status: "queued",
    ownerProvider: "claude",
    ownerSessionId: "session-claimant",
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
    requestedTtlMs: LOCAL_CI_ACTIVE_LEASE_TTL_MS,
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
    platformConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    externalEvidenceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation(
    async (body: (tx: typeof database) => Promise<unknown>) => body(database),
  );
  return database;
}

function claim(mockDb: ReturnType<typeof db>) {
  return claimNonprodEnvironmentLease({
    db: mockDb as never,
    environmentKey: "local-integration-ci",
    ownerProvider: "claude",
    ownerSessionId: "session-claimant",
    claimKey: "gate:session-claimant:sha",
    purpose: "CI",
    url: "http://localhost:3010",
    ports: [3010],
    expiresAt: new Date(NOW.getTime() + LOCAL_CI_ACTIVE_LEASE_TTL_MS),
    now: NOW,
  });
}

/** The head that PR #4885's durable wait leaves behind: queued once, owner gone. */
function strandedHead(overrides: Record<string, unknown> = {}) {
  const queuedAt = new Date(NOW.getTime() - 26 * 60_000);
  return lease({
    id: "row-head",
    leaseId: "NPEL-HEAD",
    claimKey: "gate:session-head:sha",
    ownerSessionId: "session-head",
    queuedAt,
    heartbeatAt: queuedAt,
    ...overrides,
  });
}

describe("local-CI self-admission with proof of life", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not hand the free slot to a stranded head; the claimant takes it", async () => {
    const mockDb = db();
    const head = strandedHead();
    const claimant = lease();
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(claimant);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([head, claimant]);
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...claimant, status: "active", slotKey: "slot-0" });

    const result = await claim(mockDb);

    expect(result.status).toBe("admitted");
    const admittedIds = mockDb.nonProductionEnvironmentLease.update.mock.calls
      .filter(([call]) => call.data?.status === "active")
      .map(([call]) => call.where.id);
    expect(admittedIds).toEqual(["row-claimant"]);
  });

  it("keeps precedence for a head that beat within the admitted TTL, and does not admit it on the stranger's behalf", async () => {
    const mockDb = db();
    const head = strandedHead({ heartbeatAt: new Date(NOW.getTime() - 30_000) });
    const claimant = lease();
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(claimant);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([head, claimant])
      .mockResolvedValueOnce([{ id: "row-head" }, { id: "row-claimant" }]);
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(claimant);

    const result = await claim(mockDb);

    expect(result).toMatchObject({ status: "queued", queuePosition: 2 });
    const admittedIds = mockDb.nonProductionEnvironmentLease.update.mock.calls
      .filter(([call]) => call.data?.status === "active")
      .map(([call]) => call.where.id);
    expect(admittedIds).toEqual([]);
  });

  it("admits the head on its own claim once it is back", async () => {
    const mockDb = db();
    const head = strandedHead();
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({ ...head, status: "active", slotKey: "slot-0" });
    // The re-claim stamps heartbeatAt before reconciliation reads the queue.
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValueOnce({ ...head, heartbeatAt: NOW });
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([{ ...head, heartbeatAt: NOW }]);

    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "local-integration-ci",
      ownerProvider: "claude",
      ownerSessionId: "session-head",
      claimKey: "gate:session-head:sha",
      purpose: "CI",
      url: "http://localhost:3010",
      ports: [3010],
      expiresAt: new Date(NOW.getTime() + LOCAL_CI_ACTIVE_LEASE_TTL_MS),
      now: NOW,
    });

    expect(result).toMatchObject({ status: "admitted", slotKey: "slot-0" });
  });
});
