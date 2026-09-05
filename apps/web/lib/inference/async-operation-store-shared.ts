import {
  parseAsyncInferenceOperationStatus,
  type AsyncInferenceOperationStatus,
} from "./async-operation-contract";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";

export type AsyncOperationQueryArgs = Record<string, unknown>;

interface AsyncOperationDelegate {
  findUnique(args: AsyncOperationQueryArgs): Promise<any>;
  findMany(args: AsyncOperationQueryArgs): Promise<any[]>;
  create(args: AsyncOperationQueryArgs): Promise<any>;
  updateMany(args: AsyncOperationQueryArgs): Promise<{ count: number }>;
}

interface AsyncOperationTransitionDelegate {
  create(args: AsyncOperationQueryArgs): Promise<any>;
  findMany(args: AsyncOperationQueryArgs): Promise<any[]>;
  updateMany(args: AsyncOperationQueryArgs): Promise<{ count: number }>;
}

export interface AsyncOperationDatabase {
  asyncInferenceOp: AsyncOperationDelegate;
  asyncInferenceOperationTransition: AsyncOperationTransitionDelegate;
  $transaction<T>(work: (tx: AsyncOperationDatabase) => Promise<T>): Promise<T>;
}

export interface AsyncOperationLeaseClaim {
  operationId: string;
  workerId: string;
  fence: number;
  leaseExpiresAt: Date;
}

export interface AsyncOperationTransitionRecord {
  id: string;
  operationId: string;
  sequence: number;
  status: AsyncInferenceOperationStatus;
  checkpoint: Record<string, unknown>;
  occurredAt: Date;
  deliveryAttempts: number;
  deliveredAt: Date | null;
}

export class AsyncOperationLeaseLostError extends Error {
  constructor() {
    super("ASYNC_OPERATION_LEASE_LOST");
    this.name = "AsyncOperationLeaseLostError";
  }
}

export function requiredAsyncOperationString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid durable async operation ${name}`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid durable async operation date");
  return date;
}

function requiredDate(value: unknown, name: string): Date {
  const date = nullableDate(value);
  if (!date) throw new Error(`Invalid durable async operation ${name}`);
  return date;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid durable async operation ${name}`);
  }
  return number;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid durable async operation number");
  return number;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function mapAsyncOperationRow(row: any): AsyncOperationRecord {
  return {
    id: requiredAsyncOperationString(row.id, "id"),
    authorityScopeKey: requiredAsyncOperationString(row.authorityScopeKey, "authority scope"),
    requestKey: requiredAsyncOperationString(row.requestKey, "request key"),
    requestDigest: requiredAsyncOperationString(row.requestDigest, "request digest"),
    bindingDigest: requiredAsyncOperationString(row.bindingDigest, "binding digest"),
    providerId: requiredAsyncOperationString(row.providerId, "provider"),
    modelId: requiredAsyncOperationString(row.modelId, "model"),
    contractFamily: requiredAsyncOperationString(row.contractFamily, "contract family"),
    screenedRequestContext: jsonRecord(row.requestContext),
    taskRunId: nullableString(row.taskRunId),
    workroomId: nullableString(row.workroomId),
    status: parseAsyncInferenceOperationStatus(row.status),
    providerOperationId: nullableString(row.operationId),
    checkpointSequence: nonNegativeInteger(row.checkpointSequence, "checkpoint sequence"),
    transitionSequence: nonNegativeInteger(row.transitionSequence, "transition sequence"),
    startClaimFence: nonNegativeInteger(row.startClaimFence, "start claim fence"),
    startAttemptedAt: nullableDate(row.startAttemptedAt),
    leaseOwner: nullableString(row.leaseOwner),
    leaseExpiresAt: nullableDate(row.leaseExpiresAt),
    cancelRequestedAt: nullableDate(row.cancelRequestedAt),
    nextPollAt: nullableDate(row.nextPollAt),
    resultText: nullableString(row.resultText),
    resultData: row.resultData == null ? null : jsonRecord(row.resultData),
    errorMessage: nullableString(row.errorMessage),
    progressPct: nullableNumber(row.progressPct),
    progressMessage: nullableString(row.progressMessage),
    createdAt: requiredDate(row.createdAt, "created at"),
    updatedAt: requiredDate(row.updatedAt, "updated at"),
    startedAt: nullableDate(row.startedAt),
    completedAt: nullableDate(row.completedAt),
    expiresAt: requiredDate(row.expiresAt, "expiry"),
  };
}

export function mapAsyncOperationTransition(row: any): AsyncOperationTransitionRecord {
  return {
    id: requiredAsyncOperationString(row.id, "transition id"),
    operationId: requiredAsyncOperationString(row.operationId, "transition operation id"),
    sequence: nonNegativeInteger(row.sequence, "transition sequence"),
    status: parseAsyncInferenceOperationStatus(row.status),
    checkpoint: jsonRecord(row.checkpoint),
    occurredAt: requiredDate(row.occurredAt, "transition occurrence"),
    deliveryAttempts: nonNegativeInteger(row.deliveryAttempts ?? 0, "transition delivery attempts"),
    deliveredAt: nullableDate(row.deliveredAt),
  };
}
