import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { AsyncInferenceOperationStatus } from "./async-operation-contract";
import type { AsyncOperationTransitionRecord } from "./async-operation-store";

export const ASYNC_OPERATION_TRANSITION_EVENT = "inference/async-operation.transitioned" as const;

export interface AsyncOperationTransitionEvent {
  eventId: string;
  name: typeof ASYNC_OPERATION_TRANSITION_EVENT;
  data: {
    operationId: string;
    sequence: number;
    status: AsyncInferenceOperationStatus;
    checkpoint: Record<string, unknown>;
    occurredAt: string;
  };
}

/**
 * Delivery attempts before a transition is dead-lettered (BI-6BB830E4): it is
 * then left undelivered (`deliveredAt` null, `deliveryAttempts` at the cap) and
 * no longer selected, so it cannot hold later transitions back. Consumers
 * re-read canonical operation state and the recovery cron reconciles
 * operations on its own, so a dead letter delays a wake-up; it loses no state.
 * At the two-minute outbox cadence the cap is about 48 minutes of retries.
 */
export const ASYNC_OPERATION_TRANSITION_DELIVERY_CAP = 24;

/** Two different operations failed and nothing was delivered: the transport is down, not a row. */
export class AsyncOperationOutboxUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`async-operation outbox transport unavailable: ${getErrorMessage(cause)}`, { cause });
    this.name = "AsyncOperationOutboxUnavailableError";
  }
}

export interface AsyncOperationOutboxStore {
  listUndeliveredTransitions(input?: { limit?: number; maxAttempts?: number }): Promise<AsyncOperationTransitionRecord[]>;
  markTransitionDeliveryAttempt(transitionId: string): Promise<boolean>;
  markTransitionDelivered(transitionId: string, deliveredAt: Date): Promise<void>;
}

export async function publishAsyncOperationTransitions(dependencies: {
  store: AsyncOperationOutboxStore;
  publish(event: AsyncOperationTransitionEvent): Promise<void>;
  now(): Date;
  limit?: number;
}): Promise<{ delivered: number; failed: number; deadLettered: string[] }> {
  const rows = await dependencies.store.listUndeliveredTransitions({
    limit: dependencies.limit,
    maxAttempts: ASYNC_OPERATION_TRANSITION_DELIVERY_CAP,
  });
  let delivered = 0;
  let failed = 0;
  const deadLettered: string[] = [];
  // A failed row holds back only its own operation's later transitions, so
  // per-operation order survives while other operations keep flowing.
  const heldOperations = new Set<string>();
  for (const row of rows) {
    if (heldOperations.has(row.operationId)) continue;
    // A concurrent publisher may have delivered this row after our snapshot.
    // Inngest also deduplicates the deterministic event id, but avoiding a
    // known-stale send keeps retries quieter and cheaper.
    const stillUndelivered = await dependencies.store.markTransitionDeliveryAttempt(row.id);
    if (!stillUndelivered) continue;
    try {
      await dependencies.publish({
        eventId: `async-operation:${row.operationId}:transition:${row.sequence}`,
        name: ASYNC_OPERATION_TRANSITION_EVENT,
        data: {
          operationId: row.operationId,
          sequence: row.sequence,
          status: row.status,
          checkpoint: row.checkpoint,
          occurredAt: row.occurredAt.toISOString(),
        },
      });
    } catch (error) {
      failed += 1;
      heldOperations.add(row.operationId);
      if (row.deliveryAttempts + 1 >= ASYNC_OPERATION_TRANSITION_DELIVERY_CAP) deadLettered.push(row.id);
      // Nothing delivered and a second operation failed too: stop the pass so
      // an outage spends two rows' attempts, not every row's.
      if (delivered === 0 && failed >= 2) throw new AsyncOperationOutboxUnavailableError(error);
      continue;
    }
    // Mark after publication: a crash in this window intentionally produces an
    // at-least-once duplicate carrying the same operation/sequence dedupe key.
    await dependencies.store.markTransitionDelivered(row.id, dependencies.now());
    delivered += 1;
  }
  if (deadLettered.length > 0) {
    console.warn(
      "[async-operation-outbox] dead-lettered %d transition(s) after %d attempts: %s",
      deadLettered.length,
      ASYNC_OPERATION_TRANSITION_DELIVERY_CAP,
      deadLettered.join(", "),
    );
  }
  return { delivered, failed, deadLettered };
}
