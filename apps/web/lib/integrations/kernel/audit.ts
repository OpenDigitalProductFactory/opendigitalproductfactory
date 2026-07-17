import { createHash, randomUUID } from "node:crypto";

import type { ConnectorErrorKind } from "./error";
import { redactConnectorText } from "./redaction";

export const CONNECTOR_AUDIT_OPERATIONS = [
  "connect", "disconnect", "health", "refresh", "sync", "callback",
] as const;
export type ConnectorAuditOperation = (typeof CONNECTOR_AUDIT_OPERATIONS)[number];

export interface ConnectorAuditActor {
  coworkerId: string;
  userId: string | null;
}

export interface ConnectorAuditCreateData {
  calledAt: Date;
  integration: string;
  coworkerId: string;
  userId: string | null;
  toolName: ConnectorAuditOperation;
  argsHash: string;
  responseKind: string;
  resultCount: number | null;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ConnectorAuditRepository {
  create(args: { data: ConnectorAuditCreateData }): Promise<unknown>;
}

export interface ConnectorAuditInput {
  connectorId: string;
  actor: ConnectorAuditActor;
  operation: ConnectorAuditOperation;
  redactedInput: unknown;
  responseKind: string;
  resultCount?: number | null;
  durationMs: number;
  error?: {
    kind: ConnectorErrorKind;
    safeMessage: string;
    sensitiveValues?: readonly string[];
  } | null;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** Hashes only the adapter-redacted request. Raw callback bodies and credentials must never be passed here. */
export function canonicalRedactedHash(redactedInput: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(redactedInput)) ?? "null")
    .digest("hex");
}

function auditData(input: ConnectorAuditInput, calledAt: Date): ConnectorAuditCreateData {
  return {
    calledAt,
    integration: input.connectorId,
    coworkerId: input.actor.coworkerId,
    userId: input.actor.userId,
    toolName: input.operation,
    argsHash: canonicalRedactedHash(input.redactedInput),
    responseKind: input.responseKind,
    resultCount: input.resultCount ?? null,
    durationMs: input.durationMs,
    errorCode: input.error?.kind ?? null,
    errorMessage: input.error
      ? redactConnectorText(input.error.safeMessage, input.error.sensitiveValues)
      : null,
  };
}

export function createDurableConnectorAudit(dependencies: {
  repository: ConnectorAuditRepository;
  now?: () => Date;
}) {
  return {
    async record(input: ConnectorAuditInput): Promise<void> {
      try {
        await dependencies.repository.create({ data: auditData(input, dependencies.now?.() ?? new Date()) });
      } catch (cause) {
        throw new ConnectorAuditPersistenceError(cause);
      }
    },
  };
}

export class ConnectorAuditPersistenceError extends Error {
  readonly code = "connector_audit_persistence_failed";
  constructor(readonly cause: unknown) {
    super("Connector audit persistence failed.");
    this.name = "ConnectorAuditPersistenceError";
  }
}

export interface CallbackReceiptRow {
  connectorId: string;
  deliveryKey: string;
  requestHash: string;
  status: string;
  responseCode: number | null;
  domainEntityId: string | null;
  acknowledgment: unknown;
  dispatchPending: boolean;
  dispatchLeaseToken?: string | null;
  dispatchLeaseExpiresAt?: Date | null;
  auditPending: boolean;
  auditData: unknown;
  completedAt: Date | null;
}

interface CallbackReceiptDelegate {
  findUnique(args: { where: { connectorId_deliveryKey: { connectorId: string; deliveryKey: string } } }):
    Promise<CallbackReceiptRow | null>;
  create(args: { data: {
    connectorId: string; deliveryKey: string; requestHash: string; status: "processing";
  } }): Promise<CallbackReceiptRow>;
  update(args: {
    where: { connectorId_deliveryKey: { connectorId: string; deliveryKey: string } };
    data: Partial<CallbackReceiptRow>;
  }): Promise<CallbackReceiptRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Partial<CallbackReceiptRow>;
  }): Promise<{ count: number }>;
}

export interface ConnectorCallbackTransaction {
  integrationCallbackReceipt: CallbackReceiptDelegate;
  integrationToolCallLog: ConnectorAuditRepository;
}

export interface ConnectorCallbackClient<TTransaction extends ConnectorCallbackTransaction> {
  integrationCallbackReceipt: CallbackReceiptDelegate;
  $transaction<T>(operation: (transaction: TTransaction) => Promise<T>): Promise<T>;
}

export interface CallbackDomainResult<TAcknowledgment> {
  domainEntityId: string;
  responseCode: number;
  acknowledgment: TAcknowledgment;
  dispatchPending: boolean;
}

