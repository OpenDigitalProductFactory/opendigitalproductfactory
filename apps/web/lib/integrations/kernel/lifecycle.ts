import { createDurableConnectorAudit, type ConnectorAuditInput, type ConnectorAuditRepository } from "./audit";
import {
  ConnectorAttemptFailedError,
  toConnectorAttemptFailure,
  type ConnectorAttemptFailure,
} from "./error";
export { ConnectorAttemptFailedError, toConnectorAttemptFailure } from "./error";
export type { ConnectorAttemptFailure, ConnectorAttemptFailureKind } from "./error";
import type { ConnectorRetryPolicy } from "./retry";
import { retryConnectorOperation } from "./retry";
import { createSingleFlight, type SingleFlight } from "./single-flight";

export type ConnectorHealthResult =
  | { state: "unconfigured" }
  | { state: "connected" }
  | { state: "error"; error: string }
  | { state: "degraded"; error: string };

export interface ConnectorHealthSource {
  connected: boolean;
  error?: string;
  probe?: { ok: true } | { ok: false; error: string };
}

export interface LifecyclePersistence<TDraft> {
  transact<T>(operation: (draft: TDraft) => Promise<T>): Promise<T>;
}

/** Adapts the credential store's caller-owned transaction to lifecycle persistence. */
export function composeConnectorLifecyclePersistence<TTransaction, TCredentials>(store: {
  composeInTransaction<T>(operation: (context: {
    credentials: TCredentials;
    transaction: TTransaction;
  }) => Promise<T>): Promise<T>;
}): LifecyclePersistence<{ credentials: TCredentials; transaction: TTransaction }> {
  return {
    transact: (operation) => store.composeInTransaction(operation),
  };
}

/** Writes through Task 4's durable audit API using the transaction-scoped delegate. */
export async function recordConnectorAuditInTransaction(
  repository: ConnectorAuditRepository,
  input: ConnectorAuditInput,
  now?: () => Date,
): Promise<void> {
  await createDurableConnectorAudit({ repository, now }).record(input);
}

type AuditWrite<TDraft> = (draft: TDraft) => Promise<void>;

async function recordFailedAttempt<TDraft>(
  persistence: LifecyclePersistence<TDraft>,
  auditFailure: (draft: TDraft, failure: ConnectorAttemptFailure) => Promise<void>,
  error: unknown,
): Promise<never> {
  const failure = toConnectorAttemptFailure(error);
  try {
    await persistence.transact((draft) => auditFailure(draft, failure));
  } catch (auditError) {
    const auditFailure = toConnectorAttemptFailure(auditError);
    throw new ConnectorAttemptFailedError(auditFailure, {
      cause: new AggregateError([error, auditError], "Connector operation and failure audit both failed."),
    });
  }
  throw new ConnectorAttemptFailedError(failure, { cause: error });
}

interface PersistedTransition<TDraft, TResult> {
  persist(draft: TDraft, result: TResult): Promise<void>;
  audit: AuditWrite<TDraft>;
}

export interface ConnectorLifecycleDependencies<TDraft, TRefreshResult> {
  persistence: LifecyclePersistence<TDraft>;
  /** Keyed by unique IntegrationCredential.integrationId, not by provider slug. */
  refreshFlights?: SingleFlight<TRefreshResult>;
}

