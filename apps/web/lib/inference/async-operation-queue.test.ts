import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  reconcileAsyncOperationWakes,
  runAsyncOperationWake,
} from "./async-operation-queue";

const now = new Date("2026-09-04T12:00:00.000Z");

function operation(overrides: Partial<AsyncOperationRecord> = {}): AsyncOperationRecord {
  return {
    id: "op-1",
    authorityScopeKey: "task-run:tr-1",
    requestKey: "request-1",
    requestDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    providerId: "gemini",
    modelId: "deep-research",
    contractFamily: "research",
    screenedRequestContext: {},
    taskRunId: "tr-1",
    workroomId: null,
    status: "running",
    providerOperationId: "operations/provider-1",
    checkpointSequence: 2,
    transitionSequence: 2,
    startClaimFence: 1,
    startAttemptedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    nextPollAt: new Date(now.getTime() + 5_000),
    resultText: null,
    resultData: null,
    errorMessage: null,
    progressPct: 20,
    progressMessage: "Working",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

describe("durable async operation queue bridge", () => {
  it("runs one fenced worker step and schedules only the persisted next wake", async () => {
    const runWorker = vi.fn().mockResolvedValue({ status: "running", disposition: "progress" });
    const loadForWorker = vi.fn().mockResolvedValue(operation());
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await runAsyncOperationWake(
      { operationId: "op-1", workerId: "worker-1" },
      { runWorker, loadForWorker, enqueue, now: () => now },
    );

    expect(runWorker).toHaveBeenCalledWith({ operationId: "op-1", workerId: "worker-1" });
    expect(enqueue).toHaveBeenCalledWith({
      operationId: "op-1",
      notBefore: new Date(now.getTime() + 5_000),
    });
    expect(result).toEqual({
      status: "running",
      disposition: "progress",
      nextWakeAt: new Date(now.getTime() + 5_000),
    });
  });

  it("does not fan out another advisory event from a duplicate busy wake", async () => {
    const leaseExpiresAt = new Date(now.getTime() + 30_000);
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await runAsyncOperationWake(
      { operationId: "op-1", workerId: "worker-2" },
      {
        runWorker: vi.fn().mockResolvedValue({ status: "running", disposition: "busy" }),
        loadForWorker: vi.fn().mockResolvedValue(operation({
          nextPollAt: new Date(now.getTime() + 1_000),
          leaseOwner: "worker-1",
          leaseExpiresAt,
        })),
        enqueue,
        now: () => now,
      },
    );

    expect(enqueue).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "running",
      disposition: "busy",
      nextWakeAt: null,
    });
  });

  it("keeps a direct reconciliation wake from becoming due in the cron scan", async () => {
    const nextPollAt = new Date(now.getTime() + 30_000);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const runWorker = vi.fn().mockResolvedValue({
      status: "start_indeterminate",
      disposition: "reconciliation-pending",
    });

    await runAsyncOperationWake(
      { operationId: "op-1", workerId: "worker-1" },
      {
        runWorker,
        loadForWorker: vi.fn().mockResolvedValue(operation({
          status: "start_indeterminate",
          providerOperationId: null,
          nextPollAt,
        })),
        enqueue,
        now: () => now,
      },
    );
    const listRecoverableOperationIds = vi.fn().mockImplementation(
      ({ now: scanTime }: { now: Date }) => Promise.resolve(
        scanTime >= nextPollAt ? ["op-1"] : [],
      ),
    );
    await reconcileAsyncOperationWakes(
      { limit: 50 },
      { listRecoverableOperationIds, enqueue, now: () => now },
    );

    expect(runWorker).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({ operationId: "op-1", notBefore: nextPollAt });
  });

  it("backs off an indeterminate provider start instead of creating a tight reconcile loop", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await runAsyncOperationWake(
      { operationId: "op-1", workerId: "worker-1" },
      {
        runWorker: vi.fn().mockResolvedValue({
          status: "start_indeterminate",
          disposition: "start-indeterminate",
        }),
        loadForWorker: vi.fn().mockResolvedValue(operation({
          status: "start_indeterminate",
          providerOperationId: null,
          nextPollAt: null,
        })),
        enqueue,
        now: () => now,
      },
    );

    expect(enqueue).toHaveBeenCalledWith({
      operationId: "op-1",
      notBefore: new Date(now.getTime() + 30_000),
    });
  });

  it("does not schedule another provider wake after a terminal transition", async () => {
    const enqueue = vi.fn();
    const result = await runAsyncOperationWake(
      { operationId: "op-1", workerId: "worker-1" },
      {
        runWorker: vi.fn().mockResolvedValue({ status: "completed", disposition: "completed" }),
        loadForWorker: vi.fn().mockResolvedValue(operation({
          status: "completed",
          completedAt: now,
          nextPollAt: null,
        })),
        enqueue,
        now: () => now,
      },
    );

    expect(result.nextWakeAt).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueues a bounded set of due durable identities without provider work", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const listRecoverableOperationIds = vi.fn().mockResolvedValue(["op-1", "op-2"]);

    await expect(reconcileAsyncOperationWakes(
      { limit: 500 },
      { listRecoverableOperationIds, enqueue, now: () => now },
    )).resolves.toEqual({ inspected: 2, enqueued: 2 });

    expect(listRecoverableOperationIds).toHaveBeenCalledWith({ now, limit: 100 });
    expect(enqueue).toHaveBeenNthCalledWith(1, { operationId: "op-1", notBefore: now });
    expect(enqueue).toHaveBeenNthCalledWith(2, { operationId: "op-2", notBefore: now });
  });
});