export interface ExecuteCallbackInput<TTransaction extends ConnectorCallbackTransaction, TAcknowledgment> {
  client: ConnectorCallbackClient<TTransaction>;
  connectorId: string;
  deliveryKey: string;
  redactedRequest: unknown;
  performDomainWrite(transaction: TTransaction): Promise<CallbackDomainResult<TAcknowledgment>>;
  responder?: (domainEntityId: string) => Promise<void>;
  now?: () => Date;
}

export interface CallbackExecutionResult<TAcknowledgment> {
  responseCode: number;
  domainEntityId: string;
  acknowledgment: TAcknowledgment;
  replayed: boolean;
  operationalErrors: CallbackOperationalError[];
}

export type CallbackOperationalError = "callback_dispatch_failed" | "callback_audit_pending";

function withOperationalError<TAcknowledgment>(
  result: CallbackExecutionResult<TAcknowledgment>,
  error: CallbackOperationalError,
): CallbackExecutionResult<TAcknowledgment> {
  return result.operationalErrors.includes(error)
    ? result
    : { ...result, operationalErrors: [...result.operationalErrors, error] };
}

const callbackKey = (connectorId: string, deliveryKey: string) => ({
  connectorId_deliveryKey: { connectorId, deliveryKey },
});

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function completedResult<TAcknowledgment>(
  row: CallbackReceiptRow,
  replayed: boolean,
  expectedRequestHash: string,
): CallbackExecutionResult<TAcknowledgment> {
  if (row.requestHash !== expectedRequestHash) {
    throw new CallbackDeliveryIdentityConflictError();
  }
  if (row.status !== "completed" || row.responseCode === null || row.domainEntityId === null) {
    throw new Error("Callback delivery is already being processed.");
  }
  return {
    responseCode: row.responseCode,
    domainEntityId: row.domainEntityId,
    acknowledgment: row.acknowledgment as TAcknowledgment,
    replayed,
    operationalErrors: [],
  };
}

export class CallbackDeliveryIdentityConflictError extends Error {
  readonly code = "callback_delivery_identity_conflict";
  constructor() {
    super("Callback delivery key was reused for a different request identity.");
    this.name = "CallbackDeliveryIdentityConflictError";
  }
}

async function drainDispatch<TTransaction extends ConnectorCallbackTransaction, TAcknowledgment>(
  input: ExecuteCallbackInput<TTransaction, TAcknowledgment>,
  result: CallbackExecutionResult<TAcknowledgment>,
  dispatchPending: boolean,
): Promise<CallbackExecutionResult<TAcknowledgment>> {
  if (!dispatchPending || !input.responder) return result;
  const now = input.now?.() ?? new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 60_000);
  let claimed = false;
  try {
    await input.client.$transaction(async (transaction) => {
      const claim = await transaction.integrationCallbackReceipt.updateMany({
        where: {
          connectorId: input.connectorId,
          deliveryKey: input.deliveryKey,
          dispatchPending: true,
          OR: [{ dispatchLeaseExpiresAt: null }, { dispatchLeaseExpiresAt: { lte: now } }],
        },
        data: { dispatchLeaseToken: leaseToken, dispatchLeaseExpiresAt: leaseExpiresAt },
      });
      claimed = claim.count === 1;
    });
    if (!claimed) return result;
    await input.responder(result.domainEntityId);
    await input.client.$transaction(async (transaction) => {
      await transaction.integrationCallbackReceipt.updateMany({
        where: { connectorId: input.connectorId, deliveryKey: input.deliveryKey, dispatchLeaseToken: leaseToken },
        data: { dispatchPending: false, dispatchLeaseToken: null, dispatchLeaseExpiresAt: null },
      });
    });
    return result;
  } catch {
    if (claimed) {
      try {
        await input.client.$transaction(async (transaction) => {
          await transaction.integrationCallbackReceipt.updateMany({
            where: { connectorId: input.connectorId, deliveryKey: input.deliveryKey, dispatchLeaseToken: leaseToken },
            data: { dispatchLeaseToken: null, dispatchLeaseExpiresAt: null },
          });
        });
      } catch { /* lease expiry remains the recovery backstop */ }
    }
    return withOperationalError(result, "callback_dispatch_failed");
  }
}

/** Worker entry point for draining a completed receipt without replaying domain writes. */
export async function drainDurableCallbackDispatch<TTransaction extends ConnectorCallbackTransaction>(input: {
  client: ConnectorCallbackClient<TTransaction>;
  connectorId: string;
  deliveryKey: string;
  domainEntityId: string;
  responder(domainEntityId: string): Promise<void>;
  now?: () => Date;
}): Promise<{ claimedOrCompleted: boolean; retryableFailure: boolean }> {
  const result = await drainDispatch(
    {
      ...input,
      redactedRequest: {},
      performDomainWrite: async () => { throw new Error("Worker dispatch cannot write callback domain state."); },
    },
    { responseCode: 200, domainEntityId: input.domainEntityId, acknowledgment: {}, replayed: true, operationalErrors: [] },
    true,
  );
  return {
    claimedOrCompleted: !result.operationalErrors.includes("callback_dispatch_failed"),
    retryableFailure: result.operationalErrors.includes("callback_dispatch_failed"),
  };
}