export function createConnectorLifecycle<TDraft, TRefreshResult = unknown>(dependencies: ConnectorLifecycleDependencies<TDraft, TRefreshResult>) {
  const refreshFlights = dependencies.refreshFlights ?? createSingleFlight<TRefreshResult>();

  async function commit<TResult>(transition: PersistedTransition<TDraft, TResult>, result: TResult): Promise<TResult> {
    await dependencies.persistence.transact(async (draft) => {
      await transition.persist(draft, result);
      await transition.audit(draft);
    });
    return result;
  }

  return {
    projectHealth(source: ConnectorHealthSource | null): ConnectorHealthResult {
      if (!source) return { state: "unconfigured" };
      if (!source.connected) return { state: "error", error: source.error ?? "Connector is not connected." };
      if (source.probe && !source.probe.ok) return { state: "degraded", error: source.probe.error };
      return { state: "connected" };
    },

    async connect<TResult>(input: {
      exchange(): Promise<TResult>;
      persistFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
      auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
    } & PersistedTransition<TDraft, TResult>) {
      let result: TResult;
      try {
        result = await input.exchange();
      } catch (error) {
        const failure = toConnectorAttemptFailure(error);
        try {
          await dependencies.persistence.transact(async (draft) => {
            await input.persistFailure(draft, failure);
            await input.auditFailure(draft, failure);
          });
        } catch (auditError) {
          throw new ConnectorAttemptFailedError(toConnectorAttemptFailure(auditError), {
            cause: new AggregateError([error, auditError], "Connect failure persistence/audit failed."),
          });
        }
        throw new ConnectorAttemptFailedError(failure, { cause: error });
      }
      try {
        return await commit(input, result);
      } catch (error) {
        const failure = toConnectorAttemptFailure(error);
        try {
          await dependencies.persistence.transact((draft) => input.auditFailure(draft, failure));
        } catch (auditError) {
          throw new ConnectorAttemptFailedError(toConnectorAttemptFailure(auditError), {
            cause: new AggregateError([error, auditError], "Connect and failure audit both failed."),
          });
        }
        throw new ConnectorAttemptFailedError(failure, { cause: error });
      }
    },

    async disconnect(input: {
      persist(draft: TDraft): Promise<void>;
      audit: AuditWrite<TDraft>;
      auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
    }): Promise<void> {
      try {
        await dependencies.persistence.transact(async (draft) => {
          await input.persist(draft);
          await input.audit(draft);
        });
      } catch (error) {
        return recordFailedAttempt(dependencies.persistence, input.auditFailure, error);
      }
    },

    refresh(input: {
      connectorId: string;
      refresh(): Promise<TRefreshResult>;
      auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
    } & PersistedTransition<TDraft, TRefreshResult>): Promise<TRefreshResult> {
      return refreshFlights.run(input.connectorId, async () => {
        try {
          const result = await input.refresh();
          return await commit(input, result);
        } catch (error) {
          return recordFailedAttempt(dependencies.persistence, input.auditFailure, error);
        }
      });
    },

    async ensureClientCredential<TResult>(input: {
      expired: boolean;
      exchange(): Promise<TResult>;
      auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
    } & PersistedTransition<TDraft, TResult>): Promise<TResult | null> {
      if (!input.expired) return null;
      try {
        const result = await input.exchange();
        return await commit(input, result);
      } catch (error) {
        return recordFailedAttempt(dependencies.persistence, input.auditFailure, error);
      }
    },

    async health(input: {
      probe(): Promise<{ ok: true } | { ok: false; error: string }>;
      audit(draft: TDraft, result: ConnectorHealthResult): Promise<void>;
      auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
    }): Promise<ConnectorHealthResult> {
      let probe: { ok: true } | { ok: false; error: string };
      try {
        probe = await input.probe();
      } catch (error) {
        const failure = toConnectorAttemptFailure(error);
        try {
          await dependencies.persistence.transact((draft) => input.auditFailure(draft, failure));
        } catch (auditError) {
          throw new ConnectorAttemptFailedError(toConnectorAttemptFailure(auditError), {
            cause: new AggregateError([error, auditError], "Health probe and failure audit both failed."),
          });
        }
        return { state: "degraded", error: failure.safeMessage };
      }
      const result: ConnectorHealthResult = probe.ok
        ? { state: "connected" }
        : { state: "degraded", error: "Connector health probe failed." };
      // Audit persistence is intentionally outside the provider catch: an audit
      // outage is operational failure, not evidence that the provider degraded.
      try {
        await dependencies.persistence.transact((draft) => input.audit(draft, result));
      } catch (error) {
        throw new ConnectorAttemptFailedError(toConnectorAttemptFailure(error), { cause: error });
      }
      return result;
    },
  };
}

export interface SyncRequest {
  cursor?: string | null;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface SyncResult<TCheckpoint = unknown> {
  nextCursor?: string | null;
  resultCount: number;
  checkpoint: TCheckpoint;
}

export async function runConnectorSync<TDraft, TCheckpoint>(input: {
  request: SyncRequest;
  persistence: LifecyclePersistence<TDraft>;
  retry: ConnectorRetryPolicy;
  sync(request: SyncRequest): Promise<SyncResult<TCheckpoint>>;
  persist(draft: TDraft, result: SyncResult<TCheckpoint>): Promise<void>;
  audit: AuditWrite<TDraft>;
  auditFailure(draft: TDraft, failure: ConnectorAttemptFailure): Promise<void>;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  jitter?: (delayMs: number, attempt: number) => number;
}): Promise<SyncResult<TCheckpoint>> {
  try {
    const result = await retryConnectorOperation(input.retry, {
      idempotencyKey: input.request.idempotencyKey,
      signal: input.request.signal,
      sleep: input.sleep,
      jitter: input.jitter,
      operation: () => input.sync(input.request),
    });
    await input.persistence.transact(async (draft) => {
      await input.persist(draft, result);
      await input.audit(draft);
    });
    return result;
  } catch (error) {
    return recordFailedAttempt(input.persistence, input.auditFailure, error);
  }
}
