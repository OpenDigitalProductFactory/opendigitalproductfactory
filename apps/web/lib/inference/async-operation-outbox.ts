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

export interface AsyncOperationOutboxStore {
  listUndeliveredTransitions(input?: { limit?: number }): Promise<AsyncOperationTransitionRecord[]>;
  markTransitionDeliveryAttempt(transitionId: string): Promise<boolean>;
  markTransitionDelivered(transitionId: string, deliveredAt: Date): Promise<void>;
}

export async function publishAsyncOperationTransitions(dependencies: {
  store: AsyncOperationOutboxStore;
  publish(event: AsyncOperationTransitionEvent): Promise<void>;
  now(): Date;
  limit?: number;
}): Promise<{ delivered: number }> {
  const rows = await dependencies.store.listUndeliveredTransitions({
    limit: dependencies.limit,
  });
  let delivered = 0;
  for (const row of rows) {
    // A concurrent publisher may have delivered this row after our snapshot.
    // Inngest also deduplicates the deterministic event id, but avoiding a
    // known-stale send keeps retries quieter and cheaper.
    const stillUndelivered = await dependencies.store.markTransitionDeliveryAttempt(row.id);
    if (!stillUndelivered) continue;
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
    // Mark after publication: a crash in this window intentionally produces an
    // at-least-once duplicate carrying the same operation/sequence dedupe key.
    await dependencies.store.markTransitionDelivered(row.id, dependencies.now());
    delivered += 1;
  }
  return { delivered };
}
