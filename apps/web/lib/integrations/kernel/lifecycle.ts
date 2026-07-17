import { createDurableConnectorAudit, type ConnectorAuditInput, type ConnectorAuditRepository } from "./audit";
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
      persistFailure(draft: TDraft, error: unknown): Promise<void>;
      auditFailure(draft: TDraft, error: unknown): Promise<void>;
    } & PersistedTransition<TDraft, TResult>) {
      let result: TResult;
      try {
        result = await input.exchange();
      } catch (error) {
        await dependencies.persistence.transact(async (draft) => {
          await input.persistFailure(draft, error);
          await input.auditFailure(draft, error);
        });
        throw error;
      }
      return commit(input, result);
    },

    async disconnect(input: { persist(draft: TDraft): Promise<void>; audit: AuditWrite<TDraft> }): Promise<void> {
      await dependencies.persistence.transact(async (draft) => {
        await input.persist(draft);
        await input.audit(draft);
      });
    },

    refresh(input: {
      connectorId: string;
      refresh(): Promise<TRefreshResult>;
    } & PersistedTransition<TDraft, TRefreshResult>): Promise<TRefreshResult> {
      return refreshFlights.run(input.connectorId, async () => {
        const result = await input.refresh();
        return commit(input, result);
      });
    },

    async ensureClientCredential<TResult>(input: {
      expired: boolean;
      exchange(): Promise<TResult>;
    } & PersistedTransition<TDraft, TResult>): Promise<TResult | null> {
      if (!input.expired) return null;
      const result = await input.exchange();
      return commit(input, result);
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
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  jitter?: (delayMs: number, attempt: number) => number;
}): Promise<SyncResult<TCheckpoint>> {
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
}
