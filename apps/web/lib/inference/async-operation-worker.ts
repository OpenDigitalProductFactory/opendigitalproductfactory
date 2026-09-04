import {
  isAsyncInferenceOperationTerminal,
  type AsyncInferenceOperationStatus,
} from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import { ASYNC_INFERENCE_INDETERMINATE_RETRY_MS } from "./async-operation-constants";
import {
  AsyncOperationLeaseLostError,
  type AsyncOperationLeaseClaim,
} from "./async-operation-store";

const DEFAULT_LEASE_MS = 45_000;

export interface AsyncOperationWorkerStore {
  loadForWorker(operationId: string): Promise<AsyncOperationRecord | null>;
  claimOperation(input: {
    operationId: string;
    workerId: string;
    now: Date;
    leaseDurationMs: number;
    allowedStatuses: readonly AsyncInferenceOperationStatus[];
  }): Promise<AsyncOperationLeaseClaim | null>;
  renewClaim(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<Date>;
  markStartAttempted(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
  }): Promise<void>;
  releaseClaim(input: {
    operationId: string;
    workerId: string;
    fence: number;
    now: Date;
  }): Promise<void>;
  recordProviderStarted(input: {
    operationId: string;
    workerId: string;
    fence: number;
    providerOperationId: string;
    now: Date;
    checkpoint: Record<string, unknown>;
  }): Promise<AsyncOperationRecord>;
  transitionOwned(input: {
    operationId: string;
    workerId: string;
    fence: number;
    from: AsyncInferenceOperationStatus;
    to: AsyncInferenceOperationStatus;
    now: Date;
    checkpoint: Record<string, unknown>;
    data?: Record<string, unknown>;
  }): Promise<AsyncOperationRecord>;
}

export class AsyncProviderStartError extends Error {
  constructor(
    message: string,
    readonly boundary: "definite-rejection" | "ambiguous",
  ) {
    super(message);
    this.name = "AsyncProviderStartError";
  }
}

export class AsyncProviderPollError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "AsyncProviderPollError";
  }
}

export type AsyncProviderPollResult =
  | {
      kind: "running";
      progressPct?: number;
      progressMessage?: string;
      nextPollAt?: Date;
      checkpoint?: Record<string, unknown>;
    }
  | {
      kind: "completed";
      text?: string;
      data?: Record<string, unknown>;
    }
  | {
      kind: "failed";
      error: string;
    }
  | {
      kind: "cancelled";
      reason?: string;
    };

export type AsyncProviderStartReconciliation =
  | { kind: "matched"; providerOperationId: string }
  | { kind: "failed"; error: string }
  | { kind: "unresolved" };

export interface AsyncOperationWorkerDependencies {
  store: AsyncOperationWorkerStore;
  now(): Date;
  startProvider(operation: AsyncOperationRecord): Promise<{ providerOperationId: string }>;
  pollProvider(operation: AsyncOperationRecord): Promise<AsyncProviderPollResult>;
  reconcileIndeterminateStart(operation: AsyncOperationRecord): Promise<AsyncProviderStartReconciliation>;
}

export type AsyncOperationWorkerResult = {
  status: AsyncInferenceOperationStatus;
  disposition:
    | "not-found"
    | "terminal"
    | "busy"
    | "started"
    | "start-indeterminate"
    | "reconciled"
    | "reconciliation-pending"
    | "progress"
    | "retry"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
};

const SAFE_DURABLE_PROVIDER_ERRORS = new Set([
  "ASYNC_PROVIDER_POLL_TRANSIENT_FAILURE",
  "ASYNC_PROVIDER_POLL_PERMANENT_FAILURE",
  "ASYNC_PROVIDER_REPORTED_FAILURE",
  "ASYNC_PROVIDER_START_INDETERMINATE",
  "ASYNC_PROVIDER_START_RECONCILIATION_FAILED",
  "ASYNC_PROVIDER_START_REJECTED",
]);

