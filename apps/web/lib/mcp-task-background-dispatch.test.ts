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
const asyncRuntime = vi.hoisted(() => ({ cancel: vi.fn(), enqueue: vi.fn() }));
const recipeRuntime = vi.hoisted(() => ({ ensure: vi.fn() }));

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
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  requestPrismaAuthorizedAsyncOperationCancellation: (...args: unknown[]) =>
    asyncRuntime.cancel(...args),
  enqueuePrismaAsyncOperationWake: (...args: unknown[]) => asyncRuntime.enqueue(...args),
}));
vi.mock("./mcp-task-durable-inference-runtime", () => ({
  ensureDurableInferenceTaskRecipes: (...args: unknown[]) => recipeRuntime.ensure(...args),
}));

import {
  enqueuePersistedRemoteTask,
  reconcilePersistedRemoteTaskDispatches,
} from "./mcp-task-background-dispatch";
import { canonicalAsyncOperationBindingDigest } from "./inference/async-operation-contract";

beforeEach(() => {
  vi.clearAllMocks();
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  db.findMany.mockResolvedValue([]);
  db.findUnique.mockResolvedValue(null);
  db.findOperation.mockResolvedValue(null);
  queue.send.mockResolvedValue({ ids: ["event-1"] });
  asyncRuntime.cancel.mockResolvedValue({ operationId: "async-op-1" });
  asyncRuntime.enqueue.mockResolvedValue(undefined);
  recipeRuntime.ensure.mockResolvedValue({
    seeded: 0,
    validated: 1,
    recipeIds: ["closed-recipe-1"],
    recipes: [{ id: "closed-recipe-1", modelId: "gemini-3.1-pro-preview" }],
  });
});

