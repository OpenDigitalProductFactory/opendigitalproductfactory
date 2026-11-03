import { bindFreshLeaseProvenance } from "./environment-lease-provenance";
import { leaseCleanupConsequenceForCall } from "./lease-cleanup-consequence";
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


describe("authenticated preview execution fence", () => {
  it.each(["active", "queued", "released"])("refuses a %s preview when trusted owner proof is absent under the lock", async (status) => {
    const mockDb = db();
    const current = lease({ environmentKey: "active-candidate", status, claimKey: "preview:session-1" });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(current);
    await expect(releaseNonprodEnvironmentLease({ db: mockDb as never,
      leaseId: current.leaseId, ownerSessionId: "session-1", authenticatedUserId: "user-1",
      authenticatedAgentId: "AGT-EXT-CODEX", now: NOW } as never)).rejects.toThrow(/(?:preview|cleanup).*ownership/i);
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });
});


async function ownedPreview(status: "active" | "queued" = "active", environmentKey = "active-candidate") {
  const mockDb = db();
  let current: any = lease({ environmentKey, claimKey: "preview:owned", status,
    slotManifestVersion: environmentKey === "local-integration-ci" ? 1 : null,
    worktreePath: environmentKey === "local-integration-ci" ? "D:/worktrees/existing-ci" : null,
    branchName: environmentKey === "local-integration-ci" ? "fix/existing-ci" : null,
    slotKey: status === "active" ? "slot-0" : null,
    activeKey: status === "active" ? `${environmentKey}:slot-0` : null });
  let task: any = null;
  const taskRun = {
    upsert: vi.fn(async ({ create, update }: any) => (task = task ? { ...task, ...update } : create)),
    findUnique: vi.fn(async () => task), findMany: vi.fn(async () => []),
    update: vi.fn(async ({ data }: any) => (task = { ...task, ...data })),
  };
  Object.assign(mockDb, { taskRun });
  mockDb.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 1 });
  current = await bindFreshLeaseProvenance({ db: mockDb as never, lease: current, created: true,
    authenticatedUserId: "user-1", authenticatedAgentId: "AGT-EXT-CODEX", now: NOW,
    waitDeadlineAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS), queuePosition: 1 });
  mockDb.nonProductionEnvironmentLease.findUnique.mockImplementation(async () => current);
  mockDb.nonProductionEnvironmentLease.update.mockImplementation(async ({ data }: any) => (current = { ...current, ...data }));
  const stance = { environmentClass: "development", primaryPurpose: "evolve-dpf" };
  const loadStance = async () => stance;
  const call = { toolName: "release_nonprod_environment_lease", userId: "user-1",
    context: { agentId: "AGT-EXT-CODEX" }, params: { leaseId: current.leaseId, ownerSessionId: "session-1" } };
  const input = { db: mockDb as never, leaseId: current.leaseId, ownerSessionId: "session-1",
    authenticatedUserId: "user-1", authenticatedAgentId: "AGT-EXT-CODEX", loadStance, now: NOW };
  return { mockDb, taskRun, stance, call, input, loadStance, task: () => task,
    changeLease: (delta: Record<string, unknown>) => { current = { ...current, ...delta }; },
    changeTask: (delta: Record<string, unknown>) => { task = { ...task, ...delta }; } };
}

