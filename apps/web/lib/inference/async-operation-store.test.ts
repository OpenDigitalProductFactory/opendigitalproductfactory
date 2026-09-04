import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationBinding } from "./async-operation-contract";
import {
  AsyncOperationIdentityConflictError,
  type CreateOrReplayAsyncOperationInput,
} from "./async-operation-lifecycle";
import {
  PrismaAsyncOperationStore,
  type AsyncOperationDatabase,
} from "./async-operation-store";

const now = new Date("2026-09-04T12:00:00.000Z");
const binding: AsyncOperationBinding = {
  kind: "task-run",
  taskRunId: "task-internal-1",
  requestKey: "request-key-1",
  requestDigest: "a".repeat(64),
};

const createInput: CreateOrReplayAsyncOperationInput = {
  binding,
  authorityScopeKey: "task-run:task-internal-1",
  requestKey: "request-key-1",
  requestDigest: "b".repeat(64),
  bindingDigest: "c".repeat(64),
  providerId: "gemini",
  modelId: "deep-research",
  contractFamily: "research",
  screenedRequestContext: { promptRef: "screened:1" },
  expiresAt: new Date("2026-09-04T13:00:00.000Z"),
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    identityVersion: 1,
    authorityScopeKey: createInput.authorityScopeKey,
    requestKey: createInput.requestKey,
    requestDigest: createInput.requestDigest,
    bindingDigest: createInput.bindingDigest,
    providerId: createInput.providerId,
    modelId: createInput.modelId,
    contractFamily: createInput.contractFamily,
    requestContext: createInput.screenedRequestContext,
    taskRunId: "task-internal-1",
    workroomId: null,
    status: "pending",
    operationId: null,
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
    expiresAt: createInput.expiresAt,
    ...overrides,
  };
}

function database(existing: ReturnType<typeof row> | null = null) {
  let current = existing;
  const transitionCreate = vi.fn().mockResolvedValue({});
  const op = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return current?.id === where.id ? current : null;
      return current;
    }),
    create: vi.fn(async ({ data }: any) => {
      current = row({ ...data, id: "op-1" });
      return current;
    }),
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn(async ({ where, data }: any) => {
      if (!current || where.id !== current.id) return { count: 0 };
      if (where.status && where.status !== current.status) return { count: 0 };
      if (where.startClaimFence !== undefined && where.startClaimFence !== current.startClaimFence) return { count: 0 };
      if (where.leaseOwner !== undefined && where.leaseOwner !== current.leaseOwner) return { count: 0 };
      current = row({
        ...current,
        ...data,
        startClaimFence: data.startClaimFence?.increment
          ? current.startClaimFence + data.startClaimFence.increment
          : (data.startClaimFence ?? current.startClaimFence),
        transitionSequence: data.transitionSequence?.increment
          ? current.transitionSequence + data.transitionSequence.increment
          : (data.transitionSequence ?? current.transitionSequence),
        checkpointSequence: data.checkpointSequence?.increment
          ? current.checkpointSequence + data.checkpointSequence.increment
          : (data.checkpointSequence ?? current.checkpointSequence),
      });
      return { count: 1 };
    }),
  };
  const db = {
    asyncInferenceOp: op,
    asyncInferenceOperationTransition: {
      create: transitionCreate,
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  } as unknown as AsyncOperationDatabase;
  return { db, op, transitionCreate, current: () => current };
}

