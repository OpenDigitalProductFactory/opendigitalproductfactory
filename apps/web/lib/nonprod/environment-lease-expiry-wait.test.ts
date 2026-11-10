import { describe, expect, it, vi } from "vitest";
import { applyNonprodCapacityEvent, checkpointNonprodLeaseWait, parseNonprodLeaseWait } from "./durable-wait";
import { claimNonprodEnvironmentLease, reapExpiredNonprodEnvironmentLeases } from "./environment-lease";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn() }));

const NOW = new Date("2026-10-13T23:00:00Z");

async function fixture() {
  const row: any = {
    id: "expired-row", leaseId: "NPEL-EXPIRED", claimKey: "old-claim",
    environmentKey: "local-integration-ci", status: "queued", activeKey: null,
    slotKey: null, admittedAt: null, releasedAt: null, taskRunId: null,
    ownerProvider: "codex", ownerSessionId: "old-session", ownerPid: null,
    ownerProcessIdentity: null, worktreePath: null, branchName: null,
    queuedAt: new Date(NOW.getTime() - 60_000), heartbeatAt: NOW,
    expiresAt: new Date(NOW.getTime() - 1), createdAt: NOW, phase: "waiting",
    requestedTtlMs: 60_000, slotManifestVersion: 1,
  };
  const rows = [row];
  let task: any = null;
  let insideTransaction = false;
  const matches = (entry: any, where: any = {}) =>
    (!where.id?.in || where.id.in.includes(entry.id))
    && (!where.environmentKey || entry.environmentKey === where.environmentKey)
    && (!where.status || (typeof where.status === "string"
      ? entry.status === where.status : where.status.in.includes(entry.status)))
    && (!where.expiresAt?.lt || entry.expiresAt < where.expiresAt.lt)
    && (where.releasedAt === undefined || entry.releasedAt?.getTime() === where.releasedAt?.getTime());
  const db: any = {
    $executeRaw: vi.fn(async () => 1),
    platformConfig: { findUnique: vi.fn(async () => null) },
    nonProductionEnvironmentLease: {
      findMany: vi.fn(async ({ where }: any) => rows.filter(entry => matches(entry, where))),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ where }: any) => rows.find(entry =>
        where.id ? entry.id === where.id : entry.claimKey === where.claimKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const created = { ...data, id: "new-row", createdAt: NOW, releasedAt: null,
          admittedAt: null, slotKey: null, ownerPid: null, ownerProcessIdentity: null };
        rows.push(created);
        return created;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const selected = rows.filter(entry => matches(entry, where));
        selected.forEach(entry => Object.assign(entry, data));
        return { count: selected.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const entry = rows.find(candidate => candidate.id === where.id)!;
        Object.assign(entry, data);
        return entry;
      }),
    },
    taskRun: {
      upsert: vi.fn(async ({ create }: any) => { task = create; return task; }),
      findUnique: vi.fn(async () => task),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: any) => {
        if (data.status === "completed") expect(insideTransaction).toBe(true);
        task = { ...task, ...data };
        return task;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (data.status === "completed") expect(insideTransaction).toBe(true);
        if (task.status !== where.status
          || JSON.stringify(task.progressPayload) !== JSON.stringify(where.progressPayload.equals)) return { count: 0 };
        task = { ...task, ...data };
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (body: any) => {
      insideTransaction = true;
      try { return await body(db); } finally { insideTransaction = false; }
    }),
  };
  const wait = await checkpointNonprodLeaseWait({ db, userId: "user-1", lease: row,
    queuePosition: 1, waitDeadlineAt: row.expiresAt, now: new Date(NOW.getTime() - 60_000) });
  row.taskRunId = wait.taskRunId;
  task.progressPayload.preserved = "original evidence";
  return { db, row, task: () => task };
}

function event(f: Awaited<ReturnType<typeof fixture>>) {
  return { eventId: "capacity-event", taskRunId: f.task().taskRunId,
    leaseId: f.row.leaseId, claimKey: f.row.claimKey, candidateKey: f.row.claimKey,
    environmentKey: f.row.environmentKey, ownerSessionId: f.row.ownerSessionId,
    occurredAt: NOW.toISOString() };
}

