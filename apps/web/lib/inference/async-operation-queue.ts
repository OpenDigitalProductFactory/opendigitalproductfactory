import { isAsyncInferenceOperationTerminal } from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import type { AsyncOperationWorkerResult } from "./async-operation-worker";
import { ASYNC_INFERENCE_INDETERMINATE_RETRY_MS } from "./async-operation-constants";

const MINIMUM_WAKE_DELAY_MS = 1_000;

export interface AsyncOperationWake {
  operationId: string;
  notBefore: Date;
}

export interface AsyncOperationWakeDependencies {
  runWorker(input: {
    operationId: string;
    workerId: string;
  }): Promise<AsyncOperationWorkerResult>;
  loadForWorker(operationId: string): Promise<AsyncOperationRecord | null>;
  enqueue(wake: AsyncOperationWake): Promise<void>;
  now(): Date;
}

function nextWakeAt(operation: AsyncOperationRecord, now: Date): Date {
  const minimumDelay = operation.status === "start_indeterminate"
    ? ASYNC_INFERENCE_INDETERMINATE_RETRY_MS
    : MINIMUM_WAKE_DELAY_MS;
  let next = new Date(now.getTime() + minimumDelay);
  if (operation.nextPollAt && operation.nextPollAt > next) next = operation.nextPollAt;
  if (operation.leaseExpiresAt && operation.leaseExpiresAt > next) next = operation.leaseExpiresAt;
  return next;
}

/**
 * Run one bounded lifecycle step and schedule only the next durable identity.
 * Queue delivery is advisory: the row, lease, and fence remain authoritative.
 */
export async function runAsyncOperationWake(
  input: { operationId: string; workerId: string },
  dependencies: AsyncOperationWakeDependencies,
): Promise<AsyncOperationWorkerResult & { nextWakeAt: Date | null }> {
  const result = await dependencies.runWorker(input);
  // A busy wake is already represented by the current fenced owner. Enqueuing
  // another advisory wake here amplifies duplicates; the owner or bounded cron
  // recovery is responsible for the next durable due interval.
  if (result.disposition === "busy") {
    return { ...result, nextWakeAt: null };
  }
  const operation = await dependencies.loadForWorker(input.operationId);
  if (!operation || isAsyncInferenceOperationTerminal(operation.status)) {
    return { ...result, nextWakeAt: null };
  }

  const wakeAt = nextWakeAt(operation, dependencies.now());
  await dependencies.enqueue({ operationId: operation.id, notBefore: wakeAt });
  return { ...result, nextWakeAt: wakeAt };
}

export interface AsyncOperationWakeReconciliationDependencies {
  listRecoverableOperationIds(input: { now: Date; limit: number }): Promise<string[]>;
  enqueue(wake: AsyncOperationWake): Promise<void>;
  now(): Date;
}

/** Recover advisory queue loss from authoritative due rows, never by provider identity. */
export async function reconcileAsyncOperationWakes(
  input: { limit?: number },
  dependencies: AsyncOperationWakeReconciliationDependencies,
): Promise<{ inspected: number; enqueued: number }> {
  const now = dependencies.now();
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const operationIds = await dependencies.listRecoverableOperationIds({ now, limit });
  for (const operationId of operationIds) {
    await dependencies.enqueue({ operationId, notBefore: now });
  }
  return { inspected: operationIds.length, enqueued: operationIds.length };
}
