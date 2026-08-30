import {
  assertEncryptionReadyForCredentialWrite,
  decryptJson,
  encryptJson,
} from "@/lib/govern/credential-crypto";

import {
  projectConnectorSetupState,
  type ConnectorHealthInput,
  type ConnectorSafeProjection,
  type ConnectorSafeValue,
  type ConnectorSetupState,
} from "./setup-state";
import { collectSensitiveText, redactConnectorText } from "./redaction";
import { isRecord } from "@/lib/shared/coerce";

export type ConnectorCredentialValue = ConnectorSafeValue;
export type ConnectorReconnectFields = { [key: string]: ConnectorCredentialValue };
export type ConnectorSecretFields = { [key: string]: ConnectorCredentialValue };
export type ConnectorTokenEnvelope = { [key: string]: ConnectorCredentialValue };

interface StoredCredentialFieldsEnvelope {
  schemaVersion: 1;
  reconnectFields: ConnectorReconnectFields;
  secretFields: ConnectorSecretFields;
  safeProjection: ConnectorSafeProjection;
}

interface StoredTokenEnvelope {
  schemaVersion: 1;
  tokenEnvelope: ConnectorTokenEnvelope;
}

export interface ConnectorCredentialRow {
  integrationId: string;
  provider: string;
  status: string;
  fieldsEnc: string;
  tokenCacheEnc: string | null;
  lastTestedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMsg: string | null;
}

type ConnectorCredentialWriteData = Omit<ConnectorCredentialRow, "integrationId">;

export interface ConnectorCredentialTransaction {
  findUnique(args: { integrationId: string }): Promise<ConnectorCredentialRow | null>;
  upsert(args: {
    integrationId: string;
    create: ConnectorCredentialRow;
    update: ConnectorCredentialWriteData;
  }): Promise<ConnectorCredentialRow>;
  update(args: {
    integrationId: string;
    data: Partial<ConnectorCredentialWriteData>;
  }): Promise<ConnectorCredentialRow>;
  delete(args: { integrationId: string }): Promise<void>;
}

export interface ConnectorCredentialRepository<TTransactionContext = ConnectorCredentialTransaction> {
  findUnique(args: { integrationId: string }): Promise<ConnectorCredentialRow | null>;
  transaction<T>(
    operation: (
      transaction: ConnectorCredentialTransaction,
      context: TTransactionContext,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface ConnectorCredentialCrypto {
  assertReadyForWrite(): Promise<void>;
  encryptJson(value: unknown): string;
  decryptJson(stored: string): unknown;
}

export interface SuccessfulConnectorCredential {
  integrationId: string;
  provider: string;
  reconnectFields: ConnectorReconnectFields;
  secretFields: ConnectorSecretFields;
  tokenEnvelope: ConnectorTokenEnvelope;
  safeProjection: ConnectorSafeProjection;
}

export const CONNECTOR_SAFE_ERROR_KINDS = [
  "authentication",
  "authorization",
  "configuration",
  "network",
  "provider",
  "unknown",
] as const;
export type ConnectorSafeErrorKind = (typeof CONNECTOR_SAFE_ERROR_KINDS)[number];
export interface ConnectorSafeError {
  kind: ConnectorSafeErrorKind;
  safeMessage: string;
}

export type ConnectorHealthProbeOutcome =
  | { succeeded: true; safeProjectionPatch?: ConnectorSafeProjection }
  | { succeeded: false; error: ConnectorSafeError };

export interface FailedConnectorCredential extends Omit<SuccessfulConnectorCredential, "safeProjection"> {
  reconnectFieldsReusable: boolean;
  /** Defaults to failure-time for compatibility; use preserve when a failed attempt is not a successful test. */
  lastTestedAtPolicy?: "failure-time" | "preserve";
  error: ConnectorSafeError;
}

export interface ConnectorCredentialStoreDependencies<TTransactionContext = ConnectorCredentialTransaction> {
  repository: ConnectorCredentialRepository<TTransactionContext>;
  crypto?: ConnectorCredentialCrypto;
  now?: () => Date;
}

const UNREADABLE_CREDENTIAL_MESSAGE = "Stored connector credential could not be read safely.";
const MAX_TRANSACTION_ATTEMPTS = 3;

function isCredentialValue(value: unknown): value is ConnectorCredentialValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isCredentialValue);
  return isRecord(value) && Object.values(value).every(isCredentialValue);
}

function isCredentialRecord(value: unknown): value is Record<string, ConnectorCredentialValue> {
  return isRecord(value) && Object.values(value).every(isCredentialValue);
}

function parseFieldsEnvelope(value: unknown): StoredCredentialFieldsEnvelope | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isCredentialRecord(value.reconnectFields) ||
    !isCredentialRecord(value.secretFields) ||
    !isCredentialRecord(value.safeProjection)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    reconnectFields: value.reconnectFields,
    secretFields: value.secretFields,
    safeProjection: value.safeProjection,
  };
}