describe("automatic lease expiry settles the durable wait", () => {
  it("closes an expired never-admitted wait atomically without claiming execution", async () => {
    const f = await fixture();
    expect(await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW })).toEqual({ reaped: 1 });
    expect(f.row).toMatchObject({ status: "expired", admittedAt: null, slotKey: null });
    expect(f.task()).toMatchObject({ status: "completed", completedAt: NOW });
    expect(parseNonprodLeaseWait(f.task().progressPayload)).toMatchObject({
      state: "terminal", eventConsumed: true, queuePosition: null,
    });
    expect(f.task().progressPayload.preserved).toBe("original evidence");
    expect(f.task().progressPayload.summary).not.toMatch(/admitted|success|passed/i);
    const completed = f.task();
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: new Date(NOW.getTime() + 1000) });
    expect(f.task()).toBe(completed);
    expect(f.db.taskRun.updateMany).toHaveBeenCalledTimes(1);
  });

  it("also settles expiry encountered by another claim", async () => {
    const f = await fixture();
    await claimNonprodEnvironmentLease({ db: f.db, environmentKey: "local-integration-ci",
      ownerProvider: "codex", ownerSessionId: "new-session", claimKey: "new-claim",
      purpose: "test", url: "http://localhost:3010", ports: [3010],
      expiresAt: new Date(NOW.getTime() + 60_000), slotManifestVersion: 1, now: NOW });
    expect(f.task().status).toBe("completed");
    expect(parseNonprodLeaseWait(f.task().progressPayload)?.state).toBe("terminal");
    expect(f.row.admittedAt).toBeNull();
  });

  it("does not complete a task whose durable wait belongs to another lease", async () => {
    const f = await fixture();
    f.task().progressPayload.nonprodLeaseWait.leaseId = "NPEL-OTHER";
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
    expect(f.task().status).toBe("submitted");
    expect(f.db.taskRun.update).not.toHaveBeenCalled();
    expect(f.db.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a same-lease wait with different persisted ownership", async () => {
    const f = await fixture();
    f.task().progressPayload.nonprodLeaseWait.ownerSessionId = "another-session";
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
    expect(f.task().status).toBe("submitted");
    expect(f.db.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("preserves a concurrent task change when settlement loses its CAS", async () => {
    const f = await fixture();
    f.db.taskRun.updateMany.mockImplementation(async () => {
      f.task().status = "failed";
      f.task().progressPayload.concurrentFailure = "retained";
      return { count: 0 };
    });
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
    expect(f.task().status).toBe("failed");
    expect(f.task().progressPayload.concurrentFailure).toBe("retained");
    expect(f.db.taskRun.update).not.toHaveBeenCalled();
  });

  it("does not resurrect a terminal wait from a stale capacity-event read", async () => {
    const f = await fixture();
    f.db.taskRun.findUnique.mockImplementationOnce(async () => {
      const stale = structuredClone(f.task());
      await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
      return stale;
    });
    expect(await applyNonprodCapacityEvent({ db: f.db, event: event(f) })).toEqual({
      applied: false, reason: "not-waiting",
    });
    expect(f.task().status).toBe("completed");
    expect(parseNonprodLeaseWait(f.task().progressPayload)).toMatchObject({
      state: "terminal", eventConsumed: true,
    });
  });

  it("settles a wait when the capacity event commits before expiry", async () => {
    const f = await fixture();
    expect(await applyNonprodCapacityEvent({ db: f.db, event: event(f) })).toEqual({ applied: true });
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
    expect(f.task().status).toBe("completed");
    expect(parseNonprodLeaseWait(f.task().progressPayload)).toMatchObject({
      state: "terminal", eventConsumed: true,
    });
  });

  it("re-reads and settles when capacity commits between expiry read and CAS", async () => {
    const f = await fixture();
    f.db.taskRun.updateMany.mockImplementationOnce(async () => {
      expect(await applyNonprodCapacityEvent({ db: f.db, event: event(f) })).toEqual({ applied: true });
      f.task().progressPayload.midpointEvidence = "retained";
      return { count: 0 };
    });
    await reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW });
    expect(f.task().status).toBe("completed");
    expect(f.task().progressPayload.midpointEvidence).toBe("retained");
    expect(parseNonprodLeaseWait(f.task().progressPayload)).toMatchObject({
      state: "terminal", eventConsumed: true, eventId: "capacity-event",
    });
  });

  it("rejects persistent contention so the lease transaction can roll back", async () => {
    const f = await fixture();
    f.db.taskRun.updateMany.mockResolvedValue({ count: 0 });
    await expect(reapExpiredNonprodEnvironmentLeases({ db: f.db, now: NOW }))
      .rejects.toThrow("nonprod_expiry_wait_settlement_contended");
    expect(f.db.taskRun.updateMany).toHaveBeenCalledTimes(3);
    expect(f.task().status).toBe("submitted");
    expect(f.db.taskRun.update).not.toHaveBeenCalled();
  });
});
