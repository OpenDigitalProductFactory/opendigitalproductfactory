import { bindFreshLeaseProvenance, checkpointQueuedLeaseProvenance } from "./environment-lease-provenance";
import { beforeEach, describe, expect, it, vi } from "vitest";
const recordQueueTransition = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));
import { claimNonprodEnvironmentLease, DEFAULT_LEASE_TTL_MS } from "./environment-lease";
import { NOW, lease, db, admitted } from "./__tests__/environment-lease-fixtures";
import { leaseCleanupConsequenceForCall } from "./lease-cleanup-consequence";
beforeEach(() => { vi.clearAllMocks(); });

async function claim(mockDb: ReturnType<typeof db>, overrides = {}) {
  return claimNonprodEnvironmentLease({
    db: mockDb as never, environmentKey: "local-integration-ci", ownerProvider: "codex",
    ownerSessionId: "session-1", claimKey: "gate:session-1:sha", purpose: "CI",
    url: "http://localhost:3010", ports: [3010],
    expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS), now: NOW, ...overrides,
  });
}

describe("authenticated immediate nonproduction admission", () => {
  it("binds fresh immediate versioned admission to its authenticated user inside the lease transaction", async () => {
    const mockDb = db();
    const taskRun = { upsert: vi.fn().mockImplementation(async ({ create }) => create) };
    const queued = lease({ slotManifestVersion: 1, worktreePath: "D:/worktrees/fix-x", branchName: "fix/x" });
    const active = admitted({ ...queued, status: "active", slotKey: "slot-0", activeKey: "local-integration-ci:slot-0",
      expiresAt: new Date(NOW.getTime() + 120_000) });
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

});


describe("fresh authenticated preview ownership", () => {
  it.each(["active", "queued"])("records trusted owner for a fresh %s preview inside admission", async (status) => {
    const mockDb = db();
    let task: any = null;
    const taskRun = {
      upsert: vi.fn(async ({ create, update }: any) => (task = task ? { ...task, ...update } : create)),
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: any) => (task = { ...task, ...data })),
    };
    Object.assign(mockDb, { taskRun });
    const queued = lease({ environmentKey: "active-candidate", claimKey: "preview:session-1",
      worktreePath: "D:/worktrees/fix-x", branchName: "fix/x" });
    const current = status === "active" ? admitted({ ...queued, status, slotKey: "slot-0",
      activeKey: "active-candidate:slot-0" }) : queued;
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(current);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValue([queued]);
    mockDb.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 1 });
    const result = await claim(mockDb, { environmentKey: "active-candidate",
      authenticatedUserId: "user-1", authenticatedAgentId: "AGT-EXT-CODEX" });
    expect(result.lease.taskRunId).toMatch(/^TR-NONPROD-/);
    if (status === "queued") expect(result).toMatchObject({ durableWaitTaskRunId: result.lease.taskRunId });
    expect(task).toMatchObject({ userId: "user-1", initiatingAgentId: "AGT-EXT-CODEX",
      progressPayload: { nonprodPreviewOwner: { schemaVersion: 1, userId: "user-1", agentId: "AGT-EXT-CODEX" } } });
    const read = { nonProductionEnvironmentLease: { findUnique: async () => result.lease },
      taskRun: { findUnique: async () => task } };
    const loadStance = async () => ({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    const call = { toolName: "release_nonprod_environment_lease", userId: "user-1",
      context: { agentId: "AGT-EXT-CODEX" },
      params: { leaseId: result.lease.leaseId, ownerSessionId: "session-1" } };
    expect(await leaseCleanupConsequenceForCall(call, { db: read, loadStance })).toMatchObject({ consequence: null });
    for (const changed of [ { ...call, userId: "foreign-user" },
      { ...call, context: { agentId: "AGT-EXT-CLAUDE" } }, { ...call, context: {} } ]) {
      expect(await leaseCleanupConsequenceForCall(changed, { db: read, loadStance })).toMatchObject({ consequence: "authority" });
    }
  });
});