describe("shared preview consent and locked release proof", () => {
  it.each(["active", "queued"] as const)("closes its real freshly bound %s reservation idempotently", async (status) => {
    const f = await ownedPreview(status);
    expect(await leaseCleanupConsequenceForCall(f.call, { db: f.mockDb as never, loadStance: f.loadStance }))
      .toMatchObject({ consequence: null });
    const result = await releaseNonprodEnvironmentLease(f.input);
    expect(result.status).toBe(status === "active" ? "released" : "cancelled");
    const owner = f.task().progressPayload.nonprodPreviewOwner;
    const repeated = await releaseNonprodEnvironmentLease(f.input);
    expect(repeated).toBe(result);
    expect(f.mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledTimes(1);
    expect(f.task().progressPayload.nonprodPreviewOwner).toEqual(owner);
    expect(f.taskRun.upsert).toHaveBeenCalledTimes(1);
  });

  const races: [string, (f: Awaited<ReturnType<typeof ownedPreview>>) => void][] = [
    ["process attached", f => f.changeLease({ ownerPid: 1234 })],
    ["process identity attached", f => f.changeLease({ ownerProcessIdentity: "started" })],
    ["cleanup command attached", f => f.changeLease({ cleanupCommand: "cleanup" })],
    ["host resource attached", f => f.changeLease({ resourceClass: "heavy" })],
    ["memory reservation attached", f => f.changeLease({ expectedMemoryBytes: 1024 })],
    ["session reassigned", f => f.changeLease({ ownerSessionId: "other-session" })],
    ["provider reassigned", f => f.changeLease({ ownerProvider: "claude" })],
    ["claim changed", f => f.changeLease({ claimKey: "other-claim" })],
    ["URL changed", f => f.changeLease({ url: "http://localhost:9999" })],
    ["ports changed", f => f.changeLease({ ports: [9999] })],
    ["worktree changed", f => f.changeLease({ worktreePath: "D:/other" })],
    ["branch changed", f => f.changeLease({ branchName: "fix/other" })],
    ["build changed", f => f.changeLease({ buildId: "other" })],
    ["Task link erased", f => f.changeLease({ taskRunId: null })],
    ["unknown status", f => f.changeLease({ status: "unknown" })],
    ["active slot changed", f => f.changeLease({ slotKey: "slot-1" })],
    ["environment changed", f => f.changeLease({ environmentKey: "local-integration-ci" })],
    ["original user changed", f => f.changeTask({ userId: "other-user" })],
    ["original assistant changed", f => f.changeTask({ initiatingAgentId: "AGT-EXT-CLAUDE" })],
    ["metadata erased", f => f.changeTask({ progressPayload: {} })],
    ["production stance", f => { f.stance.environmentClass = "production"; }],
    ["unknown stance", f => { f.stance.environmentClass = "unknown"; }],
    ["different purpose", f => { f.stance.primaryPurpose = "operate-business"; }],
  ];
  it.each(races)("refuses after ordinary classification when %s under the lock", async (_, mutate) => {
    const f = await ownedPreview();
    expect(await leaseCleanupConsequenceForCall(f.call, { db: f.mockDb as never, loadStance: f.loadStance }))
      .toMatchObject({ consequence: null });
    f.mockDb.$executeRaw.mockImplementation(async () => { mutate(f); return 1; });
    await expect(releaseNonprodEnvironmentLease(f.input)).rejects.toThrow(/(?:preview|cleanup).*ownership/i);
    expect(f.mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("refuses a preview retargeted before execution's initial read", async () => {
    const f = await ownedPreview();
    expect(await leaseCleanupConsequenceForCall(f.call, { db: f.mockDb as never, loadStance: f.loadStance }))
      .toMatchObject({ consequence: null });
    f.changeLease({ environmentKey: "local-integration-ci", status: "released", activeKey: null });
    await expect(releaseNonprodEnvironmentLease(f.input)).rejects.toThrow(/ownership/i);
    expect(f.mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("retains ordinary local-CI release using its existing authenticated user/wait proof", async () => {
    const f = await ownedPreview("active", "local-integration-ci");
    f.changeLease({ cleanupCommand: "existing-bound-ci-cleanup" });
    expect(await leaseCleanupConsequenceForCall(f.call, { db: f.mockDb as never, loadStance: f.loadStance }))
      .toMatchObject({ consequence: null, reason: "owned-development-lease-cleanup" });
    expect((await releaseNonprodEnvironmentLease(f.input)).status).toBe("released");
  });
  it("also refuses ordinary local-CI execution after its shared wait proof disappears", async () => {
    const f = await ownedPreview("active", "local-integration-ci");
    expect(await leaseCleanupConsequenceForCall(f.call, { db: f.mockDb as never, loadStance: f.loadStance }))
      .toMatchObject({ consequence: null });
    f.changeTask({ progressPayload: {} });
    await expect(releaseNonprodEnvironmentLease(f.input)).rejects.toThrow(/ownership/i);
    expect(f.mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it.each(["user", "assistant"])("refuses a foreign authenticated %s at execution", async (identity) => {
    const f = await ownedPreview();
    const input = { ...f.input, ...(identity === "user" ? { authenticatedUserId: "foreign" }
      : { authenticatedAgentId: "AGT-EXT-CLAUDE" }) };
    await expect(releaseNonprodEnvironmentLease(input)).rejects.toThrow(/(?:preview|cleanup).*ownership/i);
    expect(f.mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("retains the executor's separately approved legacy release path", async () => {
    const f = await ownedPreview();
    f.changeTask({ progressPayload: {} });
    expect((await releaseNonprodEnvironmentLease({ ...f.input,
      approvedAuthorityEnvelopeId: "server-approved-envelope" })).status).toBe("released");
  });
});
