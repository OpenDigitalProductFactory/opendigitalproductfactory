import { describe, expect, it, vi } from "vitest";

import {
  applyNonprodCapacityEvent,
  afterNonprodLeaseRelease,
  capacityEventId,
  checkpointNonprodLeaseWait,
  checkpointImmediateNonprodLeaseAdmission,
  parseNonprodLeaseWait,
  publishNonprodCapacityForHead,
  settleNonprodLeaseWait,
} from "./durable-wait";

const NOW = new Date("2026-08-30T19:00:00.000Z");

function lease(overrides: Record<string, unknown> = {}) {
  return {
    id: "lease-row-1",
    leaseId: "NPEL-WAIT-1",
    claimKey: "gate:abc",
    environmentKey: "local-integration-ci",
    ownerProvider: "codex",
    ownerSessionId: "session-1",
    worktreePath: "D:/worktrees/fix-x",
    branchName: "fix/x",
    taskRunId: null,
    ...overrides,
  };
}

function db() {
  let task: any = null;
  return {
    taskRun: {
      upsert: vi.fn(async ({ create, update }: any) => {
        task = task ? { ...task, ...update } : { ...create, id: "task-row-1" };
        return task;
      }),
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: any) => {
        task = { ...task, ...data };
        return task;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!task || task.status !== where.status
          || JSON.stringify(task.progressPayload) !== JSON.stringify(where.progressPayload.equals)) return { count: 0 };
        task = { ...task, ...data };
        return { count: 1 };
      }),
      findMany: vi.fn(async () => task ? [task] : []),
    },
    nonProductionEnvironmentLease: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => lease({ taskRunId: (task as any)?.taskRunId ?? null })),
    },
    task: () => task,
  };
}