function parseTokenEnvelope(value: unknown): StoredTokenEnvelope | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isCredentialRecord(value.tokenEnvelope)) {
    return null;
  }
  return { schemaVersion: 1, tokenEnvelope: value.tokenEnvelope };
}

function sanitizeErrorMessage(message: string): string {
  const sanitized = message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (sanitized || "Connector connection failed.").slice(0, 500);
}

function redactSafeValue(value: ConnectorSafeValue, sensitive: ReadonlySet<string>): ConnectorSafeValue {
  if (typeof value === "string") return redactConnectorText(value, sensitive);
  if (Array.isArray(value)) return value.map((item) => redactSafeValue(item, sensitive));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSafeValue(item, sensitive)]),
    );
  }
  return value;
}

function redactSafeProjection(
  projection: ConnectorSafeProjection,
  secretFields: ConnectorSecretFields = {},
  tokenEnvelope: ConnectorTokenEnvelope = {},
): ConnectorSafeProjection {
  const sensitive = new Set<string>();
  collectSensitiveText(secretFields, sensitive);
  collectSensitiveText(tokenEnvelope, sensitive);
  return redactSafeValue(projection, sensitive) as ConnectorSafeProjection;
}

function isRetryableTransactionConflict(error: unknown): boolean {
  return isRecord(error) && (error.code === "P2034" || error.code === "P2002");
}

export interface PrismaIntegrationCredentialDelegate {
  findUnique(args: { where: { integrationId: string } }): Promise<ConnectorCredentialRow | null>;
  upsert(args: {
    where: { integrationId: string };
    create: ConnectorCredentialRow;
    update: ConnectorCredentialWriteData;
  }): Promise<ConnectorCredentialRow>;
  update(args: {
    where: { integrationId: string };
    data: Partial<ConnectorCredentialWriteData>;
  }): Promise<ConnectorCredentialRow>;
  delete(args: { where: { integrationId: string } }): Promise<ConnectorCredentialRow>;
}

export interface PrismaConnectorCredentialClient<
  TTransaction extends { integrationCredential: PrismaIntegrationCredentialDelegate } = {
    integrationCredential: PrismaIntegrationCredentialDelegate;
  },
