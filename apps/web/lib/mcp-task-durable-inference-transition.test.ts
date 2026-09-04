import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findOperation: vi.fn(),
  settle: vi.fn(),
  findTask: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ read: vi.fn() }));
const events = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    asyncInferenceOp: { findUnique: (...args: unknown[]) => db.findOperation(...args) },
    taskRun: {
      updateMany: (...args: unknown[]) => db.settle(...args),
      findUnique: (...args: unknown[]) => db.findTask(...args),
    },
  },
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  readPrismaAuthorizedAsyncOperation: (...args: unknown[]) => runtime.read(...args),
}));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { emit: (...args: unknown[]) => events.emit(...args) },
}));

import { settleDurableInferenceTaskTransition } from "./mcp-task-durable-inference-transition";
import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
} from "./mcp-task-durable-inference-contract";
import { canonicalAsyncOperationBindingDigest } from "@/lib/inference/async-operation-contract";

const requestDigest = "a".repeat(64);
const asyncRequestDigest = "b".repeat(64);
const now = new Date("2026-09-04T14:00:00.000Z");
const bindingDigest = canonicalAsyncOperationBindingDigest({
  kind: "task-run",
  taskRunId: "task-row-1",
  requestKey: "durable:one-shot:1",
  requestDigest,
});

function task(status = "working") {
  return {
    id: "task-row-1",
    taskRunId: "TR-MCP-DURABLE",
    userId: "user-1",
    currentAgentId: "agent-1",
    threadId: "thread-1",
    contextId: "thread-1",
    status,
    updatedAt: new Date("2026-09-04T13:59:00.000Z"),
    a2aMetadata: {
      idempotencyKey: "durable:one-shot:1",
      requestDigest,
      apiTokenId: "token-1",
      durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID },
    },
    progressPayload: {
      durableInference: {
        schemaVersion: 1,
        recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        state: "admitted",
        attempt: 1,
        asyncOperationId: "async-op-1",
        routingRecipeId: "recipe-row-1",
      },
    },
  };
}

function operation(status = "completed") {
  return {
    operationId: "async-op-1",
    requestKey: "durable:one-shot:1",
    requestDigest: asyncRequestDigest,
    status,
    providerId: "gemini",
    modelId: "gemini-3.1-pro-preview",
    providerOperationId: "interaction-1",
    contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
    checkpointSequence: 3,
    transitionSequence: 3,
    progressPct: status === "completed" ? 100 : 45,
    progressMessage: status === "completed" ? null : "Provider operation in progress",
    resultText: status === "completed" ? "Grounded durable answer." : null,
    resultData: status === "completed" ? { id: "interaction-1" } : null,
    errorMessage: status === "failed" ? "provider failed" : null,
    createdAt: new Date("2026-09-04T13:55:00.000Z"),
    updatedAt: now,
    startedAt: new Date("2026-09-04T13:56:00.000Z"),
    completedAt: status === "completed" || status === "failed" ? now : null,
    expiresAt: new Date("2026-09-04T14:10:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findOperation.mockResolvedValue({
    id: "async-op-1",
    identityVersion: 1,
    bindingDigest,
    taskRun: task(),
  });
  db.settle.mockResolvedValue({ count: 1 });
  db.findTask.mockResolvedValue(null);
  runtime.read.mockResolvedValue({
    operation: operation(),
    transitions: [{ sequence: 3, status: "completed" }],
    nextCursor: 3,
  });
});