type PendingCallbackAudit = Omit<ConnectorAuditCreateData, "calledAt"> & { calledAt: string };

function pendingAuditData(input: ConnectorAuditInput, calledAt: Date): PendingCallbackAudit {
  const data = auditData(input, calledAt);
  return { ...data, calledAt: data.calledAt.toISOString() };
}

function isPendingCallbackAudit(value: unknown): value is PendingCallbackAudit {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<PendingCallbackAudit>;
  return typeof candidate.calledAt === "string" && candidate.toolName === "callback" &&
    typeof candidate.integration === "string" && typeof candidate.argsHash === "string";
}

async function drainAudit<TTransaction extends ConnectorCallbackTransaction, TAcknowledgment>(
  input: ExecuteCallbackInput<TTransaction, TAcknowledgment>,
  result: CallbackExecutionResult<TAcknowledgment>,
  auditPending: boolean,
  storedAudit: unknown,
): Promise<CallbackExecutionResult<TAcknowledgment>> {
  if (!auditPending) return result;
  if (!isPendingCallbackAudit(storedAudit)) {
    return withOperationalError(result, "callback_audit_pending");
  }
  try {
    await input.client.$transaction(async (transaction) => {
      const claimed = await transaction.integrationCallbackReceipt.updateMany({
        where: {
          connectorId: input.connectorId,
          deliveryKey: input.deliveryKey,
          auditPending: true,
        },
        data: { auditPending: false, auditData: null },
      });
      if (claimed.count === 0) return;
      await transaction.integrationToolCallLog.create({
        data: { ...storedAudit, calledAt: new Date(storedAudit.calledAt) },
      });
    });
    return result;
  } catch {
    return withOperationalError(result, "callback_audit_pending");
  }
}

export async function executeCallbackTransaction<
  TTransaction extends ConnectorCallbackTransaction,
  TAcknowledgment,
>(input: ExecuteCallbackInput<TTransaction, TAcknowledgment>): Promise<CallbackExecutionResult<TAcknowledgment>> {
  const calledAt = input.now?.() ?? new Date();
  const requestHash = canonicalRedactedHash(input.redactedRequest);
  let persisted: {
    result: CallbackExecutionResult<TAcknowledgment>;
    dispatchPending: boolean;
    auditPending: boolean;
    auditData: unknown;
  };

  try {
    persisted = await input.client.$transaction(async (transaction) => {
      const where = callbackKey(input.connectorId, input.deliveryKey);
      const existing = await transaction.integrationCallbackReceipt.findUnique({ where });
      if (existing) return {
        result: completedResult<TAcknowledgment>(existing, true, requestHash),
        dispatchPending: existing.dispatchPending,
        auditPending: existing.auditPending,
        auditData: existing.auditData,
      };

      await transaction.integrationCallbackReceipt.create({
        data: {
          connectorId: input.connectorId,
          deliveryKey: input.deliveryKey,
          requestHash,
          status: "processing",
        },
      });
      const domain = await input.performDomainWrite(transaction);
      const completedAt = input.now?.() ?? new Date();
      const callbackAudit = pendingAuditData({
        connectorId: input.connectorId,
        actor: { coworkerId: "external-webhook", userId: null },
        operation: "callback",
        redactedInput: input.redactedRequest,
        responseKind: "success",
        resultCount: 1,
        durationMs: Math.max(0, completedAt.getTime() - calledAt.getTime()),
      }, calledAt);
      await transaction.integrationCallbackReceipt.update({
        where,
        data: {
          status: "completed",
          responseCode: domain.responseCode,
          domainEntityId: domain.domainEntityId,
          acknowledgment: domain.acknowledgment,
          dispatchPending: domain.dispatchPending,
          auditPending: true,
          auditData: callbackAudit,
          completedAt,
        },
      });
      return {
        result: {
          responseCode: domain.responseCode,
          domainEntityId: domain.domainEntityId,
          acknowledgment: domain.acknowledgment,
          replayed: false,
          operationalErrors: [],
        },
        dispatchPending: domain.dispatchPending,
        auditPending: true,
        auditData: callbackAudit,
      };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await input.client.integrationCallbackReceipt.findUnique({
      where: callbackKey(input.connectorId, input.deliveryKey),
    });
    if (!existing) throw error;
    persisted = {
      result: completedResult<TAcknowledgment>(existing, true, requestHash),
      dispatchPending: existing.dispatchPending,
      auditPending: existing.auditPending,
      auditData: existing.auditData,
    };
  }

  const afterAudit = await drainAudit(
    input,
    persisted.result,
    persisted.auditPending,
    persisted.auditData,
  );
  return drainDispatch(input, afterAudit, persisted.dispatchPending);
}
