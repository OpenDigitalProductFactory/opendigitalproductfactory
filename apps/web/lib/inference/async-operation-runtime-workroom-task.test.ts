import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    workroom: { findUnique: vi.fn() },
    taskRun: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    workroom: { findUnique: vi.fn(), updateMany: vi.fn() },
    taskRun: { findUnique: vi.fn(), create: vi.fn() },
  },
  resolveAuthority: vi.fn(),
  resolveBinding: vi.fn(),
  admitDurableOperation: vi.fn(),
  admitRuntimeGuardedWork: vi.fn(),
  enqueueWake: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("./ai-inference", () => ({ callProvider: vi.fn() }));
vi.mock("./async-inference", () => ({ pollAsyncProviderOperation: vi.fn() }));
vi.mock("./async-operation-authority", () => ({
  resolveServerOwnedAsyncOperationAuthority: mocks.resolveAuthority,
  resolveServerOwnedAsyncOperationBinding: mocks.resolveBinding,
}));
vi.mock("./async-operation-lifecycle", () => ({
  admitDurableAsyncOperation: mocks.admitDurableOperation,
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({
  admitRuntimeGuardedWork: mocks.admitRuntimeGuardedWork,
}));
vi.mock("@/lib/execution/adapters/async-operation-events", () => ({
  enqueueAsyncOperationWake: mocks.enqueueWake,
  publishAsyncOperationTransitionEvent: vi.fn(),
}));

import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "@/lib/mcp-task-durable-inference-contract";
import { admitPrismaDurableAsyncOperation } from "./async-operation-runtime";
import { canonicalWorkroomDurableTaskRunId } from "./async-operation-workroom-task";

const requestDigest = "d".repeat(64);

const input = {
  providerId: "gemini",
  modelId: "gemini-3.1-pro-preview",
  contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  screenedRequestDigest: "s".repeat(64),
  screenedRequestContext: {
    version: 1,
    messages: [{ role: "user", content: "Complete the bounded acceptance." }],
    systemPrompt: "Return only the final answer.",
    executionPlan: {
      providerId: "gemini",
      modelId: "gemini-3.1-pro-preview",
      recipeId: "background.mcp-durable-inference-one-shot.v1",
      contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
      executionAdapter: "async",
    },
    dispatchScreen: { schemaVersion: 1 },
    attribution: {
      traceId: "trace-1",
      agentId: "AGT-WS-REVIEW",
      threadId: "thread-1",
    },
  },
  expiresAt: new Date(Date.now() + 15 * 60_000),
  request: {
    kind: "workroom" as const,
    workroomId: "WC-TASK-HUB",
    requestKey: "live-acceptance:task-hub:2",
    requestDigest,
  },
  actor: {
    userId: "user-1",
    agentId: "AGT-WS-REVIEW",
    principalId: "principal-1",
    isSuperuser: false,
  },
};

describe("Prisma Workroom-bound durable task admission", () => {
  let linkedTaskRunId: string | null;
  let taskRun: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    linkedTaskRunId = null;
    taskRun = null;

    mocks.resolveAuthority.mockResolvedValue({
      kind: "workroom",
      workroomId: "workroom-row-1",
    });
    mocks.prisma.workroom.findUnique.mockResolvedValue({
      id: "workroom-row-1",
      capsuleId: "WC-TASK-HUB",
      title: "Async completion delivery task hub",
      objective: "Deliver one durable transition to the Task Hub.",
    });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.workroom.findUnique.mockImplementation(async () => ({
      id: "workroom-row-1",
      capsuleId: "WC-TASK-HUB",
      taskRunId: linkedTaskRunId,
      archivedAt: null,
    }));
    mocks.tx.taskRun.findUnique.mockImplementation(async () => taskRun);
    mocks.tx.taskRun.create.mockImplementation(async ({ data }: {
      data: Record<string, unknown>;
    }) => {
      taskRun = {
        id: "task-row-1",
        taskRunId: data.taskRunId,
        userId: data.userId,
        currentAgentId: data.currentAgentId,
        a2aMetadata: data.a2aMetadata,
        progressPayload: data.progressPayload,
        status: data.status,
        updatedAt: new Date("2026-09-05T12:00:00.000Z"),
      };
      return taskRun;
    });
    mocks.tx.workroom.updateMany.mockImplementation(async ({ data }: {
      data: { taskRunId: string };
    }) => {
      linkedTaskRunId = data.taskRunId;
      return { count: 1 };
    });
    mocks.prisma.taskRun.findUnique.mockImplementation(async () => taskRun);
    mocks.prisma.taskRun.updateMany.mockImplementation(async ({ data }: {
      data: Record<string, unknown>;
    }) => {
      taskRun = { ...taskRun, ...data };
      return { count: 1 };
    });
    mocks.admitRuntimeGuardedWork.mockResolvedValue(undefined);
    mocks.admitDurableOperation
      .mockResolvedValueOnce({ operationId: "async-op-1", replayed: false })
      .mockResolvedValueOnce({ operationId: "async-op-1", replayed: true });
    mocks.enqueueWake.mockResolvedValue(undefined);
  });

  it("persists and projects one canonical TaskRun before the provider wake, then replays without duplication", async () => {
    const first = await admitPrismaDurableAsyncOperation(input);

    expect(first).toEqual({
      operationId: "async-op-1",
      taskRunId: expect.stringMatching(/^TR-ASYNC-[A-F0-9]{24}$/u),
      replayed: false,
    });
    expect(mocks.admitRuntimeGuardedWork).toHaveBeenCalledWith(
      mocks.tx,
      "task-run:proactive",
    );
    expect(mocks.tx.taskRun.create).toHaveBeenCalledOnce();
    expect(mocks.tx.taskRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "working",
        lastHeartbeatAt: expect.any(Date),
      }),
    }));
    expect(mocks.tx.workroom.updateMany).toHaveBeenCalledOnce();
    expect(mocks.admitDurableOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          kind: "task-run",
          taskRunId: first.taskRunId,
          requestKey: input.request.requestKey,
          requestDigest,
        },
        deferInitialWake: true,
      }),
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
    expect(mocks.enqueueWake).toHaveBeenCalledOnce();
    expect(mocks.enqueueWake).toHaveBeenCalledWith({
      operationId: "async-op-1",
      notBefore: expect.any(Date),
    });
    expect(mocks.tx.workroom.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.admitDurableOperation.mock.invocationCallOrder[0]);
    expect(mocks.prisma.taskRun.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.enqueueWake.mock.invocationCallOrder[0]);

    await expect(admitPrismaDurableAsyncOperation(input)).resolves.toEqual({
      operationId: "async-op-1",
      taskRunId: first.taskRunId,
      replayed: true,
    });
    expect(mocks.tx.taskRun.create).toHaveBeenCalledOnce();
    expect(mocks.tx.workroom.updateMany).toHaveBeenCalledOnce();
    expect(mocks.enqueueWake).toHaveBeenCalledOnce();
  });

  it("does not write or dispatch when the server denies Workroom authority", async () => {
    mocks.resolveAuthority.mockRejectedValueOnce(new Error("ASYNC_OPERATION_AUTHORITY_DENIED"));

    await expect(admitPrismaDurableAsyncOperation(input))
      .rejects.toThrow("ASYNC_OPERATION_AUTHORITY_DENIED");

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.admitDurableOperation).not.toHaveBeenCalled();
    expect(mocks.enqueueWake).not.toHaveBeenCalled();
  });

  it("refuses a server-resolved Workroom whose public identity differs from the request", async () => {
    await expect(admitPrismaDurableAsyncOperation({
      ...input,
      request: { ...input.request, workroomId: "WC-FORGED" },
    })).rejects.toThrow("DURABLE_INFERENCE_WORKROOM_IDENTITY_CONFLICT");

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.admitDurableOperation).not.toHaveBeenCalled();
    expect(mocks.enqueueWake).not.toHaveBeenCalled();
  });

  it("refuses an existing deterministic TaskRun without the exact immutable binding", async () => {
    const taskRunId = canonicalWorkroomDurableTaskRunId({
      workroomId: "workroom-row-1",
      requestKey: input.request.requestKey,
      requestDigest,
    });
    linkedTaskRunId = "task-row-1";
    taskRun = {
      id: "task-row-1",
      taskRunId,
      userId: input.actor.userId,
      currentAgentId: input.actor.agentId,
      a2aMetadata: null,
    };

    await expect(admitPrismaDurableAsyncOperation(input))
      .rejects.toThrow("DURABLE_INFERENCE_WORKROOM_TASKRUN_IDENTITY_CONFLICT");

    expect(mocks.admitDurableOperation).not.toHaveBeenCalled();
    expect(mocks.enqueueWake).not.toHaveBeenCalled();
  });

  it("leaves other Workroom-bound contract families on the existing direct path", async () => {
    mocks.admitDurableOperation.mockReset();
    mocks.admitDurableOperation.mockResolvedValue({ operationId: "direct-op", replayed: false });

    await expect(admitPrismaDurableAsyncOperation({
      ...input,
      contractFamily: "background.research",
    })).resolves.toEqual({ operationId: "direct-op", replayed: false });

    expect(mocks.resolveAuthority).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.admitDurableOperation).toHaveBeenCalledWith(
      expect.objectContaining({ request: input.request }),
      expect.any(Object),
    );
  });
});
