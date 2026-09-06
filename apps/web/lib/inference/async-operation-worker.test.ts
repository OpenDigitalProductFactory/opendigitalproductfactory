import { describe, expect, it, vi } from "vitest";

import type { AsyncInferenceOperationStatus } from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  AsyncProviderPollError,
  AsyncProviderStartError,
  runDurableAsyncOperationWorker,
  type AsyncOperationWorkerStore,
} from "./async-operation-worker";

const now = new Date("2026-09-04T12:00:00.000Z");

function operation(overrides: Partial<AsyncOperationRecord> = {}): AsyncOperationRecord {
  return {
    id: "op-1",
    authorityScopeKey: "task-run:task-1",
    requestKey: "request-1",
    requestDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    providerId: "gemini",
    modelId: "deep-research",
    contractFamily: "research",
    screenedRequestContext: { promptRef: "screened:1" },
    taskRunId: "task-row-1",
    workroomId: null,
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

function workerStore(initial = operation()): AsyncOperationWorkerStore {
  const leaseExpiresAt = new Date(now.getTime() + 30_000);
  const claimed = operation({
    ...initial,
    startClaimFence: initial.startClaimFence + 1,
    leaseOwner: "worker-1",
    leaseExpiresAt,
  });
  return {
    loadForWorker: vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(claimed),
    claimOperation: vi.fn().mockResolvedValue({
      operationId: initial.id,
      workerId: "worker-1",
      fence: initial.startClaimFence + 1,
      leaseExpiresAt,
    }),
    renewClaim: vi.fn().mockResolvedValue(new Date(now.getTime() + 30_000)),
    markStartAttempted: vi.fn().mockResolvedValue(undefined),
    releaseClaim: vi.fn().mockResolvedValue(undefined),
    recordProviderStarted: vi.fn().mockImplementation(async (input) => operation({
      status: "running",
      providerOperationId: input.providerOperationId,
      startClaimFence: input.fence,
      leaseOwner: input.workerId,
    })),
    transitionOwned: vi.fn().mockImplementation(async (input) => operation({
      status: input.to as AsyncInferenceOperationStatus,
      startClaimFence: input.fence,
      leaseOwner: input.workerId,
      providerOperationId: (input.data?.operationId as string | undefined) ?? initial.providerOperationId,
    })),
  };
}

function dependencies(store: AsyncOperationWorkerStore) {
  return {
    store,
    now: () => now,
    startProvider: vi.fn().mockResolvedValue({ providerOperationId: "operations/provider-1" }),
    pollProvider: vi.fn().mockResolvedValue({ kind: "running" as const, progressPct: 20 }),
    reconcileIndeterminateStart: vi.fn().mockResolvedValue({ kind: "unresolved" as const }),
  };
}

describe("durable async operation worker", () => {
  it("claims and marks the durable attempt before the sole provider start", async () => {
    const store = workerStore();
    const deps = dependencies(store);
    const order: string[] = [];
    vi.mocked(store.claimOperation).mockImplementation(async () => {
      order.push("claim");
      return { operationId: "op-1", workerId: "worker-1", fence: 1, leaseExpiresAt: new Date(now.getTime() + 30_000) };
    });
    vi.mocked(store.markStartAttempted).mockImplementation(async () => { order.push("attempt"); });
    deps.startProvider.mockImplementation(async () => {
      order.push("provider-post");
      return { providerOperationId: "operations/provider-1" };
    });
    vi.mocked(store.recordProviderStarted).mockImplementation(async () => {
      order.push("persist-handle");
      return operation({ status: "running", providerOperationId: "operations/provider-1" });
    });

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(order).toEqual(["claim", "attempt", "provider-post", "persist-handle"]);
    expect(result).toEqual({ status: "running", disposition: "started" });
  });

  it("checks the fenced lease at provider-return time rather than the stale claim timestamp", async () => {
    const store = workerStore();
    const deps = dependencies(store);
    const providerReturnedAt = new Date(now.getTime() + 40_000);
    deps.now = vi.fn()
      .mockReturnValueOnce(now)
      .mockReturnValue(providerReturnedAt);

    await runDurableAsyncOperationWorker(
      { operationId: "op-1", workerId: "worker-1" },
      deps,
    );

    expect(store.recordProviderStarted).toHaveBeenCalledWith(expect.objectContaining({
      now: providerReturnedAt,
    }));
  });

  it("heartbeats the fenced lease while a provider call is still pending", async () => {
    vi.useFakeTimers();
    try {
      const store = workerStore();
      const deps = dependencies(store);
      let finishProvider!: (value: { providerOperationId: string }) => void;
      deps.startProvider.mockReturnValue(new Promise((resolve) => {
        finishProvider = resolve;
      }));

      const running = runDurableAsyncOperationWorker(
        { operationId: "op-1", workerId: "worker-1", leaseDurationMs: 300 },
        deps,
      );
      await vi.advanceTimersByTimeAsync(100);

      expect(store.renewClaim).toHaveBeenCalledWith({
        operationId: "op-1",
        workerId: "worker-1",
        fence: 1,
        now,
        leaseDurationMs: 300,
      });

      finishProvider({ providerOperationId: "operations/provider-1" });
      await expect(running).resolves.toEqual({ status: "running", disposition: "started" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never repeats a POST after an earlier attempt crossed the durable boundary", async () => {
    const store = workerStore(operation({ startAttemptedAt: new Date(now.getTime() - 60_000) }));
    const deps = dependencies(store);

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(deps.startProvider).not.toHaveBeenCalled();
    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "pending",
      to: "start_indeterminate",
      data: { nextPollAt: new Date(now.getTime() + 30_000) },
    }));
    expect(result).toEqual({ status: "start_indeterminate", disposition: "start-indeterminate" });
  });

  it("turns an ambiguous provider-start failure into start_indeterminate", async () => {
    const store = workerStore();
    const deps = dependencies(store);
    deps.startProvider.mockRejectedValue(new AsyncProviderStartError("timeout", "ambiguous"));

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "pending",
      to: "start_indeterminate",
      data: { nextPollAt: new Date(now.getTime() + 30_000) },
    }));
    expect(result.status).toBe("start_indeterminate");
  });

  it("records a definite provider rejection as failed", async () => {
    const store = workerStore();
    const deps = dependencies(store);
    deps.startProvider.mockRejectedValue(new AsyncProviderStartError("HTTP 400", "definite-rejection"));

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "pending",
      to: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it("reconciles start_indeterminate only through exact provider reconciliation", async () => {
    const store = workerStore(operation({
      status: "start_indeterminate",
      startAttemptedAt: new Date(now.getTime() - 60_000),
    }));
    const deps = dependencies(store);
    deps.reconcileIndeterminateStart.mockResolvedValue({
      kind: "matched",
      providerOperationId: "operations/recovered",
    });

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(deps.startProvider).not.toHaveBeenCalled();
    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "start_indeterminate",
      to: "running",
      data: { operationId: "operations/recovered" },
    }));
    expect(result).toEqual({ status: "running", disposition: "reconciled" });
  });

  it("persists a due boundary when provider reconciliation is still unresolved", async () => {
    const store = workerStore(operation({
      status: "start_indeterminate",
      startAttemptedAt: new Date(now.getTime() - 60_000),
    }));
    const deps = dependencies(store);

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "start_indeterminate",
      to: "start_indeterminate",
      checkpoint: { phase: "provider-start-reconciliation-pending" },
      data: { nextPollAt: new Date(now.getTime() + 30_000) },
    }));
    expect(store.releaseClaim).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "start_indeterminate", disposition: "reconciliation-pending" });
  });

  it("leaves a running operation durable for bounded retry on transient poll failure", async () => {
    const store = workerStore(operation({ status: "running", providerOperationId: "operations/provider-1" }));
    const deps = dependencies(store);
    deps.pollProvider.mockRejectedValue(new AsyncProviderPollError("HTTP 503", true));

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "running",
      to: "running",
      checkpoint: expect.objectContaining({ phase: "provider-poll-transient-failure" }),
      data: expect.objectContaining({ nextPollAt: new Date(now.getTime() + 1_000) }),
    }));
    expect(result).toEqual({ status: "running", disposition: "retry" });
  });

  it("fails closed through a durable transition when running state lacks a provider handle", async () => {
    const store = workerStore(operation({ status: "running", providerOperationId: null }));
    const deps = dependencies(store);

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(deps.pollProvider).not.toHaveBeenCalled();
    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "running",
      to: "failed",
      data: { errorMessage: "ASYNC_OPERATION_RUNNING_WITHOUT_PROVIDER_HANDLE" },
    }));
    expect(result).toEqual({ status: "failed", disposition: "failed" });
  });

  it("persists terminal result and provenance after a completed poll", async () => {
    const store = workerStore(operation({ status: "running", providerOperationId: "operations/provider-1" }));
    const deps = dependencies(store);
    deps.pollProvider.mockResolvedValue({
      kind: "completed",
      text: "final",
      data: { usage: { inputTokens: 3, outputTokens: 4 } },
    });

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "running",
      to: "completed",
      data: expect.objectContaining({ resultText: "final" }),
      checkpoint: expect.objectContaining({ providerOperationId: "operations/provider-1" }),
    }));
    expect(result.status).toBe("completed");
  });

  it("persists a provider-reported cancellation as the canonical cancelled state", async () => {
    const store = workerStore(operation({ status: "running", providerOperationId: "operations/provider-1" }));
    const deps = dependencies(store);
    deps.pollProvider.mockResolvedValue({ kind: "cancelled", reason: "provider cancelled" } as never);

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "running",
      to: "cancelled",
      checkpoint: expect.objectContaining({ phase: "provider-cancelled" }),
    }));
    expect(result).toEqual({ status: "cancelled", disposition: "cancelled" });
  });

  it("never persists provider-controlled diagnostics from a terminal failure", async () => {
    const store = workerStore(operation({
      status: "running",
      providerOperationId: "operations/provider-1",
    }));
    const deps = dependencies(store);
    deps.pollProvider.mockResolvedValue({
      kind: "failed",
      error: "Bearer secret-token customer prompt text",
    });

    await runDurableAsyncOperationWorker(
      { operationId: "op-1", workerId: "worker-1" },
      deps,
    );

    const durableWrite = vi.mocked(store.transitionOwned).mock.calls[0]?.[0];
    expect(durableWrite).toMatchObject({
      checkpoint: {
        phase: "provider-failed",
        error: "ASYNC_PROVIDER_REPORTED_FAILURE",
      },
      data: { errorMessage: "ASYNC_PROVIDER_REPORTED_FAILURE" },
    });
    expect(JSON.stringify(durableWrite)).not.toContain("secret-token");
    expect(JSON.stringify(durableWrite)).not.toContain("customer prompt text");
  });

  it("never persists provider-controlled diagnostics from a poll exception or progress", async () => {
    const initial = operation({
      status: "running",
      providerOperationId: "operations/provider-1",
    });
    const failingStore = workerStore(initial);
    const failingDeps = dependencies(failingStore);
    failingDeps.pollProvider.mockRejectedValue(
      new AsyncProviderPollError("HTTP 503: Bearer secret-token", true),
    );

    await runDurableAsyncOperationWorker(
      { operationId: "op-1", workerId: "worker-1" },
      failingDeps,
    );

    const failureWrite = vi.mocked(failingStore.transitionOwned).mock.calls[0]?.[0];
    expect(failureWrite).toMatchObject({
      checkpoint: {
        phase: "provider-poll-transient-failure",
        error: "ASYNC_PROVIDER_POLL_TRANSIENT_FAILURE",
      },
    });
    expect(JSON.stringify(failureWrite)).not.toContain("secret-token");

    const progressingStore = workerStore(initial);
    const progressingDeps = dependencies(progressingStore);
    progressingDeps.pollProvider.mockResolvedValue({
      kind: "running",
      progressPct: 40,
      progressMessage: "Bearer secret-token",
      checkpoint: { rawProviderDiagnostic: "customer prompt text" },
    });

    await runDurableAsyncOperationWorker(
      { operationId: "op-1", workerId: "worker-1" },
      progressingDeps,
    );

    const progressWrite = vi.mocked(progressingStore.transitionOwned).mock.calls[0]?.[0];
    expect(progressWrite).toMatchObject({
      checkpoint: { phase: "provider-progress" },
      data: {
        progressPct: 40,
        progressMessage: "Provider operation in progress",
      },
    });
    expect(JSON.stringify(progressWrite)).not.toContain("secret-token");
    expect(JSON.stringify(progressWrite)).not.toContain("customer prompt text");
  });

  it.each([
    ["expired", operation({ expiresAt: new Date(now.getTime() - 1) })],
    ["cancelled", operation({ cancelRequestedAt: new Date(now.getTime() - 1) })],
  ] as const)("checks %s before any provider call", async (expected, initial) => {
    const store = workerStore(initial);
    const deps = dependencies(store);

    const result = await runDurableAsyncOperationWorker({ operationId: "op-1", workerId: "worker-1" }, deps);

    expect(deps.startProvider).not.toHaveBeenCalled();
    expect(deps.pollProvider).not.toHaveBeenCalled();
    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({ to: expected }));
    expect(result.status).toBe(expected);
  });

  it("re-reads the fenced claim so a cancellation after the initial load prevents provider start", async () => {
    const initial = operation();
    const cancelledAfterLoad = operation({
      ...initial,
      startClaimFence: 1,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      cancelRequestedAt: new Date(now.getTime() - 1),
    });
    const store = workerStore(initial);
    vi.mocked(store.loadForWorker)
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(cancelledAfterLoad);
    const deps = dependencies(store);

    const result = await runDurableAsyncOperationWorker(
      { operationId: "op-1", workerId: "worker-1" },
      deps,
    );

    expect(store.loadForWorker).toHaveBeenCalledTimes(2);
    expect(deps.startProvider).not.toHaveBeenCalled();
    expect(store.transitionOwned).toHaveBeenCalledWith(expect.objectContaining({
      from: "pending",
      to: "cancelled",
    }));
    expect(result).toEqual({ status: "cancelled", disposition: "cancelled" });
  });
});