> {
  integrationCredential: PrismaIntegrationCredentialDelegate;
  $transaction<T>(
    operation: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export type PrismaConnectorExternalTransaction<
  TTransaction extends { integrationCredential: PrismaIntegrationCredentialDelegate },
> = Omit<TTransaction, "integrationCredential">;

function mapPrismaTransaction(delegate: PrismaIntegrationCredentialDelegate): ConnectorCredentialTransaction {
  return {
    findUnique: ({ integrationId }) => delegate.findUnique({ where: { integrationId } }),
    upsert: ({ integrationId, create, update }) =>
      delegate.upsert({ where: { integrationId }, create, update }),
    update: ({ integrationId, data }) => delegate.update({ where: { integrationId }, data }),
    delete: async ({ integrationId }) => {
      await delegate.delete({ where: { integrationId } });
    },
  };
}

export function createPrismaConnectorCredentialRepository<
  TTransaction extends { integrationCredential: PrismaIntegrationCredentialDelegate },
>(
  prisma: PrismaConnectorCredentialClient<TTransaction>,
): ConnectorCredentialRepository<PrismaConnectorExternalTransaction<TTransaction>> {
  return {
    findUnique: ({ integrationId }) =>
      prisma.integrationCredential.findUnique({ where: { integrationId } }),
    transaction: (operation) =>
      prisma.$transaction(
        (transaction) => {
          const { integrationCredential, ...externalTransaction } = transaction;
          return operation(
            mapPrismaTransaction(integrationCredential),
            externalTransaction,
          );
        },
        { isolationLevel: "Serializable" },
      ),
  };
}

export function createConnectorCredentialStore<TTransactionContext = ConnectorCredentialTransaction>(
  dependencies: ConnectorCredentialStoreDependencies<TTransactionContext>,
) {
  const credentialCrypto: ConnectorCredentialCrypto = dependencies.crypto ?? {
    assertReadyForWrite: assertEncryptionReadyForCredentialWrite,
    encryptJson,
    decryptJson,
  };
  const currentTime = dependencies.now ?? (() => new Date());

  async function runTransactionWithRetry<T>(
    operation: (
      transaction: ConnectorCredentialTransaction,
      context: TTransactionContext,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await dependencies.repository.transaction(operation);
      } catch (error) {
        if (!isRetryableTransactionConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      }
    }
    throw new Error("Unreachable transaction retry state");
  }

  function boundStore(transaction: ConnectorCredentialTransaction, readinessAlreadyChecked = false) {
    return {
      async recordSuccessfulConnect(input: SuccessfulConnectorCredential): Promise<void> {
        if (!readinessAlreadyChecked) await credentialCrypto.assertReadyForWrite();
        const safeProjection = redactSafeProjection(
          input.safeProjection,
          input.secretFields,
          input.tokenEnvelope,
        );
        const fieldsEnc = credentialCrypto.encryptJson({
          schemaVersion: 1,
          reconnectFields: input.reconnectFields,
          secretFields: input.secretFields,
          safeProjection,
        } satisfies StoredCredentialFieldsEnvelope);
        const tokenCacheEnc = credentialCrypto.encryptJson({
          schemaVersion: 1,
          tokenEnvelope: input.tokenEnvelope,
        } satisfies StoredTokenEnvelope);
        const data: ConnectorCredentialWriteData = {
          provider: input.provider,
          status: "connected",
          fieldsEnc,
          tokenCacheEnc,
          lastTestedAt: currentTime(),
          lastErrorAt: null,
          lastErrorMsg: null,
        };
        await transaction.upsert({
          integrationId: input.integrationId,
          create: { integrationId: input.integrationId, ...data },
          update: data,
        });
      },

      async recordFailedConnect(input: FailedConnectorCredential): Promise<void> {
        const failedAt = currentTime();
        const sensitive = new Set<string>();
        collectSensitiveText(input.secretFields, sensitive);
        collectSensitiveText(input.tokenEnvelope, sensitive);
        const lastErrorMsg = sanitizeErrorMessage(redactConnectorText(input.error.safeMessage, sensitive));
        const existing = await transaction.findUnique({ integrationId: input.integrationId });
        if (existing?.status === "connected") {
          await transaction.update({
            integrationId: input.integrationId,
            data: { lastErrorAt: failedAt, lastErrorMsg },
          });
          return;
        }
        await credentialCrypto.assertReadyForWrite();
        const fieldsEnc = credentialCrypto.encryptJson({
          schemaVersion: 1,
          reconnectFields: input.reconnectFieldsReusable ? input.reconnectFields : {},
          secretFields: {},
          safeProjection: {},
        } satisfies StoredCredentialFieldsEnvelope);
        const lastTestedAt = input.lastTestedAtPolicy === "preserve"
          ? existing?.lastTestedAt ?? null
          : failedAt;
        const data: ConnectorCredentialWriteData = {
          provider: input.provider,
          status: "error",
          fieldsEnc,
          tokenCacheEnc: null,
          lastTestedAt,
          lastErrorAt: failedAt,
          lastErrorMsg,
        };
        await transaction.upsert({
          integrationId: input.integrationId,
          create: { integrationId: input.integrationId, ...data },
          update: data,
        });
      },

      async disconnect(integrationId: string): Promise<void> {
        await transaction.delete({ integrationId });
      },

      async recordHealthProbe(integrationId: string, outcome: ConnectorHealthProbeOutcome): Promise<void> {
        const existing = await transaction.findUnique({ integrationId });
        if (!existing) throw new Error("Connector credential is not configured.");
        const testedAt = currentTime();
        if (outcome.succeeded && outcome.safeProjectionPatch) {
          const envelope = parseFieldsEnvelope(credentialCrypto.decryptJson(existing.fieldsEnc));
          const tokens = existing.tokenCacheEnc
            ? parseTokenEnvelope(credentialCrypto.decryptJson(existing.tokenCacheEnc))
            : { schemaVersion: 1 as const, tokenEnvelope: {} };
          if (!envelope || !tokens) throw new Error(UNREADABLE_CREDENTIAL_MESSAGE);
          const mergedProjection = { ...envelope.safeProjection, ...outcome.safeProjectionPatch };
          if (!isCredentialRecord(mergedProjection)) {
            throw new Error("Connector safe projection is not bounded.");
          }
          const safeProjection = redactSafeProjection(
            mergedProjection,
            envelope.secretFields,
            tokens.tokenEnvelope,
          );
          if (JSON.stringify(safeProjection) !== JSON.stringify(mergedProjection)) {
            throw new Error("Connector safe projection cannot contain credential secrets.");
          }
          if (!readinessAlreadyChecked) await credentialCrypto.assertReadyForWrite();
          const fieldsEnc = credentialCrypto.encryptJson({
            ...envelope,
            safeProjection,
          } satisfies StoredCredentialFieldsEnvelope);
          await transaction.update({
            integrationId,
            data: {
              fieldsEnc,
              status: "connected",
              lastTestedAt: testedAt,
              lastErrorAt: null,
              lastErrorMsg: null,
            },
          });
          return;
        }
        await transaction.update({
          integrationId,
          data: outcome.succeeded
            ? { status: "connected", lastTestedAt: testedAt, lastErrorAt: null, lastErrorMsg: null }
            : {
                lastTestedAt: testedAt,
                lastErrorAt: testedAt,
                lastErrorMsg: sanitizeErrorMessage(outcome.error.safeMessage),
              },
        });
      },

      async updateSafeProjection(
        integrationId: string,
        transform: (projection: ConnectorSafeProjection) => ConnectorSafeProjection,
      ): Promise<ConnectorSafeProjection> {
        const existing = await transaction.findUnique({ integrationId });
        if (!existing) throw new Error("Connector credential is not configured.");
        const envelope = parseFieldsEnvelope(credentialCrypto.decryptJson(existing.fieldsEnc));
        const tokens = existing.tokenCacheEnc
          ? parseTokenEnvelope(credentialCrypto.decryptJson(existing.tokenCacheEnc))
          : { schemaVersion: 1 as const, tokenEnvelope: {} };
        if (!envelope || !tokens) throw new Error(UNREADABLE_CREDENTIAL_MESSAGE);
        const transformed = transform(redactSafeProjection(envelope.safeProjection));
        if (!isCredentialRecord(transformed)) throw new Error("Connector safe projection is not bounded.");
        if (!readinessAlreadyChecked) await credentialCrypto.assertReadyForWrite();
        const safeProjection = redactSafeProjection(transformed, envelope.secretFields, tokens.tokenEnvelope);
        const fieldsEnc = credentialCrypto.encryptJson({ ...envelope, safeProjection } satisfies StoredCredentialFieldsEnvelope);
        await transaction.update({ integrationId, data: { fieldsEnc } });
        return safeProjection;
      },
    };
  }

  return {
    async recordSuccessfulConnect(input: SuccessfulConnectorCredential): Promise<void> {
      await credentialCrypto.assertReadyForWrite();
      await runTransactionWithRetry((transaction) =>
        boundStore(transaction, true).recordSuccessfulConnect(input),
      );
    },

    async recordFailedConnect(input: FailedConnectorCredential): Promise<void> {
      await runTransactionWithRetry((transaction) => boundStore(transaction).recordFailedConnect(input));
    },

    async disconnect(integrationId: string): Promise<void> {
      await runTransactionWithRetry((transaction) => boundStore(transaction).disconnect(integrationId));
    },

    async recordHealthProbe(integrationId: string, outcome: ConnectorHealthProbeOutcome): Promise<void> {
      if (outcome.succeeded && outcome.safeProjectionPatch) {
        await credentialCrypto.assertReadyForWrite();
      }
      await runTransactionWithRetry((transaction) =>
        boundStore(transaction, outcome.succeeded && Boolean(outcome.safeProjectionPatch))
          .recordHealthProbe(integrationId, outcome),
      );
    },

    async updateSafeProjection(
      integrationId: string,
      transform: (projection: ConnectorSafeProjection) => ConnectorSafeProjection,
    ): Promise<ConnectorSafeProjection> {
      await credentialCrypto.assertReadyForWrite();
      return runTransactionWithRetry((transaction) => boundStore(transaction, true).updateSafeProjection(integrationId, transform));
    },

    withTransaction: boundStore,

    async composeInTransaction<T>(
      operation: (context: {
        credentials: ReturnType<typeof boundStore>;
        transaction: TTransactionContext;
      }) => Promise<T>,
    ): Promise<T> {
      return runTransactionWithRetry((transaction, context) =>
        operation({ credentials: boundStore(transaction), transaction: context }),
      );
    },

    async readSetupState(
      integrationId: string,
      health: ConnectorHealthInput = {},
    ): Promise<ConnectorSetupState> {
      const credential = await dependencies.repository.findUnique({ integrationId });
      if (!credential) return projectConnectorSetupState(null, integrationId, health);

      const envelope = parseFieldsEnvelope(credentialCrypto.decryptJson(credential.fieldsEnc));
      const tokenEnvelope = credential.tokenCacheEnc
        ? parseTokenEnvelope(credentialCrypto.decryptJson(credential.tokenCacheEnc))
        : null;
      if (!envelope || (credential.tokenCacheEnc !== null && !tokenEnvelope)) {
        return projectConnectorSetupState(
          {
            integrationId,
            provider: credential.provider,
            status: "error",
            safeProjection: {},
            lastErrorMsg: UNREADABLE_CREDENTIAL_MESSAGE,
            lastTestedAt: credential.lastTestedAt,
          },
          integrationId,
          health,
        );
      }

      const latestProbeFailed = health.latestProbeFailed ?? (
        credential.status === "connected" &&
        credential.lastErrorAt !== null &&
        (credential.lastTestedAt === null || credential.lastErrorAt >= credential.lastTestedAt)
      );

      return projectConnectorSetupState(
        {
          integrationId,
          provider: credential.provider,
          status: credential.status,
          safeProjection: redactSafeProjection(envelope.safeProjection),
          lastErrorMsg: credential.lastErrorMsg,
          lastTestedAt: credential.lastTestedAt,
        },
        integrationId,
        { ...health, latestProbeFailed },
      );
    },
  };
}
