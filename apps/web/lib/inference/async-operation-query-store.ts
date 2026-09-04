import { isAsyncInferenceOperationTerminal, parseAsyncInferenceOperationStatus } from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  mapAsyncOperationRow,
  mapAsyncOperationTransition,
  type AsyncOperationDatabase,
  type AsyncOperationTransitionRecord,
} from "./async-operation-store-shared";

/**
 * Authority-scoped read, cancellation, and outbox operations. Keeping this
 * surface separate from worker lifecycle mutation makes the two consistency
 * domains reviewable without changing the public Prisma store API.
 */
export class PrismaAsyncOperationQueryStore {
  constructor(protected readonly db: AsyncOperationDatabase) {}

  async loadAuthorizedOperation(input: {
    authorityScopeKey: string;
    requestKey: string;
  }): Promise<AsyncOperationRecord | null> {
    const row = await this.db.asyncInferenceOp.findUnique({
      where: {
        authorityScopeKey_requestKey: {
          authorityScopeKey: input.authorityScopeKey,
          requestKey: input.requestKey,
        },
      },
    });
    if (!row || row.identityVersion !== 1) return null;
    return mapAsyncOperationRow(row);
  }

  async listAuthorizedOperations(input: {
    authorityScopeKey: string;
    after?: { createdAt: Date; operationId: string };
    limit?: number;
  }): Promise<AsyncOperationRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
    const rows = await this.db.asyncInferenceOp.findMany({
      where: {
        identityVersion: 1,
        authorityScopeKey: input.authorityScopeKey,
        ...(input.after
          ? {
              OR: [
                { createdAt: { lt: input.after.createdAt } },
                {
                  createdAt: input.after.createdAt,
                  id: { lt: input.after.operationId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(mapAsyncOperationRow);
  }

  async requestAuthorizedCancellation(input: {
    authorityScopeKey: string;
    requestKey: string;
    now: Date;
  }): Promise<AsyncOperationRecord | null> {
    type CancellationAttempt =
      | { kind: "done"; operation: AsyncOperationRecord | null }
      | { kind: "retry" };

    // A progress poll and a cancellation request can race on the monotonic
    // sequence. Retry a bounded number of fresh snapshots; never report success
    // when the cancellation bit was not actually persisted.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await this.db.$transaction<CancellationAttempt>(async (tx) => {
        const row = await tx.asyncInferenceOp.findUnique({
          where: {
            authorityScopeKey_requestKey: {
              authorityScopeKey: input.authorityScopeKey,
              requestKey: input.requestKey,
            },
          },
        });
        if (!row || row.identityVersion !== 1) {
          return { kind: "done", operation: null };
        }
        const status = parseAsyncInferenceOperationStatus(row.status);
        if (isAsyncInferenceOperationTerminal(status) || row.cancelRequestedAt) {
          return { kind: "done", operation: mapAsyncOperationRow(row) };
        }

        const nextSequence = Number(row.transitionSequence) + 1;
        const updated = await tx.asyncInferenceOp.updateMany({
          where: {
            id: row.id,
            identityVersion: 1,
            status,
            transitionSequence: row.transitionSequence,
            cancelRequestedAt: null,
          },
          data: {
            cancelRequestedAt: input.now,
            transitionSequence: { increment: 1 },
            checkpointSequence: { increment: 1 },
            // Revoke an in-flight lease so a worker with the old fence cannot
            // publish a result after cancellation became durable.
            startClaimFence: { increment: 1 },
            leaseOwner: null,
            leaseExpiresAt: null,
            nextPollAt: null,
          },
        });
        if (updated.count !== 1) return { kind: "retry" };
        await tx.asyncInferenceOperationTransition.create({
          data: {
            operationId: row.id,
            sequence: nextSequence,
            status,
            checkpoint: { phase: "cancellation-requested" },
            occurredAt: input.now,
          },
        });
        const after = await tx.asyncInferenceOp.findUnique({ where: { id: row.id } });
        if (!after) throw new Error("ASYNC_OPERATION_CANCEL_STATE_LOST");
        return { kind: "done", operation: mapAsyncOperationRow(after) };
      });
      if (outcome.kind === "done") return outcome.operation;
    }
    throw new Error("ASYNC_OPERATION_CANCEL_CONFLICT");
  }

  async listAuthorizedTransitions(input: {
    authorityScopeKey: string;
    requestKey: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<AsyncOperationTransitionRecord[]> {
    const operation = await this.db.asyncInferenceOp.findUnique({
      where: {
        authorityScopeKey_requestKey: {
          authorityScopeKey: input.authorityScopeKey,
          requestKey: input.requestKey,
        },
      },
    });
    if (!operation || operation.identityVersion !== 1) return [];
    const afterSequence = Math.max(-1, Math.floor(input.afterSequence ?? -1));
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
    const rows = await this.db.asyncInferenceOperationTransition.findMany({
      where: { operationId: operation.id, sequence: { gt: afterSequence } },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return rows.map(mapAsyncOperationTransition);
  }

  async listUndeliveredTransitions(input: {
    limit?: number;
  } = {}): Promise<AsyncOperationTransitionRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
    const rows = await this.db.asyncInferenceOperationTransition.findMany({
      where: { deliveredAt: null },
      orderBy: [{ occurredAt: "asc" }, { operationId: "asc" }, { sequence: "asc" }],
      take: limit,
    });
    return rows.map(mapAsyncOperationTransition);
  }

  async markTransitionDeliveryAttempt(transitionId: string): Promise<boolean> {
    const updated = await this.db.asyncInferenceOperationTransition.updateMany({
      where: { id: transitionId, deliveredAt: null },
      data: { deliveryAttempts: { increment: 1 } },
    });
    return updated.count === 1;
  }

  async markTransitionDelivered(transitionId: string, deliveredAt: Date): Promise<void> {
    await this.db.asyncInferenceOperationTransition.updateMany({
      where: { id: transitionId, deliveredAt: null },
      data: { deliveredAt },
    });
    // At-least-once publishing deliberately permits concurrent delivery of
    // the same deterministic event id. If another publisher acknowledged the
    // row first, this is already the desired terminal outbox state.
  }
}
