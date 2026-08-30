import { describe, expect, it, vi } from "vitest";

import {
  applyNonprodCapacityEvent,
  capacityEventId,
  checkpointNonprodLeaseWait,
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
