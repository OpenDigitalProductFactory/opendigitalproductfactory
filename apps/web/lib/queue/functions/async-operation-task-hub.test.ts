import { beforeEach, describe, expect, it, vi } from "vitest";

const inngest = vi.hoisted(() => ({
  createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
}));

vi.mock("../inngest-client", () => ({
  inngest: { createFunction: (config: unknown, handler: unknown) => inngest.createFunction(config, handler) },
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  asyncOperationTaskHub,
  deliverAsyncOperationTransition,
} from "./async-operation-task-hub";

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    id: "transition-row-4",
    sequence: 4,
    status: "completed",
    occurredAt: new Date("2026-09-04T12:00:00.000Z"),
    operation: {
      id: "operation-row-1",
      identityVersion: 1,
      taskRunId: "task-run-row-1",
      workroomId: null,
      workroom: null,
      taskRun: {
        taskRunId: "TR-1",
        userId: "user-1",
        workrooms: [{
          id: "workroom-row-1",
          capsuleId: "WC-1",
          title: "Ship the task hub",
          archivedAt: null,
        }],
      },
    },
    ...overrides,
  };
}

function deps(row: unknown) {
  return {
    loadTransition: vi.fn().mockResolvedValue(row),
    recordActivity: vi.fn().mockResolvedValue(undefined),
    publishActivity: vi.fn().mockResolvedValue(true),
    resolveOperatorUserId: vi.fn().mockResolvedValue("operator-1"),
    notify: vi.fn().mockResolvedValue({ created: true }),
    now: vi.fn(() => new Date("2026-09-04T12:01:00.000Z")),
  };
}

describe("async-operation Task Hub delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers one retryable event-only consumer with per-operation concurrency", () => {
    expect(asyncOperationTaskHub).toMatchObject({
      config: {
        id: "inference/async-operation-task-hub",
        retries: 2,
        concurrency: [{ key: "event.data.operationId", limit: 1 }],
        triggers: [{ event: "inference/async-operation.transitioned" }],
      },
    });
  });

  it("uses the event only as a composite locator and projects the canonical terminal transition", async () => {
    const dependencies = deps(canonical());

    const result = await deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: 4,
      status: "running",
      checkpoint: { leaked: true },
      occurredAt: "1999-01-01T00:00:00.000Z",
    }, dependencies);

    expect(dependencies.loadTransition).toHaveBeenCalledWith({
      operationId: "operation-row-1",
      sequence: 4,
    });
    expect(dependencies.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^wca_async_/),
      workroomId: "workroom-row-1",
      kind: "status-changed",
      summary: "Async operation completed.",
      payload: { status: "completed", sequence: 4 },
    }));
    const activity = dependencies.recordActivity.mock.calls[0]?.[0];
    expect(dependencies.publishActivity).toHaveBeenCalledWith({
      workroomId: "workroom-row-1",
      activityId: activity.id,
    });
    expect(dependencies.notify).toHaveBeenCalledWith({
      capsuleId: "WC-1",
      title: "Ship the task hub",
      kind: "completed",
      sourceKey: "async:operation-row-1:4",
      body: "The durable async operation completed. Open the Workroom to review its result.",
      deepLink: "/build/work/WC-1#result",
      userId: "user-1",
    });
    expect(dependencies.resolveOperatorUserId).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: true, delivered: 1, notified: 1 });
  });

  it("fails closed when a TaskRun maps to more than one live Workroom", async () => {
    const row = canonical();
    row.operation.taskRun.workrooms.push({
      id: "workroom-row-2",
      capsuleId: "WC-2",
      title: "Ambiguous room",
      archivedAt: null,
    });
    const dependencies = deps(row);

    await expect(deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: 4,
    }, dependencies)).resolves.toEqual({
      matched: true,
      delivered: 0,
      notified: 0,
      reason: "ambiguous-task-run-workroom",
    });
    expect(dependencies.recordActivity).not.toHaveBeenCalled();
    expect(dependencies.publishActivity).not.toHaveBeenCalled();
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("wakes the row for canonical progress without creating attention", async () => {
    const dependencies = deps(canonical({ status: "running" }));

    await deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: 4,
      status: "completed",
    }, dependencies);

    expect(dependencies.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      summary: "Async operation is running.",
      payload: { status: "running", sequence: 4 },
    }));
    expect(dependencies.publishActivity).toHaveBeenCalledOnce();
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "failed"],
    ["expired", "expired"],
    ["start_indeterminate", "reconciliation-required"],
  ] as const)("maps canonical %s to %s attention and never event-supplied copy", async (status, kind) => {
    const dependencies = deps(canonical({ status }));

    await deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: 4,
      status: "completed",
      checkpoint: { body: "attacker copy" },
    }, dependencies);

    expect(dependencies.notify).toHaveBeenCalledWith(expect.objectContaining({
      kind,
      sourceKey: "async:operation-row-1:4",
      userId: "user-1",
    }));
    expect(JSON.stringify(dependencies.notify.mock.calls)).not.toContain("attacker copy");
  });

  it("does not create operator attention for a canonical cancellation", async () => {
    const dependencies = deps(canonical({ status: "cancelled" }));

    await deliverAsyncOperationTransition({ operationId: "operation-row-1", sequence: 4 }, dependencies);

    expect(dependencies.publishActivity).toHaveBeenCalledOnce();
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("keeps a stale canonical transition in the Workroom ledger without creating fresh attention", async () => {
    const dependencies = deps(canonical({
      occurredAt: new Date("2026-09-04T11:30:59.999Z"),
    }));

    await expect(deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: 4,
    }, dependencies)).resolves.toEqual({ matched: true, delivered: 1, notified: 0 });

    expect(dependencies.recordActivity).toHaveBeenCalledOnce();
    expect(dependencies.publishActivity).toHaveBeenCalledOnce();
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("includes a canonical terminal transition at the notification-window boundary", async () => {
    const dependencies = deps(canonical({
      occurredAt: new Date("2026-09-04T11:31:00.000Z"),
    }));

    await deliverAsyncOperationTransition({ operationId: "operation-row-1", sequence: 4 }, dependencies);

    expect(dependencies.notify).toHaveBeenCalledOnce();
  });

  it("rejects malformed locators before reading canonical state", async () => {
    const dependencies = deps(null);

    await expect(deliverAsyncOperationTransition({
      operationId: "operation-row-1",
      sequence: -1,
    }, dependencies)).rejects.toThrow("ASYNC_OPERATION_TRANSITION_SEQUENCE_INVALID");
    expect(dependencies.loadTransition).not.toHaveBeenCalled();
  });
});
