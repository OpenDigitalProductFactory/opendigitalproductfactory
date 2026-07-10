// Thin Postgres accessor for the adp service.
//
// services/adp is a pnpm workspace member but does not share Prisma with the
// portal. We only touch three tables and a handful of columns, so raw SQL is
// simpler than bundling a duplicate Prisma schema. All writes are additive
// (UPDATE tokenCacheEnc, INSERT audit rows) — the portal's
// /api/integrations/adp/connect still owns credential creation and
// error-state writes.
//
// Uses `pg` (node-postgres), the platform's single canonical Postgres driver
// (apps/web + packages/db), rather than a second driver — EP-8DC217EB BET-14
// dep dedup (BI-C0CEB377). `pg` parameterizes with positional `$n`
// placeholders; column identifiers keep their quoted camelCase so the returned
// row objects match the interfaces below.

import { Pool } from "pg";

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

/** The service's Postgres handle. A `pg` connection pool. */
export type Sql = Pool;

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
  _sql = new Pool({
    connectionString: getConnectionString(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return _sql;
}

// For tests: inject a mock pool instance.
export function setSqlForTesting(sql: Sql | null): void {
  _sql = sql;
}

export async function loadAdpCredential(sql: Sql): Promise<IntegrationCredentialRow | null> {
  const result = await sql.query<IntegrationCredentialRow>(
    `
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
  `,
  );
  return result.rows[0] ?? null;
}

export async function updateTokenCache(
  sql: Sql,
  id: string,
  tokenCacheEnc: string,
): Promise<void> {
  await sql.query(
    `
    UPDATE "IntegrationCredential"
    SET "tokenCacheEnc" = $1, "updatedAt" = NOW()
    WHERE id = $2
  `,
    [tokenCacheEnc, id],
  );
}

export async function insertToolCallLog(
  sql: Sql,
  row: IntegrationToolCallLogInsert,
): Promise<void> {
  await sql.query(
    `
    INSERT INTO "IntegrationToolCallLog" (
      id, "calledAt", integration, "coworkerId", "userId", "toolName",
      "argsHash", "responseKind", "resultCount", "durationMs",
      "errorCode", "errorMessage"
    )
    VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `,
    [
      cuid(),
      row.integration,
      row.coworkerId,
      row.userId,
      row.toolName,
      row.argsHash,
      row.responseKind,
      row.resultCount,
      row.durationMs,
      row.errorCode,
      row.errorMessage,
    ],
  );
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
