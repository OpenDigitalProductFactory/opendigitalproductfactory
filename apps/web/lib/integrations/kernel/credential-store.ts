import { decryptJson, encryptJson } from "@/lib/govern/credential-crypto";

import {
  projectConnectorSetupState,
  type ConnectorHealthInput,
  type ConnectorSafeProjection,
  type ConnectorSafeValue,
  type ConnectorSetupState,
} from "./setup-state";

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

export interface ConnectorCredentialRepository {
  findUnique(args: { integrationId: string }): Promise<ConnectorCredentialRow | null>;
  transaction<T>(operation: (transaction: ConnectorCredentialTransaction) => Promise<T>): Promise<T>;
}

export interface ConnectorCredentialCrypto {
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

export interface FailedConnectorCredential extends Omit<SuccessfulConnectorCredential, "safeProjection"> {
  reconnectFieldsReusable: boolean;
  errorMessage: string;
}

export interface ConnectorCredentialStoreDependencies {
  repository: ConnectorCredentialRepository;
  crypto?: ConnectorCredentialCrypto;
  now?: () => Date;
}

const UNREADABLE_CREDENTIAL_MESSAGE = "Stored connector credential could not be read safely.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function createConnectorCredentialStore(dependencies: ConnectorCredentialStoreDependencies) {
  const credentialCrypto: ConnectorCredentialCrypto = dependencies.crypto ?? { encryptJson, decryptJson };
  const currentTime = dependencies.now ?? (() => new Date());

  return {
    async recordSuccessfulConnect(input: SuccessfulConnectorCredential): Promise<void> {
      const fieldsEnc = credentialCrypto.encryptJson({
        schemaVersion: 1,
        reconnectFields: input.reconnectFields,
        secretFields: input.secretFields,
        safeProjection: input.safeProjection,
      } satisfies StoredCredentialFieldsEnvelope);
      const tokenCacheEnc = credentialCrypto.encryptJson({
        schemaVersion: 1,
        tokenEnvelope: input.tokenEnvelope,
      } satisfies StoredTokenEnvelope);
      const testedAt = currentTime();
      const data: ConnectorCredentialWriteData = {
        provider: input.provider,
        status: "connected",
        fieldsEnc,
        tokenCacheEnc,
        lastTestedAt: testedAt,
        lastErrorAt: null,
        lastErrorMsg: null,
      };
      await dependencies.repository.transaction(async (transaction) => {
        await transaction.upsert({
          integrationId: input.integrationId,
          create: { integrationId: input.integrationId, ...data },
          update: data,
        });
      });
    },

    async recordFailedConnect(input: FailedConnectorCredential): Promise<void> {
      const failedAt = currentTime();
      const lastErrorMsg = sanitizeErrorMessage(input.errorMessage);
      await dependencies.repository.transaction(async (transaction) => {
        const existing = await transaction.findUnique({ integrationId: input.integrationId });
        if (existing?.status === "connected") {
          await transaction.update({
            integrationId: input.integrationId,
            data: { lastErrorAt: failedAt, lastErrorMsg },
          });
          return;
        }

        const fieldsEnc = credentialCrypto.encryptJson({
          schemaVersion: 1,
          reconnectFields: input.reconnectFieldsReusable ? input.reconnectFields : {},
          secretFields: {},
          safeProjection: {},
        } satisfies StoredCredentialFieldsEnvelope);
        const data: ConnectorCredentialWriteData = {
          provider: input.provider,
          status: "error",
          fieldsEnc,
          tokenCacheEnc: null,
          lastTestedAt: failedAt,
          lastErrorAt: failedAt,
          lastErrorMsg,
        };
        await transaction.upsert({
          integrationId: input.integrationId,
          create: { integrationId: input.integrationId, ...data },
          update: data,
        });
      });
    },

    async disconnect(integrationId: string): Promise<void> {
      await dependencies.repository.transaction((transaction) => transaction.delete({ integrationId }));
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

      return projectConnectorSetupState(
        {
          integrationId,
          provider: credential.provider,
          status: credential.status,
          safeProjection: envelope.safeProjection,
          lastErrorMsg: credential.lastErrorMsg,
          lastTestedAt: credential.lastTestedAt,
        },
        integrationId,
        health,
      );
    },
  };
}
