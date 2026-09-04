import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import type { AsyncOperationTransitionRecord } from "./async-operation-store";
import {
  listAuthorizedAsyncOperations,
  readAuthorizedAsyncOperation,
  requestAuthorizedAsyncOperationCancellation,
  type AsyncOperationReadStore,
} from "./async-operation-read-model";

const now = new Date("2026-09-04T12:00:00.000Z");
const operation: AsyncOperationRecord = {
  id: "op-1",
  authorityScopeKey: "task-run:task-row-1",
  requestKey: "logical-1",
  requestDigest: "a".repeat(64),
  bindingDigest: "b".repeat(64),
  providerId: "gemini",
  modelId: "deep-research",
  contractFamily: "research",
  screenedRequestContext: { secretThatMustNotEscape: "value" },
  taskRunId: "task-row-1",
  workroomId: null,
  status: "completed",
  providerOperationId: "provider-op-1",
  checkpointSequence: 3,
  transitionSequence: 3,
  startClaimFence: 1,
  startAttemptedAt: now,
  leaseOwner: null,
  leaseExpiresAt: null,
  cancelRequestedAt: null,
  nextPollAt: null,
  resultText: "done",
  resultData: { answer: 42 },
  errorMessage: null,
  progressPct: 100,
  progressMessage: "Complete",
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: now,
  expiresAt: new Date(now.getTime() + 60_000),
};
const transitions: AsyncOperationTransitionRecord[] = [{
  id: "transition-3",
  operationId: "op-1",
  sequence: 3,
  status: "completed",
  checkpoint: { phase: "provider-completed" },
  occurredAt: now,
  deliveryAttempts: 1,
  deliveredAt: now,
}];

function dependencies(overrides?: Partial<AsyncOperationReadStore>) {
  const store: AsyncOperationReadStore = {
    loadAuthorizedOperation: vi.fn().mockResolvedValue(operation),
    listAuthorizedOperations: vi.fn().mockResolvedValue([operation]),
    listAuthorizedTransitions: vi.fn().mockResolvedValue(transitions),
    requestAuthorizedCancellation: vi.fn().mockResolvedValue(operation),
    ...overrides,
  };
  const db = {
    taskRun: {
      findUnique: vi.fn().mockResolvedValue({
        id: "task-row-1",
        taskRunId: "TR-1",
        userId: "user-1",
        initiatingAgentId: null,
        currentAgentId: null,
      }),
    },
    workroom: { findUnique: vi.fn() },
  };
  return { store, db };
}

describe("authorized async operation read/reconcile surface", () => {
  it("returns exact result provenance and a bounded transition cursor through TaskRun authority", async () => {
    const deps = dependencies();
    const result = await readAuthorizedAsyncOperation({
      target: { kind: "task-run", taskRunId: "TR-1" },
      requestKey: "logical-1",
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      afterSequence: 2,
      limit: 500,
    }, deps);

    expect(result.operation).toEqual(expect.objectContaining({
      operationId: "op-1",
      status: "completed",
      providerId: "gemini",
      providerOperationId: "provider-op-1",
      requestDigest: "a".repeat(64),
      resultText: "done",
    }));
    expect(result.operation).not.toHaveProperty("screenedRequestContext");
    expect(result.transitions).toEqual(transitions);
    expect(deps.store.listAuthorizedTransitions).toHaveBeenCalledWith({
      authorityScopeKey: "task-run:task-row-1",
      requestKey: "logical-1",
      afterSequence: 2,
      limit: 100,
    });
    expect(result.nextCursor).toBe(3);
  });

  it("does not authorize with a bare operation id or a cross-scope request", async () => {
    const deps = dependencies({ loadAuthorizedOperation: vi.fn().mockResolvedValue(null) });
    await expect(readAuthorizedAsyncOperation({
      target: { kind: "task-run", taskRunId: "TR-1" },
      requestKey: "op-1",
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
    }, deps)).rejects.toThrow("ASYNC_OPERATION_NOT_FOUND");

    const foreign = dependencies();
    vi.mocked(foreign.db.taskRun.findUnique).mockResolvedValue({
      id: "other-row",
      taskRunId: "TR-OTHER",
      userId: "someone-else",
      initiatingAgentId: null,
      currentAgentId: null,
    });
    await expect(readAuthorizedAsyncOperation({
      target: { kind: "task-run", taskRunId: "TR-OTHER" },
      requestKey: "logical-1",
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
    }, foreign)).rejects.toThrow("ASYNC_OPERATION_AUTHORITY_DENIED");
    expect(foreign.store.loadAuthorizedOperation).not.toHaveBeenCalled();
  });

  it("requests cancellation only through the same exact authority and request key", async () => {
    const deps = dependencies();
    await requestAuthorizedAsyncOperationCancellation({
      target: { kind: "task-run", taskRunId: "TR-1" },
      requestKey: "logical-1",
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      now,
    }, deps);

    expect(deps.store.requestAuthorizedCancellation).toHaveBeenCalledWith({
      authorityScopeKey: "task-run:task-row-1",
      requestKey: "logical-1",
      now,
    });
  });

  it("lists a bounded operation page through semantic Workroom authority", async () => {
    const deps = dependencies();
    vi.mocked(deps.db.workroom.findUnique).mockResolvedValue({
      id: "workroom-row-1",
      capsuleId: "WC-1",
      executorRef: "session-1",
      leaseHolderPrincipalId: null,
      participants: [],
    });

    const result = await listAuthorizedAsyncOperations({
      target: { kind: "workroom", workroomId: "WC-1" },
      actor: { userId: null, agentId: "session-1", principalId: null, isSuperuser: false },
      after: {
        createdAt: "2026-09-04T12:30:00.000Z",
        operationId: "op-next",
      },
      limit: 500,
    }, deps);

    expect(deps.store.listAuthorizedOperations).toHaveBeenCalledWith({
      authorityScopeKey: "workroom:workroom-row-1",
      after: {
        createdAt: new Date("2026-09-04T12:30:00.000Z"),
        operationId: "op-next",
      },
      limit: 100,
    });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).not.toHaveProperty("screenedRequestContext");
    expect(result.nextCursor).toEqual({
      createdAt: now.toISOString(),
      operationId: "op-1",
    });
  });
});