describe("durable nonproduction lease wait", () => {
  it("persists completed immediate provenance without changing the active lifetime", async () => {
    const mock = db();
    const taskRunId = await checkpointImmediateNonprodLeaseAdmission({
      db: mock, userId: "user-1", lease: lease(), now: NOW,
      waitDeadlineAt: new Date(NOW.getTime() + 600_000),
    });
    expect(mock.task()).toMatchObject({ taskRunId, userId: "user-1", status: "completed", completedAt: NOW });
    expect(parseNonprodLeaseWait(mock.task().progressPayload)).toMatchObject({
      state: "admitted", eventConsumed: true, eventId: null, queuePosition: null,
    });
    expect(mock.nonProductionEnvironmentLease.updateMany).toHaveBeenCalledWith({
      where: { id: "lease-row-1", status: "active", taskRunId: null }, data: { taskRunId },
    });
  });

  it("does not rewrite existing queued history or bind another user's task", async () => {
    const mock = db();
    await checkpointNonprodLeaseWait({ db: mock, userId: "user-1", lease: lease(),
      queuePosition: 2, waitDeadlineAt: new Date(NOW.getTime() + 600_000), now: NOW });
    const original = mock.task();
    mock.nonProductionEnvironmentLease.updateMany.mockClear();
    await expect(checkpointImmediateNonprodLeaseAdmission({ db: mock, userId: "user-2",
      lease: lease(), now: NOW, waitDeadlineAt: new Date(NOW.getTime() + 600_000) }))
      .rejects.toThrow("nonprod_immediate_admission_provenance_conflict");
    expect(mock.task()).toEqual(original);
    expect(mock.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the active null-link comparison no longer matches", async () => {
    const mock = db();
    mock.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 0 });
    await expect(checkpointImmediateNonprodLeaseAdmission({ db: mock, userId: "user-1",
      lease: lease(), now: NOW, waitDeadlineAt: new Date(NOW.getTime() + 600_000) }))
      .rejects.toThrow("nonprod_immediate_admission_link_conflict");
  });

  it.each(["expired", "cancelled", "queued", ""])('never infers admission from prior status "%s"', async (priorStatus) => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock, userId: "user-1", lease: lease(), queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"), now: NOW,
    });
    mock.nonProductionEnvironmentLease.findFirst.mockResolvedValue(null as never);
    await afterNonprodLeaseRelease({
      db: mock, lease: { ...lease(), taskRunId: wait.taskRunId, status: "expired" }, priorStatus, now: NOW,
    });
    expect(parseNonprodLeaseWait(mock.task()?.progressPayload)).toMatchObject({ state: "terminal", eventConsumed: true });
    expect(mock.task()?.progressPayload.summary).not.toMatch(/admitted|success/i);
  });

  it.each(["admitted", "terminal"] as const)("preserves already-settled %s history on release replay", async (state) => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock, userId: "user-1", lease: lease(), queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"), now: NOW,
    });
    await settleNonprodLeaseWait({ db: mock, taskRunId: wait.taskRunId, leaseId: "NPEL-WAIT-1", state, now: NOW });
    const settled = mock.task();
    mock.taskRun.update.mockClear();
    mock.nonProductionEnvironmentLease.findFirst.mockResolvedValue(null as never);
    await afterNonprodLeaseRelease({
      db: mock, lease: { ...lease(), taskRunId: wait.taskRunId, status: "expired" }, priorStatus: "expired",
      now: new Date(NOW.getTime() + 1_000),
    });
    expect(mock.taskRun.update).not.toHaveBeenCalled();
    expect(mock.task()).toBe(settled);
  });

  it("refuses settlement for a missing task or another lease's wait", async () => {
    const mock = db();
    expect(await settleNonprodLeaseWait({
      db: mock, taskRunId: "TR-MISSING", leaseId: "NPEL-OTHER", state: "terminal", now: NOW,
    })).toEqual({ settled: false });
    const wait = await checkpointNonprodLeaseWait({
      db: mock, userId: "user-1", lease: lease(), queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"), now: NOW,
    });
    expect(await settleNonprodLeaseWait({
      db: mock, taskRunId: wait.taskRunId, leaseId: "NPEL-OTHER", state: "terminal", now: NOW,
    })).toEqual({ settled: false });
    expect(mock.taskRun.update).not.toHaveBeenCalled();
  });

  it("checkpoints one deterministic suspended TaskRun and binds it to the lease", async () => {
    const mock = db();
    const first = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 2,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });
    const second = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });

    expect(second.taskRunId).toBe(first.taskRunId);
    expect(mock.taskRun.upsert).toHaveBeenCalledTimes(2);
    expect(mock.nonProductionEnvironmentLease.updateMany).toHaveBeenLastCalledWith({
      where: { id: "lease-row-1", status: "queued" },
      data: { taskRunId: first.taskRunId, expiresAt: new Date("2026-08-30T20:00:00.000Z") },
    });
    expect(parseNonprodLeaseWait(mock.task()?.progressPayload)).toMatchObject({
      state: "waiting",
      leaseId: "NPEL-WAIT-1",
      claimKey: "gate:abc",
      queuePosition: 1,
    });
  });

  it("applies a capacity event once and preserves exact wake authority", async () => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });
    const event = {
      eventId: capacityEventId("local-integration-ci", "NPEL-OLD", "NPEL-WAIT-1"),
      taskRunId: wait.taskRunId,
      leaseId: "NPEL-WAIT-1",
      claimKey: "gate:abc",
      environmentKey: "local-integration-ci",
      ownerSessionId: "session-1",
      candidateKey: "gate:abc",
      occurredAt: NOW.toISOString(),
    };

    expect(await applyNonprodCapacityEvent({ db: mock, event })).toEqual({ applied: true });
    expect(await applyNonprodCapacityEvent({ db: mock, event })).toEqual({ applied: false, reason: "duplicate" });
    expect(parseNonprodLeaseWait(mock.task()?.progressPayload)).toMatchObject({
      state: "capacity-available",
      eventId: event.eventId,
      eventConsumed: false,
    });
  });

  it("publishes one idempotent wake for only the FIFO head", async () => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });
    const emit = vi.fn(async () => undefined);

    const result = await publishNonprodCapacityForHead({
      db: mock,
      environmentKey: "local-integration-ci",
      causeLeaseId: "NPEL-OLD",
      now: NOW,
      emit,
    });

    expect(mock.nonProductionEnvironmentLease.findFirst).toHaveBeenCalledWith({
      where: { environmentKey: "local-integration-ci", status: "queued" },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    });
    expect(result).toEqual({ notified: 1, headLeaseId: "NPEL-WAIT-1" });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: wait.taskRunId,
      eventId: "nonprod-capacity:local-integration-ci:NPEL-OLD:NPEL-WAIT-1",
    }));
  });

  // BI-D35B85BF. The waker notified ONLY the single oldest queued row and never
  // asked whether anything was still behind it. On 2026-09-10 that aimed every
  // 5-minute tick at one abandoned row for over half an hour while six live
  // waiters got nothing, and the queue starved with slots standing empty.
  describe("waking past an abandoned head", () => {
    function queueDb(rows: Array<Record<string, unknown>>) {
      const task = {
        taskRunId: "TR-NONPROD-1",
        status: "submitted",
        progressPayload: {
          nonprodLeaseWait: {
            schemaVersion: 1,
            kind: "nonprod-lease-wait",
            state: "waiting",
            leaseId: rows[0]?.leaseId,
            claimKey: "gate:abc",
            environmentKey: "local-integration-ci",
            ownerProvider: "codex",
            ownerSessionId: "session-1",
            worktreePath: "D:/worktrees/fix-x",
            branchName: "fix/x",
            queuePosition: 1,
            waitDeadlineAt: "2026-08-30T20:00:00.000Z",
            lastTransitionAt: NOW.toISOString(),
            eventId: null,
            eventConsumed: false,
          },
        },
      };
      return {
        taskRun: {
          findUnique: vi.fn(async () => null),
          findMany: vi.fn(async () => [task]),
          update: vi.fn(async () => task),
          upsert: vi.fn(async () => task),
        },
        nonProductionEnvironmentLease: {
          updateMany: vi.fn(async () => ({ count: 1 })),
          findMany: vi.fn(async () => rows),
        },
      } as any;
    }

    const stale = {
      ...lease({ leaseId: "NPEL-ABANDONED", taskRunId: "TR-NONPROD-1" }),
      queuedAt: new Date(NOW.getTime() - 60 * 60_000),
      heartbeatAt: new Date(NOW.getTime() - 55 * 60_000),
    };
    const live = {
      ...lease({ leaseId: "NPEL-LIVE", taskRunId: "TR-NONPROD-1" }),
      queuedAt: new Date(NOW.getTime() - 20 * 60_000),
      heartbeatAt: new Date(NOW.getTime() - 15_000),
    };

    it("skips a head with nothing behind it and wakes the first live waiter", async () => {
      const mock = queueDb([stale, live]);
      const result = await publishNonprodCapacityForHead({
        db: mock,
        environmentKey: "local-integration-ci",
        causeLeaseId: "NPEL-OLD",
        now: NOW,
        emit: vi.fn(async () => undefined),
      });
      expect(result.headLeaseId).toBe("NPEL-LIVE");
    });

    it("keeps the abandoned row's queue position rather than expiring it here", async () => {
      const mock = queueDb([stale, live]);
      await publishNonprodCapacityForHead({
        db: mock,
        environmentKey: "local-integration-ci",
        causeLeaseId: "NPEL-OLD",
        now: NOW,
        emit: vi.fn(async () => undefined),
      });
      // Expiry belongs to the admission pass, not the waker. Reaping here would
      // put a second home under one rule.
      expect(mock.nonProductionEnvironmentLease.updateMany).not.toHaveBeenCalled();
    });

    it("falls back to the literal head when nothing proves live, rather than waking nobody", async () => {
      const mock = queueDb([stale]);
      const result = await publishNonprodCapacityForHead({
        db: mock,
        environmentKey: "local-integration-ci",
        causeLeaseId: "NPEL-OLD",
        now: NOW,
        emit: vi.fn(async () => undefined),
      });
      expect(result.headLeaseId).toBe("NPEL-ABANDONED");
    });

    it("treats a waiter with no beat recorded at all as wakeable", async () => {
      const noSignal = { ...lease({ leaseId: "NPEL-NO-SIGNAL", taskRunId: "TR-NONPROD-1" }) };
      const mock = queueDb([noSignal, live]);
      const result = await publishNonprodCapacityForHead({
        db: mock,
        environmentKey: "local-integration-ci",
        causeLeaseId: "NPEL-OLD",
        now: NOW,
        emit: vi.fn(async () => undefined),
      });
      expect(result.headLeaseId).toBe("NPEL-NO-SIGNAL");
    });
  });

  it("fails closed when a wake does not match the persisted lease, claim, owner, or environment", async () => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });
    const result = await applyNonprodCapacityEvent({
      db: mock,
      event: {
        eventId: "nonprod-capacity:bad",
        taskRunId: wait.taskRunId,
        leaseId: "NPEL-OTHER",
        claimKey: "gate:abc",
        environmentKey: "local-integration-ci",
        ownerSessionId: "session-1",
        candidateKey: "gate:abc",
        occurredAt: NOW.toISOString(),
      },
    });
    expect(result).toEqual({ applied: false, reason: "binding-mismatch" });
    expect(mock.taskRun.update).not.toHaveBeenCalled();
  });

  it("settles the same TaskRun after a fresh claim admits and never creates a sibling", async () => {
    const mock = db();
    const wait = await checkpointNonprodLeaseWait({
      db: mock,
      userId: "user-1",
      lease: lease(),
      queuePosition: 1,
      waitDeadlineAt: new Date("2026-08-30T20:00:00.000Z"),
      now: NOW,
    });

    await settleNonprodLeaseWait({
      db: mock,
      taskRunId: wait.taskRunId,
      leaseId: "NPEL-WAIT-1",
      state: "admitted",
      now: NOW,
    });

    expect(mock.taskRun.upsert).toHaveBeenCalledTimes(1);
    expect(mock.taskRun.update).toHaveBeenCalledOnce();
    expect(mock.task()).toMatchObject({ status: "completed", completedAt: NOW });
    expect(parseNonprodLeaseWait(mock.task()?.progressPayload)).toMatchObject({ state: "admitted" });
  });
});