function durableProviderError(
  value: unknown,
  fallback: string,
): string {
  return typeof value === "string" && SAFE_DURABLE_PROVIDER_ERRORS.has(value)
    ? value
    : fallback;
}

function boundedRetryAt(now: Date, checkpointSequence: number): Date {
  const exponent = Math.min(5, Math.max(0, checkpointSequence));
  return new Date(now.getTime() + Math.min(30_000, 1_000 * (2 ** exponent)));
}

function indeterminateRetryAt(now: Date): Date {
  return new Date(now.getTime() + ASYNC_INFERENCE_INDETERMINATE_RETRY_MS);
}

function transition(
  dependencies: AsyncOperationWorkerDependencies,
  operation: AsyncOperationRecord,
  claim: AsyncOperationLeaseClaim,
  now: Date,
  to: AsyncInferenceOperationStatus,
  checkpoint: Record<string, unknown>,
  data?: Record<string, unknown>,
): Promise<AsyncOperationRecord> {
  return dependencies.store.transitionOwned({
    operationId: operation.id,
    workerId: claim.workerId,
    fence: claim.fence,
    from: operation.status,
    to,
    now,
    checkpoint,
    ...(data ? { data } : {}),
  });
}

/**
 * Keep the exact fenced claim alive while the one bounded provider request is
 * pending. If renewal fails, stop trusting the result: a successor may already
 * own the row and only its fence may publish the provider outcome.
 */