describe("external TaskRun durable dispatch", () => {
  it("persists the submitted outbox projection before sending its deterministic event", async () => {
    const pending = {
      schemaVersion: 1,
      kind: "external-mcp-task",
      state: "pending",
      eventId: "mcp-task-run:TR-1:execute:1",
      attempt: 1,
      requestedAt: "2026-08-31T04:00:00.000Z",
    };
    db.findUnique
      .mockResolvedValueOnce({
        status: "working",
        updatedAt: new Date("2026-08-31T03:59:00.000Z"),
        progressPayload: null,
      })
      .mockResolvedValueOnce({
        status: "submitted",
        updatedAt: new Date("2026-08-31T04:00:00.001Z"),
        progressPayload: { dispatch: pending },
      });
    const result = await enqueuePersistedRemoteTask({
      taskRunId: "TR-1",
      now: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(db.updateMany.mock.invocationCallOrder[0]).toBeLessThan(queue.send.mock.invocationCallOrder[0]!);
    expect(queue.send).toHaveBeenCalledWith("TR-1", "mcp-task-run:TR-1:execute:1");
    expect(result).toEqual({
      eventId: "mcp-task-run:TR-1:execute:1",
      queued: true,
    });
  });

  it("does not resurrect a durable TaskRun canceled after atomic creation but before send", async () => {
    db.findUnique.mockResolvedValueOnce({
      status: "canceled",
      updatedAt: new Date("2026-08-31T04:00:00.001Z"),
      progressPayload: {
        dispatch: {
          state: "pending",
          eventId: "mcp-task-run:TR-CANCELED:execute:1",
          attempt: 1,
        },
        durableInference: { state: "cancelled-before-admission" },
      },
    });

    await expect(enqueuePersistedRemoteTask({
      taskRunId: "TR-CANCELED",
      now: new Date("2026-08-31T04:00:00.000Z"),
      projectionAlreadyPersisted: true,
    })).resolves.toEqual({
      eventId: "mcp-task-run:TR-CANCELED:execute:1",
      queued: false,
      error: "TaskRun dispatch reservation changed before send.",
    });
    expect(queue.send).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
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
    db.findUnique.mockResolvedValueOnce({
      status: "submitted",
      updatedAt: new Date("2026-08-31T04:00:00.001Z"),
      progressPayload: {
        dispatch: {
          state: "pending",
          eventId: "mcp-task-run:TR-1:execute:2",
          attempt: 2,
        },
      },
    });

    const result = await reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(queue.send).toHaveBeenCalledWith("TR-1", "mcp-task-run:TR-1:execute:2");
    expect(result).toEqual({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });
  });

  it("re-emits a valid provider resource wait when ordinary async reconciliation is off", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-resource-wait",
      taskRunId: "TR-RESOURCE-WAIT",
      userId: "user-1",
      status: "submitted",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: { trigger: "external-mcp" },
      progressPayload: {
        resourceWait: {
          schemaVersion: 1,
          kind: "provider-capacity",
          failureKind: "busy",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-31T03:58:00.000Z",
        },
      },
    }]);
    db.findUnique.mockResolvedValueOnce({
      status: "submitted",
      updatedAt: new Date("2026-08-31T04:00:00.001Z"),
      progressPayload: {
        resourceWait: {
          schemaVersion: 1,
          kind: "provider-capacity",
          failureKind: "busy",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-31T03:58:00.000Z",
        },
        dispatch: {
          state: "pending",
          eventId: "mcp-task-run:TR-RESOURCE-WAIT:execute:1",
          attempt: 1,
        },
      },
    });

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });

    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({
            status: "submitted",
            progressPayload: {
              path: ["resourceWait", "kind"],
              equals: "provider-capacity",
            },
          }),
        ]),
      }),
    }));
    expect(queue.send).toHaveBeenCalledWith(
      "TR-RESOURCE-WAIT",
      "mcp-task-run:TR-RESOURCE-WAIT:execute:1",
    );
  });

  it("fails closed on a malformed resource wait returned by a coarse scan", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-invalid-wait",
      taskRunId: "TR-INVALID-WAIT",
      userId: "user-1",
      status: "submitted",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: { trigger: "external-mcp" },
      progressPayload: {
        resourceWait: {
          schemaVersion: 1,
          kind: "provider-capacity",
          failureKind: "busy",
          resumeMode: "new-taskrun",
          attempt: 1,
          observedAt: "2026-08-31T03:58:00.000Z",
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
    db.findUnique.mockResolvedValueOnce({
      status: "working",
      updatedAt: new Date("2026-08-31T04:00:00.001Z"),
      progressPayload: {
        dispatch: {
          state: "pending",
          eventId: "mcp-task-run:TR-DURABLE:execute:2",
          attempt: 2,
        },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
        },
      },
    });

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
    db.findUnique.mockResolvedValueOnce({
      status: "quiescing",
      updatedAt: new Date("2026-08-31T04:00:00.001Z"),
      progressPayload: {
        dispatch: {
          state: "pending",
          eventId: "mcp-task-run:TR-QUIESCED:execute:3",
          attempt: 3,
        },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
        },
      },
    });

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

  it.each(["worker admission", "cancellation"])(
    "does not overwrite a concurrent %s after the reconciler sends",
    async () => {
      const reservedAt = new Date("2026-08-31T04:00:00.001Z");
      db.findMany.mockResolvedValue([{
        id: "task-row-race",
        taskRunId: "TR-RACE",
        userId: "user-1",
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
      db.findUnique.mockResolvedValueOnce({
        status: "working",
        updatedAt: reservedAt,
        progressPayload: {
          dispatch: {
            state: "pending",
            eventId: "mcp-task-run:TR-RACE:execute:2",
            attempt: 2,
          },
          durableInference: {
            schemaVersion: 1,
            recipeId: "durable-inference.one-shot.v1",
            state: "admitting",
            attempt: 1,
          },
        },
      });
      db.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await reconcilePersistedRemoteTaskDispatches({
        now: new Date("2026-08-31T04:00:00.000Z"),
        includeOrdinary: false,
      });

      expect(db.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          status: "working",
          updatedAt: reservedAt,
          AND: [
            { progressPayload: { path: ["dispatch", "eventId"], equals: "mcp-task-run:TR-RACE:execute:2" } },
            { progressPayload: { path: ["dispatch", "state"], equals: "pending" } },
          ],
        }),
      }));
    },
  );

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

  it("recovers an exhausted admission crash from its exact durable operation and wakes it", async () => {
    const requestDigest = "a".repeat(64);
    db.findMany.mockResolvedValue([{
      id: "task-row-with-operation",
      taskRunId: "TR-WITH-OPERATION",
      userId: "user-1",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        idempotencyKey: "durable:recover:admission",
        requestDigest,
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
    db.findOperation.mockResolvedValueOnce({
      id: "async-op-1",
      requestContext: {
        executionPlan: {
          providerId: "gemini",
          modelId: "gemini-3.1-pro-preview",
          contractFamily: "background.mcp-durable-inference-one-shot",
          executionAdapter: "async",
          recipeId: "closed-recipe-1",
          maxTokens: 4_096,
          providerSettings: {},
          toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
          responsePolicy: { strictSchema: false, stream: false },
        },
      },
    });

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });
    expect(db.findOperation).toHaveBeenCalledWith({
      where: {
        taskRunId: "task-row-with-operation",
        identityVersion: 1,
        authorityScopeKey: "task-run:task-row-with-operation",
        requestKey: "durable:recover:admission",
        bindingDigest: canonicalAsyncOperationBindingDigest({
          kind: "task-run",
          taskRunId: "task-row-with-operation",
          requestKey: "durable:recover:admission",
          requestDigest,
        }),
        contractFamily: "background.mcp-durable-inference-one-shot",
      },
      select: { id: true, requestContext: true },
    });
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        taskRunId: "TR-WITH-OPERATION",
        status: "working",
        updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      },
      data: expect.objectContaining({
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({
            state: "admitted",
            asyncOperationId: "async-op-1",
            routingRecipeId: "closed-recipe-1",
          }),
        }),
      }),
    }));
    expect(asyncRuntime.enqueue).toHaveBeenCalledWith("async-op-1");
  });

  it("does not recover an exhausted admission from an operation with invalid recipe provenance", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-invalid-operation",
      taskRunId: "TR-INVALID-OPERATION",
      userId: "user-1",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        idempotencyKey: "durable:recover:invalid",
        requestDigest: "b".repeat(64),
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
    db.findOperation.mockResolvedValueOnce({
      id: "async-op-untrusted",
      requestContext: {
        executionPlan: {
          providerId: "gemini",
          modelId: "gemini-3.1-pro-preview",
          contractFamily: "background.mcp-durable-inference-one-shot",
          executionAdapter: "async",
          recipeId: "closed-recipe-1",
          maxTokens: 8_192,
          providerSettings: {},
          toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
          responsePolicy: { strictSchema: false, stream: false },
        },
      },
    });

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 0, exhausted: 0, raced: 1 });
    expect(asyncRuntime.enqueue).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it("settles an exhausted pre-admission cancellation without an operation as canceled", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-cancel-no-op",
      taskRunId: "TR-CANCEL-NO-OP",
      userId: "user-1",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        idempotencyKey: "durable:cancel:no-op",
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 5, state: "failed" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
          cancellationRequestedAt: "2026-08-31T03:59:00.000Z",
        },
      },
    }]);

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 0, exhausted: 1, raced: 0 });
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "canceled",
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({ state: "cancelled-before-admission" }),
        }),
      }),
    }));
  });

  it("propagates an exhausted pre-admission cancellation to its exact bound operation", async () => {
    db.findMany.mockResolvedValue([{
      id: "task-row-cancel-with-op",
      taskRunId: "TR-CANCEL-WITH-OP",
      userId: "user-1",
      status: "working",
      updatedAt: new Date("2026-08-31T03:58:00.000Z"),
      a2aMetadata: {
        idempotencyKey: "durable:cancel:with-op",
        requestDigest: "c".repeat(64),
        durableInference: { schemaVersion: 1, recipeId: "durable-inference.one-shot.v1" },
      },
      progressPayload: {
        dispatch: { attempt: 5, state: "failed" },
        durableInference: {
          schemaVersion: 1,
          recipeId: "durable-inference.one-shot.v1",
          state: "admitting",
          attempt: 1,
          cancellationRequestedAt: "2026-08-31T03:59:00.000Z",
        },
      },
    }]);
    db.findOperation.mockResolvedValueOnce({ id: "async-op-1", requestContext: {} });

    await expect(reconcilePersistedRemoteTaskDispatches({
      now: new Date("2026-08-31T04:00:00.000Z"),
      includeOrdinary: false,
    })).resolves.toEqual({ scanned: 1, enqueued: 0, exhausted: 0, raced: 0 });
    expect(asyncRuntime.cancel).toHaveBeenCalledWith({
      target: { kind: "task-run", taskRunId: "TR-CANCEL-WITH-OP" },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      requestKey: "durable:cancel:with-op",
    });
    expect(asyncRuntime.enqueue).toHaveBeenCalledWith("async-op-1");
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