describe("PrismaAsyncOperationStore", () => {
  it("atomically creates identityVersion 1 and its initial outbox transition", async () => {
    const mocks = database();
    const store = new PrismaAsyncOperationStore(mocks.db);

    const result = await store.createOrReplay(createInput);

    expect(result.replayed).toBe(false);
    expect(mocks.op.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityVersion: 1,
        authorityScopeKey: "task-run:task-internal-1",
        taskRunId: "task-internal-1",
        workroomId: null,
        status: "pending",
      }),
    });
    expect(mocks.transitionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ operationId: "op-1", sequence: 0, status: "pending" }),
    });
    expect(mocks.db.$transaction).toHaveBeenCalledOnce();
  });

  it("replays only an exact identity and rejects drift", async () => {
    const exact = database(row());
    const result = await new PrismaAsyncOperationStore(exact.db).createOrReplay(createInput);
    expect(result.replayed).toBe(true);
    expect(exact.op.create).not.toHaveBeenCalled();

    const drift = database(row({ modelId: "different-model" }));
    await expect(
      new PrismaAsyncOperationStore(drift.db).createOrReplay(createInput),
    ).rejects.toBeInstanceOf(AsyncOperationIdentityConflictError);

    const rebound = database(row({ taskRunId: "different-task-row" }));
    await expect(
      new PrismaAsyncOperationStore(rebound.db).createOrReplay(createInput),
    ).rejects.toBeInstanceOf(AsyncOperationIdentityConflictError);
  });

  it("claims the operation with a monotonic fence before provider dispatch", async () => {
    const mocks = database(row());
    const store = new PrismaAsyncOperationStore(mocks.db);

    const claim = await store.claimOperation({
      operationId: "op-1",
      workerId: "worker-1",
      now,
      leaseDurationMs: 30_000,
      allowedStatuses: ["pending"],
    });

    expect(claim).toMatchObject({ workerId: "worker-1", fence: 1 });
    expect(mocks.current()).toMatchObject({
      startClaimFence: 1,
      startAttemptedAt: null,
      leaseOwner: "worker-1",
    });
    expect(mocks.current()?.leaseExpiresAt).toEqual(new Date(now.getTime() + 30_000));
  });

  it("refuses a duplicate wake before the persisted poll deadline", async () => {
    const mocks = database(row({
      status: "running",
      operationId: "operations/provider-1",
      nextPollAt: new Date(now.getTime() + 5_000),
    }));

    await expect(new PrismaAsyncOperationStore(mocks.db).claimOperation({
      operationId: "op-1",
      workerId: "worker-1",
      now,
      leaseDurationMs: 30_000,
      allowedStatuses: ["running"],
    })).resolves.toBeNull();
    expect(mocks.op.updateMany).not.toHaveBeenCalled();
  });

  it("renews only the current fenced lease across bounded provider I/O", async () => {
    const mocks = database(row({
      startClaimFence: 2,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now.getTime() + 10_000),
    }));
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.renewClaim({
      operationId: "op-1",
      workerId: "worker-1",
      fence: 2,
      now,
      leaseDurationMs: 30_000,
    })).resolves.toEqual(new Date(now.getTime() + 30_000));
    expect(mocks.current()?.leaseExpiresAt).toEqual(new Date(now.getTime() + 30_000));

    await expect(store.renewClaim({
      operationId: "op-1",
      workerId: "stale-worker",
      fence: 2,
      now,
      leaseDurationMs: 30_000,
    })).rejects.toThrow("ASYNC_OPERATION_LEASE_LOST");
  });

  it("lets a successor lease an attempted operation without clearing the attempt boundary", async () => {
    const mocks = database(row({
      startAttemptedAt: now,
      startClaimFence: 1,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now.getTime() - 1),
    }));

    await expect(new PrismaAsyncOperationStore(mocks.db).claimOperation({
      operationId: "op-1",
      workerId: "worker-2",
      now,
      leaseDurationMs: 30_000,
      allowedStatuses: ["pending"],
    })).resolves.toMatchObject({ workerId: "worker-2", fence: 2 });
    expect(mocks.current()?.startAttemptedAt).toEqual(now);
  });

  it("records provider identity and running transition under the exact fence", async () => {
    const mocks = database(row({
      startAttemptedAt: now,
      startClaimFence: 2,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    }));
    const store = new PrismaAsyncOperationStore(mocks.db);

    const updated = await store.recordProviderStarted({
      operationId: "op-1",
      workerId: "worker-1",
      fence: 2,
      providerOperationId: "operations/provider-1",
      now,
      checkpoint: { phase: "started" },
    });

    expect(updated.status).toBe("running");
    expect(updated.providerOperationId).toBe("operations/provider-1");
    expect(mocks.transitionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ operationId: "op-1", sequence: 1, status: "running" }),
    });
  });

  it("fails a stale worker fence without writing a transition", async () => {
    const mocks = database(row({
      startAttemptedAt: now,
      startClaimFence: 3,
      leaseOwner: "worker-new",
    }));
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.recordProviderStarted({
      operationId: "op-1",
      workerId: "worker-old",
      fence: 2,
      providerOperationId: "operations/provider-1",
      now,
      checkpoint: {},
    })).rejects.toThrow("ASYNC_OPERATION_LEASE_LOST");
    expect(mocks.transitionCreate).not.toHaveBeenCalled();
  });

  it("lists a bounded cursor only through the exact authority scope", async () => {
    const mocks = database(row());
    vi.mocked(mocks.db.asyncInferenceOperationTransition.findMany).mockResolvedValue([
      {
        id: "transition-4",
        operationId: "op-1",
        sequence: 4,
        status: "running",
        checkpoint: { phase: "progress" },
        occurredAt: now,
        deliveryAttempts: 0,
        deliveredAt: null,
      },
    ] as never);
    const store = new PrismaAsyncOperationStore(mocks.db);

    const result = await store.listAuthorizedTransitions({
      authorityScopeKey: "task-run:task-internal-1",
      requestKey: "request-key-1",
      afterSequence: 3,
      limit: 500,
    });

    expect(result).toHaveLength(1);
    expect(mocks.db.asyncInferenceOperationTransition.findMany).toHaveBeenCalledWith({
      where: { operationId: "op-1", sequence: { gt: 3 } },
      orderBy: { sequence: "asc" },
      take: 100,
    });
  });

  it("lists operation handles with a stable bounded authority cursor", async () => {
    const mocks = database(row());
    vi.mocked(mocks.op.findMany).mockResolvedValue([row()]);
    const store = new PrismaAsyncOperationStore(mocks.db);
    const after = {
      createdAt: new Date(now.getTime() + 1_000),
      operationId: "op-next",
    };

    await expect(store.listAuthorizedOperations({
      authorityScopeKey: createInput.authorityScopeKey,
      after,
      limit: 500,
    })).resolves.toHaveLength(1);

    expect(mocks.op.findMany).toHaveBeenCalledWith({
      where: {
        identityVersion: 1,
        authorityScopeKey: createInput.authorityScopeKey,
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.operationId } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  });

  it("atomically requests cancellation and invalidates an active worker fence", async () => {
    const mocks = database(row({
      status: "running",
      operationId: "provider-op-1",
      startClaimFence: 4,
      transitionSequence: 2,
      checkpointSequence: 2,
      leaseOwner: "worker-old",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    }));
    const store = new PrismaAsyncOperationStore(mocks.db);

    const result = await store.requestAuthorizedCancellation({
      authorityScopeKey: "task-run:task-internal-1",
      requestKey: "request-key-1",
      now,
    });

    expect(result).toMatchObject({
      status: "running",
      cancelRequestedAt: now,
      startClaimFence: 5,
      leaseOwner: null,
    });
    expect(mocks.transitionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId: "op-1",
        sequence: 3,
        status: "running",
        checkpoint: { phase: "cancellation-requested" },
      }),
    });
  });

  it("retries a cancellation CAS instead of silently losing the request", async () => {
    const mocks = database(row({
      status: "running",
      operationId: "provider-op-1",
      transitionSequence: 2,
      checkpointSequence: 2,
    }));
    vi.mocked(mocks.op.updateMany).mockResolvedValueOnce({ count: 0 });
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.requestAuthorizedCancellation({
      authorityScopeKey: createInput.authorityScopeKey,
      requestKey: createInput.requestKey,
      now,
    })).resolves.toMatchObject({ cancelRequestedAt: now });

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transitionCreate).toHaveBeenCalledOnce();
  });

  it("fails closed when cancellation cannot win a bounded CAS retry", async () => {
    const mocks = database(row({
      status: "running",
      operationId: "provider-op-1",
      transitionSequence: 2,
      checkpointSequence: 2,
    }));
    vi.mocked(mocks.op.updateMany).mockResolvedValue({ count: 0 });
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.requestAuthorizedCancellation({
      authorityScopeKey: createInput.authorityScopeKey,
      requestKey: createInput.requestKey,
      now,
    })).rejects.toThrow("ASYNC_OPERATION_CANCEL_CONFLICT");

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.transitionCreate).not.toHaveBeenCalled();
  });

  it("treats cancellation of a terminal operation as an idempotent read", async () => {
    const mocks = database(row({ status: "completed", completedAt: now }));
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.requestAuthorizedCancellation({
      authorityScopeKey: "task-run:task-internal-1",
      requestKey: "request-key-1",
      now,
    })).resolves.toMatchObject({ status: "completed" });
    expect(mocks.op.updateMany).not.toHaveBeenCalled();
    expect(mocks.transitionCreate).not.toHaveBeenCalled();
  });

  it("loads and marks a bounded durable outbox without widening status", async () => {
    const mocks = database(row());
    vi.mocked(mocks.db.asyncInferenceOperationTransition.findMany).mockResolvedValue([{
      id: "transition-1",
      operationId: "op-1",
      sequence: 1,
      status: "running",
      checkpoint: { phase: "provider-started" },
      occurredAt: now,
      deliveryAttempts: 0,
      deliveredAt: null,
    }] as never);
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.listUndeliveredTransitions({ limit: 1_000 })).resolves.toEqual([
      expect.objectContaining({ id: "transition-1", status: "running", sequence: 1 }),
    ]);
    expect(mocks.db.asyncInferenceOperationTransition.findMany).toHaveBeenCalledWith({
      where: { deliveredAt: null },
      orderBy: [{ occurredAt: "asc" }, { operationId: "asc" }, { sequence: "asc" }],
      take: 100,
    });

    await expect(store.markTransitionDeliveryAttempt("transition-1")).resolves.toBe(true);
    await store.markTransitionDelivered("transition-1", now);
    expect(mocks.db.asyncInferenceOperationTransition.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "transition-1", deliveredAt: null },
      data: { deliveryAttempts: { increment: 1 } },
    });
    expect(mocks.db.asyncInferenceOperationTransition.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "transition-1", deliveredAt: null },
      data: { deliveredAt: now },
    });
  });

  it("treats an already-delivered transition as an idempotent outbox race", async () => {
    const mocks = database(row());
    vi.mocked(mocks.db.asyncInferenceOperationTransition.updateMany)
      .mockResolvedValue({ count: 0 });
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.markTransitionDeliveryAttempt("transition-1")).resolves.toBe(false);
    await expect(store.markTransitionDelivered("transition-1", now)).resolves.toBeUndefined();
  });

  it("rejects an unknown persisted status at the outbox boundary", async () => {
    const mocks = database(row());
    vi.mocked(mocks.db.asyncInferenceOperationTransition.findMany).mockResolvedValue([{
      id: "transition-1",
      operationId: "op-1",
      sequence: 1,
      status: "provider-is-thinking",
      checkpoint: {},
      occurredAt: now,
      deliveryAttempts: 0,
      deliveredAt: null,
    }] as never);

    await expect(new PrismaAsyncOperationStore(mocks.db).listUndeliveredTransitions())
      .rejects.toThrow("Invalid async inference operation status");
  });

  it("lists only due, unleased durable operations for bounded reconciliation", async () => {
    const mocks = database(row());
    vi.mocked(mocks.op.findMany).mockResolvedValue([
      { id: "op-pending" },
      { id: "op-running" },
    ] as never);
    const store = new PrismaAsyncOperationStore(mocks.db);

    await expect(store.listRecoverableOperationIds({ now, limit: 999 }))
      .resolves.toEqual(["op-pending", "op-running"]);
    expect(mocks.op.findMany).toHaveBeenCalledWith({
      where: {
        identityVersion: 1,
        status: { in: ["pending", "start_indeterminate", "running"] },
        AND: [
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
          { OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] },
        ],
      },
      orderBy: [{ nextPollAt: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: 100,
    });
  });
});