describe("preview creation provenance is never a backfill", () => {
  it.each(["missing-user", "missing-assistant", "existing-task", "replay"])("does not invent ownership for %s", async kind => {
    const mockDb = db();
    const taskRun = { upsert: vi.fn() };
    Object.assign(mockDb, { taskRun });
    const current = admitted({ environmentKey: "active-candidate", activeKey: "active-candidate:slot-0",
      taskRunId: kind === "existing-task" ? "caller-supplied-task" : null });
    const result = await bindFreshLeaseProvenance({ db: mockDb as never, lease: current as never,
      created: kind !== "replay", authenticatedUserId: kind === "missing-user" ? undefined : "user-1",
      authenticatedAgentId: kind === "missing-assistant" ? undefined : "AGT-EXT-CODEX",
      waitDeadlineAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS), now: NOW });
    expect(result).toBe(current);
    expect(taskRun.upsert).not.toHaveBeenCalled();
  });
  it("rolls back admission on a conflicting stored original assistant", async () => {
    const mockDb = db();
    const taskRun = { upsert: vi.fn(async ({ create }: any) => ({ ...create, initiatingAgentId: "AGT-EXT-CLAUDE" })) };
    Object.assign(mockDb, { taskRun });
    const current = admitted({ environmentKey: "active-candidate", activeKey: "active-candidate:slot-0" });
    await expect(bindFreshLeaseProvenance({ db: mockDb as never, lease: current as never, created: true,
      authenticatedUserId: "user-1", authenticatedAgentId: "AGT-EXT-CODEX",
      waitDeadlineAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS), now: NOW }))
      .rejects.toThrow("nonprod_immediate_admission_provenance_conflict");
    expect(mockDb.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
  });
});

it("refreshes the owned preview wait under the admission transaction without transferring its original actor", async () => {
  const mockDb = db();
  let task: any = null;
  const taskRun = {
    upsert: vi.fn(async ({ create, update }: any) => (task = task ? { ...task, ...update } : create)),
    findUnique: vi.fn(async () => task), findMany: vi.fn(async () => []), update: vi.fn(),
  };
  Object.assign(mockDb, { taskRun });
  mockDb.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 1 });
  const input = { db: mockDb as never, lease: lease({ environmentKey: "active-candidate" }) as never,
    created: true, authenticatedUserId: "user-1", authenticatedAgentId: "AGT-EXT-CODEX", queuePosition: 2,
    waitDeadlineAt: new Date(NOW.getTime() + 60_000), now: NOW };
  const fresh = await checkpointQueuedLeaseProvenance(input);
  expect(fresh).toMatchObject({ durableWaitTaskRunId: fresh.lease.taskRunId });
  const originalOwner = task.progressPayload.nonprodPreviewOwner;
  const deadline = new Date(NOW.getTime() + 120_000);
  const renewed = await checkpointQueuedLeaseProvenance({ ...input, lease: fresh.lease,
    created: false, queuePosition: 1, waitDeadlineAt: deadline });
  expect(renewed.durableWaitTaskRunId).toBe(fresh.durableWaitTaskRunId);
  expect(task.progressPayload.nonprodPreviewOwner).toEqual(originalOwner);
  expect(task.progressPayload.nonprodLeaseWait.waitDeadlineAt).toBe(deadline.toISOString());
  expect(taskRun.upsert).toHaveBeenCalledTimes(2);
  await expect(checkpointQueuedLeaseProvenance({ ...input, lease: fresh.lease,
    created: false, authenticatedAgentId: "AGT-EXT-CLAUDE" })).rejects.toThrow("nonprod_preview_ownership_conflict");
  expect(taskRun.upsert).toHaveBeenCalledTimes(2);
});


describe("database birth clock on the actual fresh claim", () => {
  function fresh() {
    const mockDb = db(), queued = lease(), active = admitted();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(active);
    mockDb.nonProductionEnvironmentLease.create.mockResolvedValue(queued);
    mockDb.nonProductionEnvironmentLease.findMany.mockResolvedValueOnce([queued]);
    return mockDb;
  }
  it("uses the transaction clock instead of the caller clock for new row creation", async () => {
    const mockDb = fresh(), createdAt = new Date(NOW.getTime() - 500);
    const query = vi.fn().mockResolvedValue([{ createdAt }]);
    Object.assign(mockDb, { $queryRaw: query });
    await claim(mockDb);
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdAt }) }));
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("aborts creation when the real clock reader returns no valid timestamp", async () => {
    const mockDb = fresh();
    Object.assign(mockDb, { $queryRaw: vi.fn().mockResolvedValue([]) });
    await expect(claim(mockDb)).rejects.toThrow("nonprod_lease_birth_clock_unavailable");
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
  });
  it("does not regenerate birth facts when an existing claim is replayed", async () => {
    const mockDb = db(), query = vi.fn();
    Object.assign(mockDb, { $queryRaw: query });
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue(admitted());
    await claim(mockDb);
    expect(query).not.toHaveBeenCalled();
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
  });
});
