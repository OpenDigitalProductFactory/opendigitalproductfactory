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
