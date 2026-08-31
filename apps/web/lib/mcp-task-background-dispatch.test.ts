import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));
const queue = vi.hoisted(() => ({ send: vi.fn() }));
const notify = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
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
      taskRunId: "TR-1",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
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
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: { apiTokenId: "token-1" },
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