describe("preview ownership through durable queue transitions", () => {
  it("preserves original authenticated ownership across queued checkpoint and terminal settlement", async () => {
    const mock = db();
    const preview = lease({ environmentKey: "active-candidate" });
    const first = await checkpointNonprodLeaseWait({ db: mock, lease: preview, userId: "user-1",
      queuePosition: 2, waitDeadlineAt: new Date(NOW.getTime() + 600_000), now: NOW });
    const owner = { schemaVersion: 1, userId: "user-1", agentId: "AGT-EXT-CODEX", binding: { leaseId: preview.leaseId } };
    await mock.taskRun.update({ data: { progressPayload: { ...mock.task().progressPayload, nonprodPreviewOwner: owner } } });
    await checkpointNonprodLeaseWait({ db: mock, lease: { ...preview, taskRunId: first.taskRunId }, userId: "user-1",
      queuePosition: 1, waitDeadlineAt: new Date(NOW.getTime() + 600_000), now: NOW });
    expect(mock.task().progressPayload.nonprodPreviewOwner).toEqual(owner);
    await settleNonprodLeaseWait({ db: mock, taskRunId: first.taskRunId, leaseId: preview.leaseId, state: "terminal", now: NOW });
    expect(mock.task().progressPayload.nonprodPreviewOwner).toEqual(owner);
    await expect(checkpointNonprodLeaseWait({ db: mock, lease: { ...preview, taskRunId: first.taskRunId }, userId: "foreign",
      queuePosition: 1, waitDeadlineAt: new Date(NOW.getTime() + 600_000), now: NOW })).rejects.toThrow("nonprod_preview_ownership_conflict");
    expect(mock.task().progressPayload.nonprodPreviewOwner).toEqual(owner);
  });
});
