import type { Prisma } from "@dpf/db";

import {
  assertAsyncOperationTransition,
  parseAsyncInferenceOperationStatus,
  type AsyncInferenceOperationStatus,
} from "./async-operation-contract";
import {
  AsyncOperationIdentityConflictError,
  type AsyncOperationAdmissionStore,
  type AsyncOperationRecord,
  type CreateOrReplayAsyncOperationInput,
} from "./async-operation-lifecycle";
import { PrismaAsyncOperationQueryStore } from "./async-operation-query-store";
import {
  AsyncOperationLeaseLostError,
  mapAsyncOperationRow,
  requiredAsyncOperationString,
  type AsyncOperationDatabase,
  type AsyncOperationLeaseClaim,
} from "./async-operation-store-shared";

export { AsyncOperationLeaseLostError } from "./async-operation-store-shared";
export type {
  AsyncOperationDatabase,
  AsyncOperationLeaseClaim,
  AsyncOperationTransitionRecord,
} from "./async-operation-store-shared";

function assertReplayIdentity(
  row: any,
  input: CreateOrReplayAsyncOperationInput,
): void {
  const expectedTaskRunId = input.binding.kind === "task-run"
    ? input.binding.taskRunId
    : null;
  const expectedWorkroomId = input.binding.kind === "workroom"
    ? input.binding.workroomId
    : null;
  if (
    row.identityVersion !== 1
    || row.authorityScopeKey !== input.authorityScopeKey
    || row.requestKey !== input.requestKey
    || row.requestDigest !== input.requestDigest
    || row.bindingDigest !== input.bindingDigest
    || row.providerId !== input.providerId
    || row.modelId !== input.modelId
    || row.contractFamily !== input.contractFamily
    || row.taskRunId !== expectedTaskRunId
    || row.workroomId !== expectedWorkroomId
  ) {
    throw new AsyncOperationIdentityConflictError();
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "P2002",
  );
}

/**
 * Prisma-backed durable lifecycle store. All side-effect-bearing worker writes
 * are fenced compare-and-swap operations; an advisory queue event never owns
 * lifecycle truth.
 */
