import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    taskRun: { findUnique: vi.fn() },
  },
  loadForWorker: vi.fn(),
  requestAuthorizedCancellation: vi.fn(),
  runWorker: vi.fn(),
  enqueueWake: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("./ai-inference", () => ({ callProvider: vi.fn() }));
vi.mock("./async-inference", () => ({ pollAsyncProviderOperation: vi.fn() }));
vi.mock("./async-operation-store", () => ({
  PrismaAsyncOperationStore: class {
    loadForWorker = mocks.loadForWorker;
    requestAuthorizedCancellation = mocks.requestAuthorizedCancellation;
  },
}));
vi.mock("./async-operation-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./async-operation-worker")>()),
  runDurableAsyncOperationWorker: mocks.runWorker,
}));
vi.mock("@/lib/execution/adapters/async-operation-events", () => ({
  enqueueAsyncOperationWake: mocks.enqueueWake,
  publishAsyncOperationTransitionEvent: vi.fn(),
}));

import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "@/lib/mcp-task-durable-inference-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  DURABLE_INFERENCE_TASKRUN_BINDING_MISSING,
  resolveDurableTaskDispatchBinding,
  runPrismaAsyncOperationWake,
} from "./async-operation-runtime";

const now = new Date("2026-09-05T02:32:30.518Z");

function durableOperation(overrides: Partial<AsyncOperationRecord> = {}): AsyncOperationRecord {
  return {
    id: "cmtnrpb9200003cu44gm1bbf7",
    authorityScopeKey: "workroom:WC-1",
    requestKey: "request-1",
    requestDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    providerId: "gemini",
    modelId: "gemini-3.1-pro-preview",
    contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
    screenedRequestContext: { promptRef: "screened:1" },
    taskRunId: null,
    workroomId: "workroom-row-1",
    status: "pending",
    providerOperationId: null,
    checkpointSequence: 0,
    transitionSequence: 0,
    startClaimFence: 0,
    startAttemptedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    nextPollAt: null,
    resultText: null,
    resultData: null,
    errorMessage: null,
    progressPct: null,
    progressMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

describe("durable TaskRun dispatch binding resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a durable-family operation with no TaskRun id as unsatisfiable without touching the database", async () => {
    const binding = await resolveDurableTaskDispatchBinding(durableOperation({ taskRunId: null }));

    expect(binding).toEqual({ kind: "unsatisfiable", error: DURABLE_INFERENCE_TASKRUN_BINDING_MISSING });
    expect(mocks.prisma.taskRun.findUnique).not.toHaveBeenCalled();
  });

  it("reports a TaskRun id whose row is gone as unsatisfiable", async () => {
    mocks.prisma.taskRun.findUnique.mockResolvedValue(null);

    const binding = await resolveDurableTaskDispatchBinding(durableOperation({ taskRunId: "task-row-gone" }));

    expect(binding).toEqual({ kind: "unsatisfiable", error: DURABLE_INFERENCE_TASKRUN_BINDING_MISSING });
    expect(mocks.prisma.taskRun.findUnique).toHaveBeenCalledWith({
      where: { id: "task-row-gone" },
      select: { progressPayload: true },
    });
  });

  it("returns the TaskRun progress payload when the binding holds", async () => {
    mocks.prisma.taskRun.findUnique.mockResolvedValue({ progressPayload: { operationId: "op" } });

    const binding = await resolveDurableTaskDispatchBinding(durableOperation({ taskRunId: "task-row-1" }));

    expect(binding).toEqual({ kind: "bound", progressPayload: { operationId: "op" } });
  });

  it("leaves non-TaskRun contract families alone", async () => {
    const binding = await resolveDurableTaskDispatchBinding(durableOperation({
      contractFamily: "research",
      taskRunId: null,
    }));

    expect(binding).toEqual({ kind: "not-durable-task" });
    expect(mocks.prisma.taskRun.findUnique).not.toHaveBeenCalled();
  });
});

describe("runPrismaAsyncOperationWake with an unsatisfiable binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the orphan to the fenced worker instead of throwing before the claim", async () => {
    const orphan = durableOperation({ taskRunId: null });
    mocks.loadForWorker
      .mockResolvedValueOnce(orphan)
      .mockResolvedValue(durableOperation({ taskRunId: null, status: "failed" }));
    mocks.runWorker.mockResolvedValue({ status: "failed", disposition: "failed" });

    const result = await runPrismaAsyncOperationWake({ operationId: orphan.id, workerId: "worker-1" });

    expect(mocks.runWorker).toHaveBeenCalledTimes(1);
    const [workerInput, workerDeps] = mocks.runWorker.mock.calls[0] as [
      { operationId: string; workerId: string },
      { resolveDispatchBinding?: (operation: AsyncOperationRecord) => Promise<unknown> },
    ];
    expect(workerInput).toEqual({ operationId: orphan.id, workerId: "worker-1" });
    await expect(workerDeps.resolveDispatchBinding?.(orphan)).resolves.toEqual({
      kind: "unsatisfiable",
      error: DURABLE_INFERENCE_TASKRUN_BINDING_MISSING,
    });
    expect(result).toEqual({ status: "failed", disposition: "failed", nextWakeAt: null });
    expect(mocks.enqueueWake).not.toHaveBeenCalled();
  });

  it("still gates a bound TaskRun wake on the durable task disposition", async () => {
    const bound = durableOperation({ taskRunId: "task-row-1" });
    mocks.loadForWorker.mockResolvedValue(bound);
    mocks.prisma.taskRun.findUnique.mockResolvedValue({
      progressPayload: { durableInference: { state: "pending" } },
    });

    const result = await runPrismaAsyncOperationWake({ operationId: bound.id, workerId: "worker-1" });

    expect(result).toEqual({ status: "pending", disposition: "busy", nextWakeAt: null });
    expect(mocks.runWorker).not.toHaveBeenCalled();
  });
});