async function withClaimHeartbeat<T>(
  dependencies: AsyncOperationWorkerDependencies,
  claim: AsyncOperationLeaseClaim,
  leaseDurationMs: number,
  action: () => Promise<T>,
): Promise<T> {
  const heartbeatEveryMs = Math.max(10, Math.floor(leaseDurationMs / 3));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeRenewal: Promise<void> | null = null;
  let renewalFailure: unknown;
  let rejectLeaseLoss!: (error: unknown) => void;
  const leaseLoss = new Promise<never>((_, reject) => {
    rejectLeaseLoss = reject;
  });

  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      activeRenewal = dependencies.store.renewClaim({
        operationId: claim.operationId,
        workerId: claim.workerId,
        fence: claim.fence,
        now: dependencies.now(),
        leaseDurationMs,
      }).then(() => {
        if (!stopped) schedule();
      }).catch((error: unknown) => {
        renewalFailure = error;
        rejectLeaseLoss(error);
      });
    }, heartbeatEveryMs);
  };

  schedule();
  try {
    const result = await Promise.race([action(), leaseLoss]);
    stopped = true;
    if (timer) clearTimeout(timer);
    if (activeRenewal) await activeRenewal;
    if (renewalFailure) throw renewalFailure;
    return result;
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute one bounded durable step. Inngest retries this function, but only the
 * persisted lease/fence and start-attempt boundary decide whether a provider
 * side effect is legal.
 */
export async function runDurableAsyncOperationWorker(
  input: { operationId: string; workerId: string; leaseDurationMs?: number },
  dependencies: AsyncOperationWorkerDependencies,
): Promise<AsyncOperationWorkerResult> {
  let operation = await dependencies.store.loadForWorker(input.operationId);
  if (!operation) return { status: "failed", disposition: "not-found" };
  if (isAsyncInferenceOperationTerminal(operation.status)) {
    return { status: operation.status, disposition: "terminal" };
  }

  const now = dependencies.now();
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const claim = await dependencies.store.claimOperation({
    operationId: operation.id,
    workerId: input.workerId,
    now,
    leaseDurationMs,
    allowedStatuses: [operation.status],
  });
  if (!claim) return { status: operation.status, disposition: "busy" };

  // The pre-claim read is only a scheduling hint. Re-read the fenced row after
  // the CAS claim so cancellation, expiry, or a crossed start boundary that
  // became durable between load and claim cannot be missed before provider I/O.
  const claimedOperation = await dependencies.store.loadForWorker(operation.id);
  if (
    !claimedOperation
    || claimedOperation.status !== operation.status
    || claimedOperation.startClaimFence !== claim.fence
    || claimedOperation.leaseOwner !== claim.workerId
    || !claimedOperation.leaseExpiresAt
    || claimedOperation.leaseExpiresAt <= now
  ) {
    return {
      status: claimedOperation?.status ?? operation.status,
      disposition: "busy",
    };
  }
  operation = claimedOperation;

  // Cancellation and expiry are checked under the fenced lease before every
  // provider call. They never cross the start boundary.
  if (operation.cancelRequestedAt) {
    await transition(dependencies, operation, claim, now, "cancelled", {
      phase: "cancelled-before-provider-call",
    });
    return { status: "cancelled", disposition: "cancelled" };
  }
  if (now >= operation.expiresAt) {
    await transition(dependencies, operation, claim, now, "expired", {
      phase: "expired-before-provider-call",
    });
    return { status: "expired", disposition: "expired" };
  }

  if (operation.status === "pending") {
    // A prior owner crossed the durable attempt boundary. Whether its network
    // request arrived is unknowable, so repeating POST is prohibited.
    if (operation.startAttemptedAt) {
      await transition(dependencies, operation, claim, now, "start_indeterminate", {
        phase: "start-attempt-without-durable-provider-handle",
        attemptedAt: operation.startAttemptedAt.toISOString(),
      }, { nextPollAt: indeterminateRetryAt(now) });
      return { status: "start_indeterminate", disposition: "start-indeterminate" };
    }

    await dependencies.store.markStartAttempted({
      operationId: operation.id,
      workerId: claim.workerId,
      fence: claim.fence,
      now,
    });
    let started: { providerOperationId: string };
    try {
      started = await withClaimHeartbeat(
        dependencies,
        claim,
        leaseDurationMs,
        () => dependencies.startProvider(operation),
      );
    } catch (error) {
      if (error instanceof AsyncOperationLeaseLostError) throw error;
      const failedAt = dependencies.now();
      const definite = error instanceof AsyncProviderStartError
        && error.boundary === "definite-rejection";
      const target = definite ? "failed" : "start_indeterminate";
      const safeError = definite
        ? "ASYNC_PROVIDER_START_REJECTED"
        : "ASYNC_PROVIDER_START_INDETERMINATE";
      await transition(dependencies, operation, claim, failedAt, target, {
        phase: definite ? "provider-start-rejected" : "provider-start-ambiguous",
        error: safeError,
      }, definite
        ? { errorMessage: safeError }
        : { nextPollAt: indeterminateRetryAt(failedAt) });
      return {
        status: target,
        disposition: definite ? "failed" : "start-indeterminate",
      };
    }

    const providerReturnedAt = dependencies.now();
    // Keep persistence failures outside the provider-error classifier. A lost
    // fence is not evidence about whether the POST crossed; the next owner sees
    // startAttemptedAt and moves the row to start_indeterminate without another
    // provider request.
    await dependencies.store.recordProviderStarted({
      operationId: operation.id,
      workerId: claim.workerId,
      fence: claim.fence,
      providerOperationId: started.providerOperationId,
      now: providerReturnedAt,
      checkpoint: {
        phase: "provider-started",
        providerId: operation.providerId,
        modelId: operation.modelId,
        providerOperationId: started.providerOperationId,
      },
    });
    return { status: "running", disposition: "started" };
  }

  if (operation.status === "start_indeterminate") {
    const reconciled = await withClaimHeartbeat(
      dependencies,
      claim,
      leaseDurationMs,
      () => dependencies.reconcileIndeterminateStart(operation),
    );
    const reconciledAt = dependencies.now();
    if (reconciled.kind === "unresolved") {
      await transition(
        dependencies,
        operation,
        claim,
        reconciledAt,
        "start_indeterminate",
        { phase: "provider-start-reconciliation-pending" },
        { nextPollAt: indeterminateRetryAt(reconciledAt) },
      );
      return { status: "start_indeterminate", disposition: "reconciliation-pending" };
    }
    if (reconciled.kind === "failed") {
      const safeError = durableProviderError(
        reconciled.error,
        "ASYNC_PROVIDER_START_RECONCILIATION_FAILED",
      );
      await transition(dependencies, operation, claim, reconciledAt, "failed", {
        phase: "provider-start-reconciliation-failed",
        error: safeError,
      }, { errorMessage: safeError });
      return { status: "failed", disposition: "failed" };
    }
    await transition(dependencies, operation, claim, reconciledAt, "running", {
      phase: "provider-start-reconciled",
      providerOperationId: reconciled.providerOperationId,
    }, { operationId: reconciled.providerOperationId });
    return { status: "running", disposition: "reconciled" };
  }

  // The closed parser makes this branch exactly "running".
  if (!operation.providerOperationId) {
    // Database checks protect new rows, but this explicit refusal also protects
    // callers from a malformed mock, stale generated client, or drifted store.
    const error = "ASYNC_OPERATION_RUNNING_WITHOUT_PROVIDER_HANDLE";
    await transition(dependencies, operation, claim, now, "failed", {
      phase: "invalid-running-state",
      error,
    }, { errorMessage: error });
    return { status: "failed", disposition: "failed" };
  }

  let polled: AsyncProviderPollResult;
  try {
    polled = await withClaimHeartbeat(
      dependencies,
      claim,
      leaseDurationMs,
      () => dependencies.pollProvider(operation),
    );
  } catch (error) {
    if (error instanceof AsyncOperationLeaseLostError) throw error;
    const failedAt = dependencies.now();
    if (!(error instanceof AsyncProviderPollError) || error.retryable) {
      const safeError = durableProviderError(
        error instanceof Error ? error.message : null,
        "ASYNC_PROVIDER_POLL_TRANSIENT_FAILURE",
      );
      await transition(dependencies, operation, claim, failedAt, "running", {
        phase: "provider-poll-transient-failure",
        error: safeError,
      }, {
        nextPollAt: boundedRetryAt(failedAt, operation.checkpointSequence),
        progressMessage: "Provider poll will retry",
      });
      return { status: "running", disposition: "retry" };
    }
    const safeError = durableProviderError(
      error.message,
      "ASYNC_PROVIDER_POLL_PERMANENT_FAILURE",
    );
    await transition(dependencies, operation, claim, failedAt, "failed", {
      phase: "provider-poll-permanent-failure",
      error: safeError,
    }, { errorMessage: safeError });
    return { status: "failed", disposition: "failed" };
  }

  const polledAt = dependencies.now();
  if (polled.kind === "completed") {
      await transition(dependencies, operation, claim, polledAt, "completed", {
        phase: "provider-completed",
        providerId: operation.providerId,
        modelId: operation.modelId,
        providerOperationId: operation.providerOperationId,
        requestDigest: operation.requestDigest,
      }, {
        resultText: polled.text ?? null,
        resultData: polled.data ?? {},
        progressPct: 100,
        progressMessage: "Complete",
      });
      return { status: "completed", disposition: "completed" };
  }
  if (polled.kind === "failed") {
      const safeError = durableProviderError(
        polled.error,
        "ASYNC_PROVIDER_REPORTED_FAILURE",
      );
      await transition(dependencies, operation, claim, polledAt, "failed", {
        phase: "provider-failed",
        error: safeError,
      }, { errorMessage: safeError });
      return { status: "failed", disposition: "failed" };
  }
  if (polled.kind === "cancelled") {
      await transition(dependencies, operation, claim, polledAt, "cancelled", {
        phase: "provider-cancelled",
      });
      return { status: "cancelled", disposition: "cancelled" };
  }
  await transition(dependencies, operation, claim, polledAt, "running", {
      phase: "provider-progress",
    }, {
      ...(polled.progressPct === undefined ? {} : { progressPct: polled.progressPct }),
      progressMessage: "Provider operation in progress",
      nextPollAt: polled.nextPollAt ?? boundedRetryAt(polledAt, operation.checkpointSequence),
    });
  return { status: "running", disposition: "progress" };
}
