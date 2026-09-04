import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findTask: vi.fn(),
  updateTask: vi.fn(),
  updateTasks: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTask(...args),
      update: (...args: unknown[]) => db.updateTask(...args),
      updateMany: (...args: unknown[]) => db.updateTasks(...args),
    },
  },
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  readPrismaAuthorizedAsyncOperation: (...args: unknown[]) => runtime.read(...args),
  requestPrismaAuthorizedAsyncOperationCancellation: (...args: unknown[]) => runtime.cancel(...args),
}));

import {
  handleTasksCancel,
  handleTasksGet,
  handleTasksResult,
} from "./tasks-lifecycle";
import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
} from "../mcp-task-durable-inference-contract";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const requestDigest = "b".repeat(64);

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskRunId: "TR-MCP-DURABLE",
    userId: "user-1",
    title: "Durable inference",
    objective: "Produce one durable answer.",
    status: "working",
    progressPayload: {
      durableInference: {
        schemaVersion: 1,
        recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        state: "admitted",
        asyncOperationId: "async-op-1",
      },
    },
    a2aMetadata: {
      idempotencyKey: "durable:one-shot:1",
      durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID },
    },
    createdAt: new Date("2026-09-04T12:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:01:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function operation(status = "running") {
  return {
    operationId: "async-op-1",
    requestKey: "durable:one-shot:1",
    requestDigest,
    status,
    providerId: "gemini",
    modelId: "gemini-3.1-pro-preview",
    providerOperationId: "interaction-1",
    contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
    checkpointSequence: 3,
    transitionSequence: 3,
    progressPct: status === "completed" ? 100 : 45,
    progressMessage: status === "completed" ? null : "Provider operation in progress",
    resultText: status === "completed" ? "Durable final answer." : null,
    resultData: status === "completed"
      ? { provenance: "provider", hiddenPrompt: "must-not-cross-public-task-boundary" }
      : null,
    errorMessage: status === "failed" ? "provider failed" : null,
    createdAt: new Date("2026-09-04T12:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:02:00.000Z"),
    startedAt: new Date("2026-09-04T12:00:10.000Z"),
    completedAt: status === "completed" || status === "failed"
      ? new Date("2026-09-04T12:02:00.000Z")
      : null,
    expiresAt: new Date("2026-09-04T12:15:00.000Z"),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T12:02:00.000Z"));
  vi.clearAllMocks();
  db.findTask.mockResolvedValue(task());
  db.updateTask.mockResolvedValue(task({ status: "canceled" }));
  db.updateTasks.mockResolvedValue({ count: 1 });
  runtime.read.mockResolvedValue({ operation: operation(), transitions: [], nextCursor: 3 });
  runtime.cancel.mockResolvedValue(operation("running"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MCP Tasks durable inference lifecycle", () => {
  it("tasks/get reconciles through TaskRun authority rather than accepting an operation id", async () => {
    const result = await handleTasksGet("user-1", { taskId: "TR-MCP-DURABLE" });

    expect(runtime.read).toHaveBeenCalledWith({
      target: { kind: "task-run", taskRunId: "TR-MCP-DURABLE" },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      requestKey: "durable:one-shot:1",
    });
    expect(result).toMatchObject({
      kind: "ok",
      value: {
        taskId: "TR-MCP-DURABLE",
        status: "working",
        asyncOperation: {
          status: "running",
          progressPct: 45,
          transitionSequence: 3,
        },
      },
    });
  });

  it("projects submitted durable tasks before worker admission without reading a missing operation", async () => {
    db.findTask.mockResolvedValue(task({
      status: "submitted",
      progressPayload: { durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID, state: "queued" } },
    }));

    await expect(handleTasksGet("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({ kind: "ok", value: { status: "working" } });
    await expect(handleTasksResult("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({
        kind: "ok",
        value: { structuredContent: { status: "working", terminal: false } },
      });
    expect(runtime.read).not.toHaveBeenCalled();
  });

  it("cancels a submitted durable task atomically before its worker can admit an operation", async () => {
    db.findTask.mockResolvedValueOnce(task({
      status: "submitted",
      progressPayload: { durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID, state: "queued" } },
    }));

    await expect(handleTasksCancel("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({
        kind: "ok",
        value: { status: "cancelled", cancellationRequested: true },
      });
    expect(db.updateTasks).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "submitted" }),
      data: expect.objectContaining({ status: "canceled" }),
    }));
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("persists a cancellation intent while durable admission is in flight", async () => {
    db.findTask.mockResolvedValueOnce(task({
      progressPayload: { durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID, state: "admitting" } },
    }));

    await expect(handleTasksCancel("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({ kind: "ok", value: { cancellationRequested: true } });
    expect(db.updateTasks).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "working" }),
      data: expect.objectContaining({
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({ cancellationRequestedAt: expect.any(String) }),
        }),
      }),
    }));
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("persists the same cancellation intent while pre-admission work is quiesced", async () => {
    db.findTask.mockResolvedValueOnce(task({
      status: "quiescing",
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitting",
        },
      },
    }));

    await expect(handleTasksCancel("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({ kind: "ok", value: { cancellationRequested: true } });
    expect(db.updateTasks).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "quiescing" }),
    }));
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("tasks/result returns the exact authorized provider result despite a stale TaskRun projection", async () => {
    runtime.read.mockResolvedValueOnce({ operation: operation("completed"), transitions: [], nextCursor: 3 });

    const result = await handleTasksResult("user-1", { taskId: "TR-MCP-DURABLE" });

    expect(result).toMatchObject({
      kind: "ok",
      value: {
        content: [{ type: "text", text: "Durable final answer." }],
        structuredContent: {
          taskId: "TR-MCP-DURABLE",
          status: "completed",
          terminal: true,
          resultText: "Durable final answer.",
          resultTruncated: false,
          resultOriginalChars: 21,
          resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          provenance: {
            asyncOperationId: "async-op-1",
            requestDigest,
            providerId: "gemini",
            modelId: "gemini-3.1-pro-preview",
            providerOperationId: "interaction-1",
            contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
          },
        },
        isError: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("hiddenPrompt");
    expect(JSON.stringify(result)).not.toContain('"provenance":"provider"');
  });

  it("bounds oversized provider text in both content and structured output", async () => {
    const oversized = "\u0001".repeat(120_000);
    runtime.read.mockResolvedValueOnce({
      operation: { ...operation("completed"), resultText: oversized },
      transitions: [],
      nextCursor: 3,
    });

    const result = await handleTasksResult("user-1", { taskId: "TR-MCP-DURABLE" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const value = result.value as {
      content: Array<{ text: string }>;
      structuredContent: Record<string, unknown>;
    };
    expect(value.content[0]?.text.length).toBeLessThan(oversized.length);
    expect(value.structuredContent).toMatchObject({
      resultTruncated: true,
      resultOriginalChars: oversized.length,
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(value).length).toBeLessThan(MCP_ROUTE_TOOL_RESULT_CHAR_CAP);
  });

  it("bounds oversized provider errors in both content and structured output", async () => {
    const oversized = "provider-error\u0001".repeat(12_000);
    runtime.read.mockResolvedValueOnce({
      operation: { ...operation("failed"), errorMessage: oversized },
      transitions: [],
      nextCursor: 3,
    });

    const result = await handleTasksResult("user-1", { taskId: "TR-MCP-DURABLE" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const value = result.value as {
      content: Array<{ text: string }>;
      structuredContent: Record<string, unknown>;
    };
    expect(value.content[0]?.text.length).toBeLessThan(oversized.length);
    expect(value.structuredContent).toMatchObject({
      errorTruncated: true,
      errorOriginalChars: oversized.length,
      errorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(value).length).toBeLessThan(MCP_ROUTE_TOOL_RESULT_CHAR_CAP);
  });

  it("tasks/cancel delegates through the TaskRun-scoped runtime and does not directly settle the TaskRun", async () => {
    const result = await handleTasksCancel("user-1", { taskId: "TR-MCP-DURABLE" });

    expect(runtime.cancel).toHaveBeenCalledWith({
      target: { kind: "task-run", taskRunId: "TR-MCP-DURABLE" },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      requestKey: "durable:one-shot:1",
    });
    expect(db.updateTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "ok",
      value: { taskId: "TR-MCP-DURABLE", status: "working", cancellationRequested: true },
    });
  });

  it.each([
    ["failed", "failed", true],
    ["expired", "failed", true],
    ["cancelled", "cancelled", false],
  ])("projects durable terminal status %s through tasks/result as %s", async (
    operationStatus,
    expectedStatus,
    isError,
  ) => {
    runtime.read.mockResolvedValueOnce({
      operation: operation(operationStatus),
      transitions: [],
      nextCursor: 4,
    });

    await expect(handleTasksResult("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({
        kind: "ok",
        value: {
          structuredContent: { status: expectedStatus, terminal: true },
          isError,
        },
      });
  });

  it("denies a foreign caller before touching the async runtime", async () => {
    const result = await handleTasksResult("user-2", { taskId: "TR-MCP-DURABLE" });

    expect(result).toEqual({ kind: "forbidden", message: "task belongs to a different auth context" });
    expect(runtime.read).not.toHaveBeenCalled();
  });

  it("fails closed when persisted progress references another async operation", async () => {
    db.findTask.mockResolvedValueOnce(task({
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          asyncOperationId: "async-op-other",
        },
      },
    }));

    await expect(handleTasksGet("user-1", { taskId: "TR-MCP-DURABLE" }))
      .rejects.toThrow("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
  });

  it("preserves the ordinary TaskRun cancellation path", async () => {
    const ordinary = task({ a2aMetadata: {}, progressPayload: null });
    db.findTask.mockResolvedValueOnce(ordinary);
    db.updateTask.mockResolvedValueOnce({ ...ordinary, status: "canceled", completedAt: new Date() });

    await expect(handleTasksCancel("user-1", { taskId: "TR-MCP-DURABLE" }))
      .resolves.toMatchObject({ kind: "ok", value: { status: "cancelled" } });
    expect(db.updateTask).toHaveBeenCalledOnce();
    expect(runtime.cancel).not.toHaveBeenCalled();
  });
});
