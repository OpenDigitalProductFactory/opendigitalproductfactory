import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findOperation: vi.fn(),
}));
const queue = vi.hoisted(() => ({ send: vi.fn() }));
const notify = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    asyncInferenceOp: {
      findFirst: (...args: unknown[]) => db.findOperation(...args),
    },
    taskRun: {
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
      findMany: (...args: unknown[]) => db.findMany(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
    },
  },
}));
vi.mock("./mcp-task-notification-bus", () => ({
  mcpTaskNotificationBus: { publish: (...args: unknown[]) => notify.publish(...args) },
}));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({
  REMOTE_TASK_EXECUTION_EVENT: "mcp/task-run.execute",
  sendMcpTaskRunExecutionEvent: (...args: unknown[]) => queue.send(...args),
}));

import {
  enqueuePersistedRemoteTask,
  reconcilePersistedRemoteTaskDispatches,
} from "./mcp-task-background-dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  db.findMany.mockResolvedValue([]);
  db.findUnique.mockResolvedValue(null);
  db.findOperation.mockResolvedValue(null);
  queue.send.mockResolvedValue({ ids: ["event-1"] });
});

describe("external TaskRun durable dispatch", () => {
  it("persists the submitted outbox projection before sending its deterministic event", async () => {
    const result = await enqueuePersistedRemoteTask({
      taskRunId: "TR-1",
      now: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(db.update.mock.invocationCallOrder[0]).toBeLessThan(queue.send.mock.invocationCallOrder[0]!);
    expect(queue.send).toHaveBeenCalledWith("TR-1", "mcp-task-run:TR-1:execute:1");
    expect(result).toEqual({
      eventId: "mcp-task-run:TR-1:execute:1",
      queued: true,
    });
  });

  it("re-emits a stale submitted task with a new bounded attempt identity", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-1",
      taskRunId: "TR-1",
      status: "submitted",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: { trigger: "external-mcp" },
      progressPayload: {
        dispatch: {
          schemaVersion: 1,
          kind: "external-mcp-task",
          state: "enqueued",
          eventId: "mcp-task-run:TR-1:execute:1",
          attempt: 1,
          requestedAt: "2026-08-31T03:58:00.000Z",
        },
      },
    }]);

    const result = await reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(queue.send).toHaveBeenCalledWith("TR-1", "mcp-task-run:TR-1:execute:2");
    expect(result).toEqual({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });
  });

  it("re-emits stale durable submissions and admitting workers when the generic async flag is off", async () => {
    db.findMany.mockResolvedValue([{
      taskRunId: "TR-DURABLE",
      id: "task-row-durable",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 1, state: "enqueued" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
        },
      },
    }]);

    await reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    });

    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ status: "submitted" }),
          expect.objectContaining({
            status: { in: ["working", "quiescing"] },
            progressPayload: { path: ["durableInference", "state"], equals: "admitting" },
          }),
        ]),
      }),
    }));
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskRunId: "TR-DURABLE", status: "working" }),
    }));
    expect(queue.send).toHaveBeenCalledWith(
      "TR-DURABLE",
      "mcp-task-run:TR-DURABLE:execute:2",
    );
  });

  it("re-emits a quiesced durable admission after the scheduled gate clears", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-quiesced",
      taskRunId: "TR-QUIESCED",
      status: "quiescing",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 2, state: "enqueued" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
        },
      },
    }]);

    await reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    });

    expect(queue.send).toHaveBeenCalledWith(
      "TR-QUIESCED",
      "mcp-task-run:TR-QUIESCED:execute:3",
    );
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "quiescing" }),
    }));
  });

  it("does not treat an admitted durable row returned by a coarse scan as dispatch evidence", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-admitted",
      taskRunId: "TR-ADMITTED",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 1, state: "enqueued" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-1",
        },
      },
    }]);

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 0, exhausted: 0, raced: 1 });
    expect(queue.send).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it("does not falsely fail exhausted admission dispatch when its durable operation exists", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-with-operation",
      taskRunId: "TR-WITH-OPERATION",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 5, state: "failed" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
        },
      },
    }]);
    db.findOperation.mockResolvedValueOnce({ id: "async-op-1" });

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 0, exhausted: 0, raced: 1 });
    expect(db.findOperation).toHaveBeenCalledWith({
      where: { taskRunId: "task-row-with-operation", identityVersion: 1 },
      select: { id: true },
    });
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it("publishes the committed terminal state when bounded dispatch retries exhaust", async () => {
    const terminal = {
      taskRunId: "TR-EXHAUSTED",
      userId: "user-1",
      title: "Review",
      objective: "Review",
      status: "failed",
      progressPayload: null,
      createdAt: new Date("2026-08-31T03:00:00.000Z"),
      updatedAt: new Date("2026-08-31T04:00:00.000Z"),
      completedAt: new Date("2026-08-31T04:00:00.000Z"),
    };
    db.findMany.mockResolvedValue([{
      taskRunId: terminal.taskRunId,
      id: "task-row-exhausted",
      status: "submitted",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: { apiTokenId: "token-1", trigger: "external-mcp" },
      progressPayload: { dispatch: { attempt: 5, state: "failed" } },
    }]);
    db.findUnique.mockResolvedValue(terminal);

    const result = await reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, enqueued: 0, exhausted: 1, raced: 0 });
    expect(notify.publish).toHaveBeenCalledWith("token-1", terminal);
  });
});
