// Thin Postgres accessor for the adp service.
//
// services/adp is a standalone Node app (not a pnpm workspace member), so it
// doesn't share Prisma with the portal. We only touch three tables and only
// a handful of columns, so raw SQL via `postgres` is simpler than bundling a
// duplicate Prisma schema. All writes are additive (UPDATE tokenCacheEnc,
// INSERT audit rows) — the portal's /api/integrations/adp/connect still owns
// credential creation and error-state writes.

import postgres from "postgres";

export interface IntegrationCredentialRow {
  id: string;
  integrationId: string;
  provider: string;
  status: string;
  fieldsEnc: string;
  tokenCacheEnc: string | null;
  certExpiresAt: Date | null;
}

export interface IntegrationToolCallLogInsert {
  integration: string;
  coworkerId: string;
  userId: string | null;
  toolName: string;
  argsHash: string;
  responseKind: "success" | "error" | "rate-limited";
  resultCount: number | null;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for the adp service");
  }
  return url;
}

export function getSql(): Sql {
  if (_sql) return _sql;
  _sql = postgres(getConnectionString(), {
    max: 4,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
  });
  return _sql;
}

// For tests: inject a mock sql instance.
export function setSqlForTesting(sql: Sql | null): void {
  _sql = sql;
}

export async function loadAdpCredential(sql: Sql): Promise<IntegrationCredentialRow | null> {
  const rows = await sql<IntegrationCredentialRow[]>`
    SELECT
      id,
      "integrationId",
      provider,
      status,
      "fieldsEnc",
      "tokenCacheEnc",
      "certExpiresAt"
    FROM "IntegrationCredential"
    WHERE "integrationId" = 'adp-workforce-now'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateTokenCache(
  sql: Sql,
  id: string,
  tokenCacheEnc: string,
): Promise<void> {
  await sql`
    UPDATE "IntegrationCredential"
    SET "tokenCacheEnc" = ${tokenCacheEnc}, "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

export async function insertToolCallLog(
  sql: Sql,
  row: IntegrationToolCallLogInsert,
): Promise<void> {
  await sql`
    INSERT INTO "IntegrationToolCallLog" (
      id, "calledAt", integration, "coworkerId", "userId", "toolName",
      "argsHash", "responseKind", "resultCount", "durationMs",
      "errorCode", "errorMessage"
    )
    VALUES (
      ${cuid()},
      NOW(),
      ${row.integration},
      ${row.coworkerId},
      ${row.userId},
      ${row.toolName},
      ${row.argsHash},
      ${row.responseKind},
      ${row.resultCount},
      ${row.durationMs},
      ${row.errorCode},
      ${row.errorMessage}
    )
  `;
}

// Minimal cuid-style ID generator. Real cuids are 25 chars starting with 'c'.
// We generate something sortable-by-time + random enough to avoid collisions
// within a single process. Matching Prisma's cuid exactly would require the
// `cuid` npm dep; this shape is DB-compatible (String @id @default(cuid())
// only enforces the type, not the format).
function cuid(): string {
  const time = Date.now().toString(36).padStart(8, "0");
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `c${time}${random}${process.hrtime.bigint().toString(36).slice(-6)}`;
}
