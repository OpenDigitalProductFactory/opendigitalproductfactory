import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import {
  listPrismaAuthorizedAsyncOperations,
} from "@/lib/inference/async-operation-runtime";
import {
  parseAsyncInferenceOperationStatus,
} from "@/lib/inference/async-operation-contract";
import type { AsyncOperationAuthorityActor } from "@/lib/inference/async-operation-authority";
import type { AuthorizedAsyncOperationResult } from "@/lib/inference/async-operation-read-model";
import type { DeliveryTaskAsyncOperation } from "./delivery-task-hub";

export type DeliveryTaskAsyncTarget = {
  capsuleId: string;
  taskRunId: string | null;
};

type AuthorizedList = typeof listPrismaAuthorizedAsyncOperations;
type PrincipalResolver = typeof resolvePrincipalRecordIdForSessionIdentity;

type AsyncProjectionDependencies = {
  list?: AuthorizedList;
  resolvePrincipalId?: PrincipalResolver;
};

const MAX_PROGRESS_MESSAGE = 240;

function safeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= MAX_PROGRESS_MESSAGE
    ? trimmed
    : `${trimmed.slice(0, MAX_PROGRESS_MESSAGE - 1)}…`;
}

function safeProgress(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : undefined;
}

function newest(
  operations: AuthorizedAsyncOperationResult[],
): AuthorizedAsyncOperationResult | null {
  return [...operations].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.getTime() - left.updatedAt.getTime();
    return byUpdatedAt || right.operationId.localeCompare(left.operationId);
  })[0] ?? null;
}

function project(operation: AuthorizedAsyncOperationResult): DeliveryTaskAsyncOperation {
  const progressPct = safeProgress(operation.progressPct);
  const progressMessage = safeMessage(operation.progressMessage);
  return {
    coreHandleAvailable: true,
    operationId: operation.operationId,
    status: parseAsyncInferenceOperationStatus(operation.status),
    observedAt: operation.updatedAt.toISOString(),
    ...(progressPct === undefined ? {} : { progressPct }),
    ...(progressMessage === undefined ? {} : { progressMessage }),
  };
}

/**
 * Read at most one operation from each legal semantic scope. Authorization is
 * enforced by the core adapter; a denied or unavailable scope fails closed for
 * this row and cannot fail the rest of the bounded Hub page.
 */
export async function readDeliveryTaskAsyncOperation(
  target: DeliveryTaskAsyncTarget,
  actor: AsyncOperationAuthorityActor,
  dependencies: Pick<AsyncProjectionDependencies, "list"> = {},
): Promise<DeliveryTaskAsyncOperation> {
  const list = dependencies.list ?? listPrismaAuthorizedAsyncOperations;
  const targets = [
    ...(target.taskRunId
      ? [{ kind: "task-run" as const, taskRunId: target.taskRunId }]
      : []),
    { kind: "workroom" as const, workroomId: target.capsuleId },
  ];
  const results = await Promise.allSettled(targets.map((authorityTarget) =>
    list({ target: authorityTarget, actor, limit: 1 })));
  const operations = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value.operations.slice(0, 1) : []);
  const selected = newest(operations);
  if (!selected) return { coreHandleAvailable: false };
  try {
    return project(selected);
  } catch {
    return { coreHandleAvailable: false };
  }
}

/** Resolve session identity once, then close over it for every bounded row. */
export async function createDeliveryTaskHubAsyncProjectionLoader(
  user: { id: string; isSuperuser?: boolean | null },
  dependencies: AsyncProjectionDependencies = {},
): Promise<(target: DeliveryTaskAsyncTarget) => Promise<DeliveryTaskAsyncOperation>> {
  const resolvePrincipalId = dependencies.resolvePrincipalId
    ?? resolvePrincipalRecordIdForSessionIdentity;
  let principalId: string | null = null;
  try {
    principalId = await resolvePrincipalId({ type: "admin", id: user.id });
  } catch {
    // User id still provides exact TaskRun authority. Principal lookup failure
    // must not widen authority or turn into a cross-row page failure.
  }
  const actor: AsyncOperationAuthorityActor = {
    userId: user.id,
    agentId: null,
    principalId,
    isSuperuser: user.isSuperuser === true,
  };
  return (target) => readDeliveryTaskAsyncOperation(target, actor, dependencies);
}