describe("durable inference TaskRun transition consumer", () => {
  it("settles a completed operation once with exact provider provenance", async () => {
    const result = await settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    });

    expect(runtime.read).toHaveBeenCalledWith({
      target: { kind: "task-run", taskRunId: "TR-MCP-DURABLE" },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      requestKey: "durable:one-shot:1",
      afterSequence: 2,
      limit: 1,
    });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskRunId: "TR-MCP-DURABLE",
        status: "working",
      }),
      data: expect.objectContaining({
        status: "completed",
        completedAt: now,
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({
            state: "completed",
            asyncOperationId: "async-op-1",
            providerOperationId: "interaction-1",
            requestDigest: asyncRequestDigest,
          }),
        }),
      }),
    }));
    expect(result).toEqual({ status: "completed", taskRunId: "TR-MCP-DURABLE", settled: true });
  });

  it("keeps progress nonterminal while the provider operation is running", async () => {
    runtime.read.mockResolvedValueOnce({
      operation: operation("running"),
      transitions: [{ sequence: 3, status: "running" }],
      nextCursor: 3,
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "running",
      now,
    }))
      .resolves.toMatchObject({ status: "working", settled: true });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "working", completedAt: null }),
    }));
  });

  it("preserves a quiescing TaskRun while the provider operation remains nonterminal", async () => {
    db.findOperation.mockResolvedValueOnce({
      id: "async-op-1",
      identityVersion: 1,
      bindingDigest,
      taskRun: task("quiescing"),
    });
    runtime.read.mockResolvedValueOnce({
      operation: operation("running"),
      transitions: [{ sequence: 3, status: "running" }],
      nextCursor: 3,
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "running",
      now,
    })).resolves.toEqual({
      status: "quiescing",
      taskRunId: "TR-MCP-DURABLE",
      settled: true,
    });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "quiescing" }),
      data: expect.objectContaining({ status: "quiescing", completedAt: null }),
    }));
  });

  it("settles a quiescing TaskRun when the provider operation is terminal", async () => {
    db.findOperation.mockResolvedValueOnce({
      id: "async-op-1",
      identityVersion: 1,
      bindingDigest,
      taskRun: task("quiescing"),
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    })).resolves.toMatchObject({ status: "completed", settled: true });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "quiescing" }),
      data: expect.objectContaining({ status: "completed", completedAt: now }),
    }));
  });

  it.each([
    ["failed", "failed"],
    ["expired", "failed"],
    ["cancelled", "canceled"],
  ])("maps terminal async status %s to TaskRun status %s", async (asyncStatus, taskStatus) => {
    runtime.read.mockResolvedValueOnce({
      operation: operation(asyncStatus),
      transitions: [{ sequence: 4, status: asyncStatus }],
      nextCursor: 4,
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 4,
      status: asyncStatus,
      now,
    }))
      .resolves.toMatchObject({ status: taskStatus, settled: true });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: taskStatus, completedAt: now }),
    }));
  });

  it("fails closed when TaskRun progress points at another operation", async () => {
    db.findOperation.mockImplementationOnce(async () => {
      const row = task();
      (row.progressPayload.durableInference as Record<string, unknown>).asyncOperationId = "async-op-other";
      return { id: "async-op-1", identityVersion: 1, bindingDigest, taskRun: row };
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    }))
      .rejects.toThrow("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
    expect(runtime.read).not.toHaveBeenCalled();
    expect(db.settle).not.toHaveBeenCalled();
  });

  it("does not resettle an already terminal TaskRun on duplicate delivery", async () => {
    const completedTask = task("completed");
    (completedTask.progressPayload.durableInference as Record<string, unknown>).state = "completed";
    db.findOperation.mockResolvedValueOnce({
      id: "async-op-1",
      identityVersion: 1,
      bindingDigest,
      taskRun: completedTask,
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    }))
      .resolves.toEqual({ status: "completed", taskRunId: "TR-MCP-DURABLE", settled: false });
    expect(runtime.read).not.toHaveBeenCalled();
    expect(db.settle).not.toHaveBeenCalled();
  });

  it("uses a stale event only as proof and settles from the newer canonical operation", async () => {
    runtime.read.mockResolvedValueOnce({
      operation: operation("completed"),
      transitions: [{ sequence: 2, status: "running" }],
      nextCursor: 2,
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 2,
      status: "running",
      now,
    })).resolves.toMatchObject({ status: "completed", settled: true });
  });

  it("re-reads and retries a concurrent nonterminal CAS race before acknowledging the event", async () => {
    const latest = {
      ...task("working"),
      updatedAt: new Date("2026-09-04T13:59:30.000Z"),
    };
    db.settle.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    db.findTask.mockResolvedValueOnce(latest).mockResolvedValueOnce(null);

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    })).resolves.toEqual({
      status: "completed",
      taskRunId: "TR-MCP-DURABLE",
      settled: true,
    });
    expect(db.settle).toHaveBeenCalledTimes(2);
    expect(db.settle).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: latest.updatedAt }),
    }));
  });

  it("throws on a repeated CAS miss so the queue retries instead of losing the transition", async () => {
    db.settle.mockResolvedValue({ count: 0 });
    db.findTask.mockResolvedValueOnce({
      ...task("working"),
      updatedAt: new Date("2026-09-04T13:59:30.000Z"),
    });

    await expect(settleDurableInferenceTaskTransition({
      operationId: "async-op-1",
      sequence: 3,
      status: "completed",
      now,
    })).rejects.toThrow("DURABLE_INFERENCE_TASKRUN_CAS_RETRY_REQUIRED");
  });
});