export class PrismaAsyncOperationStore
  extends PrismaAsyncOperationQueryStore
  implements AsyncOperationAdmissionStore {

  async createOrReplay(
    input: CreateOrReplayAsyncOperationInput,
  ): Promise<{ operation: AsyncOperationRecord; replayed: boolean }> {
    try {
      return await this.db.$transaction(async (tx) => {
        const existing = await tx.asyncInferenceOp.findUnique({
          where: {
            authorityScopeKey_requestKey: {
              authorityScopeKey: input.authorityScopeKey,
              requestKey: input.requestKey,
            },
          },
        });
        if (existing) {
          assertReplayIdentity(existing, input);
          return { operation: mapAsyncOperationRow(existing), replayed: true };
        }

        const operation = await tx.asyncInferenceOp.create({
          data: {
            identityVersion: 1,
            authorityScopeKey: input.authorityScopeKey,
            requestKey: input.requestKey,
            requestDigest: input.requestDigest,
            bindingDigest: input.bindingDigest,
            taskRunId: input.binding.kind === "task-run" ? input.binding.taskRunId : null,
            workroomId: input.binding.kind === "workroom" ? input.binding.workroomId : null,
            providerId: input.providerId,
            modelId: input.modelId,
            contractFamily: input.contractFamily,
            requestContext: input.screenedRequestContext as Prisma.InputJsonValue,
            status: "pending",
            operationId: null,
            checkpointSequence: 0,
            transitionSequence: 0,
            startClaimFence: 0,
            expiresAt: input.expiresAt,
          },
        });
        await tx.asyncInferenceOperationTransition.create({
          data: {
            operationId: operation.id,
            sequence: 0,
            status: "pending",
            checkpoint: { phase: "admitted" },
          },
        });
        return { operation: mapAsyncOperationRow(operation), replayed: false };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;

      // Concurrent create won. Read the canonical row in a fresh transaction;
      // PostgreSQL aborts the transaction containing the unique violation.
      const existing = await this.db.asyncInferenceOp.findUnique({
        where: {
          authorityScopeKey_requestKey: {
            authorityScopeKey: input.authorityScopeKey,
            requestKey: input.requestKey,
          },
        },
      });
      if (!existing) throw error;
      assertReplayIdentity(existing, input);
      return { operation: mapAsyncOperationRow(existing), replayed: true };
    }
  }

  async loadForWorker(operationId: string): Promise<AsyncOperationRecord | null> {
    const row = await this.db.asyncInferenceOp.findUnique({ where: { id: operationId } });
    if (!row || row.identityVersion !== 1) return null;
    return mapAsyncOperationRow(row);
  }

  async listRecoverableOperationIds(input: {
    now: Date;
    limit?: number;
  }): Promise<string[]> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
    const rows = await this.db.asyncInferenceOp.findMany({
      where: {
        identityVersion: 1,
        status: { in: ["pending", "start_indeterminate", "running"] },
        AND: [
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: input.now } }] },
          { OR: [{ nextPollAt: null }, { nextPollAt: { lte: input.now } }] },
        ],
      },
      orderBy: [{ nextPollAt: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => requiredAsyncOperationString(row.id, "recoverable operation id"));
  }

  async claimOperation(input: {
    operationId: string;
    workerId: string;
    now: Date;
    leaseDurationMs: number;
    allowedStatuses: readonly AsyncInferenceOperationStatus[];
  }): Promise<AsyncOperationLeaseClaim | null> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.asyncInferenceOp.findUnique({ where: { id: input.operationId } });
      if (
        !row
        || row.identityVersion !== 1
        || !input.allowedStatuses.includes(parseAsyncInferenceOperationStatus(row.status))
      ) {
        return null;
      }
      if (row.leaseExpiresAt instanceof Date && row.leaseExpiresAt > input.now) {
        return null;
      }
      if (row.nextPollAt instanceof Date && row.nextPollAt > input.now) {
        return null;
      }

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
      const updated = await tx.asyncInferenceOp.updateMany({
        where: {
          id: input.operationId,
          identityVersion: 1,
          status: row.status,
          startClaimFence: row.startClaimFence,
          AND: [
            {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: input.now } },
              ],
            },
            {
              OR: [
                { nextPollAt: null },
                { nextPollAt: { lte: input.now } },
              ],
            },
          ],
        },
        data: {
          leaseOwner: input.workerId,
          leaseExpiresAt,
          startClaimFence: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      return {
        operationId: input.operationId,
        workerId: input.workerId,
        fence: Number(row.startClaimFence) + 1,
        leaseExpiresAt,
      };
    });
  }

  async renewClaim(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<Date> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    const updated = await this.db.asyncInferenceOp.updateMany({
      where: {
        id: input.operationId,
        identityVersion: 1,
        startClaimFence: input.fence,
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: input.now },
      },
      data: { leaseExpiresAt },
    });
    if (updated.count !== 1) throw new AsyncOperationLeaseLostError();
    return leaseExpiresAt;
  }

  async markStartAttempted(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
  }): Promise<void> {
    const updated = await this.db.asyncInferenceOp.updateMany({
      where: {
        id: input.operationId,
        identityVersion: 1,
        status: "pending",
        operationId: null,
        startAttemptedAt: null,
        startClaimFence: input.fence,
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: input.now },
      },
      data: {
        startAttemptedAt: input.now,
        startedAt: input.now,
      },
    });
    if (updated.count !== 1) throw new AsyncOperationLeaseLostError();
  }

  async releaseClaim(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
  }): Promise<void> {
    const updated = await this.db.asyncInferenceOp.updateMany({
      where: {
        id: input.operationId,
        identityVersion: 1,
        startClaimFence: input.fence,
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: input.now },
      },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
    if (updated.count !== 1) throw new AsyncOperationLeaseLostError();
  }

  async recordProviderStarted(input: {
    operationId: string;
    workerId: string;
    fence: number;
    providerOperationId: string;
    now: Date;
    checkpoint: Record<string, unknown>;
  }): Promise<AsyncOperationRecord> {
    if (input.providerOperationId.trim().length === 0) {
      throw new Error("ASYNC_OPERATION_PROVIDER_HANDLE_REQUIRED");
    }
    return this.transitionOwned({
      operationId: input.operationId,
      workerId: input.workerId,
      fence: input.fence,
      from: "pending",
      to: "running",
      now: input.now,
      checkpoint: input.checkpoint,
      data: { operationId: input.providerOperationId },
    });
  }

  async transitionOwned(input: {
    operationId: string;
    workerId: string;
    fence: number;
    from: AsyncInferenceOperationStatus;
    to: AsyncInferenceOperationStatus;
    now: Date;
    checkpoint: Record<string, unknown>;
    data?: Record<string, unknown>;
  }): Promise<AsyncOperationRecord> {
    assertAsyncOperationTransition(input.from, input.to);
    return this.db.$transaction(async (tx) => {
      const before = await tx.asyncInferenceOp.findUnique({ where: { id: input.operationId } });
      if (!before || before.identityVersion !== 1) throw new AsyncOperationLeaseLostError();
      if (
        parseAsyncInferenceOperationStatus(before.status) !== input.from
        || before.leaseOwner !== input.workerId
        || Number(before.startClaimFence) !== input.fence
        || !(before.leaseExpiresAt instanceof Date)
        || before.leaseExpiresAt <= input.now
      ) {
        throw new AsyncOperationLeaseLostError();
      }

      const nextSequence = Number(before.transitionSequence) + 1;
      const terminal = input.to === "completed"
        || input.to === "failed"
        || input.to === "cancelled"
        || input.to === "expired";
      const updated = await tx.asyncInferenceOp.updateMany({
        where: {
          id: input.operationId,
          identityVersion: 1,
          status: input.from,
          transitionSequence: before.transitionSequence,
          startClaimFence: input.fence,
          leaseOwner: input.workerId,
          leaseExpiresAt: { gt: input.now },
        },
        data: {
          ...(input.data ?? {}),
          status: input.to,
          transitionSequence: { increment: 1 },
          checkpointSequence: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(terminal
            ? { completedAt: input.now, nextPollAt: null }
            : {}),
        },
      });
      if (updated.count !== 1) throw new AsyncOperationLeaseLostError();
      await tx.asyncInferenceOperationTransition.create({
        data: {
          operationId: input.operationId,
          sequence: nextSequence,
          status: input.to,
          checkpoint: input.checkpoint as Prisma.InputJsonValue,
          occurredAt: input.now,
        },
      });
      const after = await tx.asyncInferenceOp.findUnique({ where: { id: input.operationId } });
      if (!after) throw new AsyncOperationLeaseLostError();
      return mapAsyncOperationRow(after);
    });
  }
}
