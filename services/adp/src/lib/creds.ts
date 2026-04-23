// Credential + token lifecycle management for adp MCP tools.
// Shared across all tool handlers — load once, refresh-if-needed, cache.

import { createHash } from "node:crypto";
import { decryptJson, encryptJson } from "./crypto.js";
import {
  exchangeToken,
  AdpAuthError,
  type AdpEnvironment,
  type ExchangeTokenResult,
} from "./token-client.js";
import {
  loadAdpCredential,
  updateTokenCache,
  insertToolCallLog,
  getSql,
  type IntegrationCredentialRow,
  type IntegrationToolCallLogInsert,
  type Sql,
} from "./db.js";

const INTEGRATION = "adp";
const REFRESH_SKEW_MS = 60_000; // refresh 60s before expiry

export interface AdpFields {
  clientId: string;
  clientSecret: string;
  certPem: string;
  privateKeyPem: string;
  environment: AdpEnvironment;
  subscriptionKey?: string;
}

export interface TokenCache {
  accessToken: string;
  expiresAt: string; // ISO
}

export interface ActiveCredential {
  id: string;
  environment: AdpEnvironment;
  accessToken: string;
  certPem: string;
  privateKeyPem: string;
}

export class AdpNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdpNotConnectedError";
  }
}

export async function getActiveCredential(sql: Sql = getSql()): Promise<ActiveCredential> {
  const row = await loadAdpCredential(sql);
  if (!row) {
    throw new AdpNotConnectedError(
      "ADP is not connected — configure credentials at Settings > Integrations > ADP",
    );
  }
  if (row.status !== "connected") {
    throw new AdpNotConnectedError(
      `ADP connection is in '${row.status}' state — re-connect at Settings > Integrations > ADP`,
    );
  }

  const fields = decryptJson<AdpFields>(row.fieldsEnc);
  if (!fields) {
    throw new AdpNotConnectedError(
      "ADP credentials could not be decrypted — re-configure (encryption key may have rotated)",
    );
  }

  const cachedToken = loadCachedToken(row);
  if (cachedToken) {
    return {
      id: row.id,
      environment: fields.environment,
      accessToken: cachedToken.accessToken,
      certPem: fields.certPem,
      privateKeyPem: fields.privateKeyPem,
    };
  }

  // Refresh via client_credentials.
  const fresh: ExchangeTokenResult = await exchangeToken({
    environment: fields.environment,
    clientId: fields.clientId,
    clientSecret: fields.clientSecret,
    certPem: fields.certPem,
    privateKeyPem: fields.privateKeyPem,
  });

  await updateTokenCache(
    sql,
    row.id,
    encryptForStorage({
      accessToken: fresh.accessToken,
      expiresAt: fresh.expiresAt.toISOString(),
    }),
  );

  return {
    id: row.id,
    environment: fields.environment,
    accessToken: fresh.accessToken,
    certPem: fields.certPem,
    privateKeyPem: fields.privateKeyPem,
  };
}

function loadCachedToken(row: IntegrationCredentialRow): TokenCache | null {
  if (!row.tokenCacheEnc) return null;
  const cached = decryptJson<TokenCache>(row.tokenCacheEnc);
  if (!cached) return null;
  const expiresAtMs = Date.parse(cached.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  if (expiresAtMs - Date.now() < REFRESH_SKEW_MS) return null;
  return cached;
}

function encryptForStorage(value: TokenCache): string {
  return encryptJson(value);
}

export interface AuditInput {
  coworkerId: string;
  userId: string | null;
  toolName: string;
  args: unknown;
  responseKind: "success" | "error" | "rate-limited";
  resultCount: number | null;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export async function recordToolCall(sql: Sql, input: AuditInput): Promise<void> {
  const row: IntegrationToolCallLogInsert = {
    integration: INTEGRATION,
    coworkerId: input.coworkerId,
    userId: input.userId,
    toolName: input.toolName,
    argsHash: hashArgs(input.args),
    responseKind: input.responseKind,
    resultCount: input.resultCount,
    durationMs: input.durationMs,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  await insertToolCallLog(sql, row);
}

function hashArgs(args: unknown): string {
  const canonical = JSON.stringify(args, Object.keys(args ?? {}).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export { AdpAuthError };
