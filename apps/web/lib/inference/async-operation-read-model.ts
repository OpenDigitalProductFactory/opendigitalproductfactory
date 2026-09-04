import {
  resolveServerOwnedAsyncOperationAuthority,
  type AsyncOperationAuthorityActor,
  type AsyncOperationAuthorityDatabase,
  type AsyncOperationAuthorityTarget,
  type ResolvedAsyncOperationAuthority,
} from "./async-operation-authority";
import type { AsyncInferenceOperationStatus } from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import type { AsyncOperationTransitionRecord } from "./async-operation-store";

const MAX_RECONCILIATION_TRANSITIONS = 100;

export interface AsyncOperationReadStore {
  listAuthorizedOperations(input: {
    authorityScopeKey: string;
    after?: { createdAt: Date; operationId: string };
    limit?: number;
  }): Promise<AsyncOperationRecord[]>;
  loadAuthorizedOperation(input: {
    authorityScopeKey: string;
    requestKey: string;
  }): Promise<AsyncOperationRecord | null>;
  listAuthorizedTransitions(input: {
    authorityScopeKey: string;
    requestKey: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<AsyncOperationTransitionRecord[]>;
  requestAuthorizedCancellation(input: {
    authorityScopeKey: string;
    requestKey: string;
    now: Date;
  }): Promise<AsyncOperationRecord | null>;
}

export interface AsyncOperationReadDependencies {
  db: AsyncOperationAuthorityDatabase;
  store: AsyncOperationReadStore;
}

export interface AuthorizedAsyncOperationResult {
  operationId: string;
  requestKey: string;
  requestDigest: string;
  status: AsyncInferenceOperationStatus;
  providerId: string;
  modelId: string;
  providerOperationId: string | null;
  contractFamily: string;
  checkpointSequence: number;
  transitionSequence: number;
  progressPct: number | null;
  progressMessage: string | null;
  resultText: string | null;
  resultData: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface AuthorizedAsyncOperationCursor {
  createdAt: string;
  operationId: string;
}

function requiredRequestKey(value: string): string {
  const requestKey = value.trim();
  if (!requestKey) throw new Error("ASYNC_OPERATION_REQUEST_KEY_INVALID");
  return requestKey;
}

function parseListCursor(
  value: AuthorizedAsyncOperationCursor | undefined,
): { createdAt: Date; operationId: string } | undefined {
  if (!value) return undefined;
  const createdAt = new Date(value.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || value.operationId.trim().length === 0) {
    throw new Error("ASYNC_OPERATION_CURSOR_INVALID");
  }
  return { createdAt, operationId: value.operationId };
}

function authorityScopeKey(authority: ResolvedAsyncOperationAuthority): string {
  return authority.kind === "task-run"
    ? `task-run:${authority.taskRunId}`
    : `workroom:${authority.workroomId}`;
}

function presentOperation(operation: AsyncOperationRecord): AuthorizedAsyncOperationResult {
  return {
    operationId: operation.id,
    requestKey: operation.requestKey,
    requestDigest: operation.requestDigest,
    status: operation.status,
    providerId: operation.providerId,
    modelId: operation.modelId,
    providerOperationId: operation.providerOperationId,
    contractFamily: operation.contractFamily,
    checkpointSequence: operation.checkpointSequence,
    transitionSequence: operation.transitionSequence,
    progressPct: operation.progressPct,
    progressMessage: operation.progressMessage,
    resultText: operation.resultText,
    resultData: operation.resultData,
    errorMessage: operation.errorMessage,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    expiresAt: operation.expiresAt,
  };
}

async function resolveReadScope(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  requestKey: string;
}, dependencies: AsyncOperationReadDependencies): Promise<{
  authorityScopeKey: string;
  requestKey: string;
}> {
  const authority = await resolveServerOwnedAsyncOperationAuthority({
    target: input.target,
    actor: input.actor,
    db: dependencies.db,
  });
  return {
    authorityScopeKey: authorityScopeKey(authority),
    requestKey: requiredRequestKey(input.requestKey),
  };
}

/** List durable handles only after resolving the caller's semantic authority. */
export async function listAuthorizedAsyncOperations(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  after?: AuthorizedAsyncOperationCursor;
  limit?: number;
}, dependencies: AsyncOperationReadDependencies): Promise<{
  operations: AuthorizedAsyncOperationResult[];
  nextCursor: AuthorizedAsyncOperationCursor | null;
}> {
  const authority = await resolveServerOwnedAsyncOperationAuthority({
    target: input.target,
    actor: input.actor,
    db: dependencies.db,
  });
  const limit = Math.min(
    MAX_RECONCILIATION_TRANSITIONS,
    Math.max(1, Math.floor(input.limit ?? 50)),
  );
  const rows = await dependencies.store.listAuthorizedOperations({
    authorityScopeKey: authorityScopeKey(authority),
    after: parseListCursor(input.after),
    limit,
  });
  const last = rows.at(-1);
  return {
    operations: rows.map(presentOperation),
    nextCursor: last
      ? { createdAt: last.createdAt.toISOString(), operationId: last.id }
      : null,
  };
}

/**
 * Reconcile progress/result only through the durable TaskRun/Workroom binding.
 * This boundary deliberately has no operation-id parameter.
 */
export async function readAuthorizedAsyncOperation(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  requestKey: string;
  afterSequence?: number;
  limit?: number;
}, dependencies: AsyncOperationReadDependencies): Promise<{
  operation: AuthorizedAsyncOperationResult;
  transitions: AsyncOperationTransitionRecord[];
  nextCursor: number;
}> {
  const scope = await resolveReadScope(input, dependencies);
  const operation = await dependencies.store.loadAuthorizedOperation(scope);
  if (!operation) throw new Error("ASYNC_OPERATION_NOT_FOUND");
  const limit = Math.min(
    MAX_RECONCILIATION_TRANSITIONS,
    Math.max(1, Math.floor(input.limit ?? 50)),
  );
  const transitions = await dependencies.store.listAuthorizedTransitions({
    ...scope,
    afterSequence: Math.max(-1, Math.floor(input.afterSequence ?? -1)),
    limit,
  });
  return {
    operation: presentOperation(operation),
    transitions,
    nextCursor: transitions.at(-1)?.sequence ?? Math.max(-1, Math.floor(input.afterSequence ?? -1)),
  };
}

export async function requestAuthorizedAsyncOperationCancellation(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  requestKey: string;
  now: Date;
}, dependencies: AsyncOperationReadDependencies): Promise<AuthorizedAsyncOperationResult> {
  const scope = await resolveReadScope(input, dependencies);
  const operation = await dependencies.store.requestAuthorizedCancellation({
    ...scope,
    now: input.now,
  });
  if (!operation) throw new Error("ASYNC_OPERATION_NOT_FOUND");
  return presentOperation(operation);
}
