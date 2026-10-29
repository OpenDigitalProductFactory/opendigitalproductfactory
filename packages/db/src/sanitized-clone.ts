// packages/db/src/sanitized-clone.ts
// Sanitized clone pipeline -- copies production data to dev with PII obfuscation.
// Classification driven by table-classification.ts.
// Postgres-only: since BET-5 (BI-A1E864A5) the graph mirror and vectors live in
// Postgres, so they ride along in the Postgres clone; the former graph-store
// clone step was removed in BI-B1977CEE.

import { getTableSensitivity } from "./table-classification";
import { spawn, type ChildProcess } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { copySanitizedCursorBatches, type CloneFetchMetrics } from "./sanitized-clone-batches";
import { buildSanitizedInsertStatements, quoteIdentifier, type ColumnTypeInfo } from "./sanitized-clone-sql";
export { prepareInsertParameter, quoteIdentifier, type ColumnTypeInfo } from "./sanitized-clone-sql";
import { provisionContributorPreviewAdmin, requireContributorPreviewPassword } from "./contributor-preview-auth";

// -- Obfuscation Helpers --

export function obfuscateName(_original: string | null, index: number): string {
  return `Dev User ${String(index).padStart(3, "0")}`;
}

export function obfuscateEmail(_original: string | null, index: number): string {
  return `dev${String(index).padStart(3, "0")}@dpf.test`;
}

export function obfuscatePhone(_original: string | null, index: number): string {
  return `555-${String(index).padStart(4, "0")}`;
}

/** PII field names that should be obfuscated in confidential tables */
const PII_FIELDS: Record<string, (val: string | null, idx: number) => string> = {
  name: obfuscateName,
  displayName: obfuscateName,
  firstName: obfuscateName,
  lastName: obfuscateName,
  email: obfuscateEmail,
  phone: obfuscatePhone,
  contactEmail: obfuscateEmail,
  contactPhone: obfuscatePhone,
};

export { PII_FIELDS };

const INVALIDATED_PASSWORD_HASH = "$2a$10$devhashplaceholdernotreal000000000000000000000";

export function obfuscateField(
  value: string | null | undefined,
  fieldName: string,
  index: number,
): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const fn = PII_FIELDS[fieldName];
  return fn ? fn(value, index) : value;
}

export function sanitizeConfidentialRow(
  row: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === "string" && key in PII_FIELDS) {
        return [key, obfuscateField(value, key, index)];
      }
      if (key === "passwordHash") {
        return [key, INVALIDATED_PASSWORD_HASH];
      }
      return [key, value];
    }),
  );
}

// -- Table Classification Helpers --

export function shouldCopyTable(tableName: string): boolean {
  const s = getTableSensitivity(tableName);
  return s === "public" || s === "internal";
}

export function shouldObfuscateTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "confidential";
}

export function shouldSkipTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "restricted";
}

// ── PostgreSQL Clone Pipeline ────────────────────────────────────────────────

import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runSourceCheckedClone } from "./sanitized-clone-cleanup";
import { assertSanitizedCloneSourceIntegrity } from "./sanitized-clone-source-integrity";
import { resetCloneInstallationIdentity } from "./sanitized-clone-identity-reset";

export {
  runSourceCheckedClone,
  runWithDestinationCleanup,
} from "./sanitized-clone-cleanup";

type RawDatabaseClient = Pick<
  PrismaClient,
  "$queryRawUnsafe" | "$executeRawUnsafe"
>;

/** Tables that contain audit/log data — clone only the last N rows with obfuscation */
const AUDIT_TABLES = new Set([
  "ComplianceAuditLog",
  "AuthorizationDecisionLog",
  "RouteDecisionLog",
  "RouteOutcome",
]);

/** Maximum audit records to clone per table */
const AUDIT_RECORD_LIMIT = 50;

export type CloneColumnInfo = ColumnTypeInfo & {
  columnName: string;
  isGenerated: boolean;
};

const OMITTED_NATIVE_TYPES = new Set(["tsvector", "vector"]);

/**
 * Build a SELECT projection that never asks Prisma to deserialize native
 * search/vector representations. Those values can encode source content, so
 * they are intentionally omitted rather than copied as text.
 */
export function buildSanitizedSelectList(
  columnTypes: ReadonlyMap<string, ColumnTypeInfo>,
): string {
  return [...columnTypes.entries()]
    .map(([columnName, type]) => {
      const quoted = quoteIdentifier(columnName);
      return OMITTED_NATIVE_TYPES.has(type.udtName)
        ? `NULL::text AS ${quoted}`
        : quoted;
    })
    .join(", ");
}

export function buildDestinationResetSql(tableNames: readonly string[]): string | null {
  const applicationTables = tableNames.filter((name) => name !== "_prisma_migrations");
  if (applicationTables.length === 0) return null;
  return `TRUNCATE TABLE ${applicationTables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`;
}

export function resolveCompatibleCopyColumns(
  sourceColumns: readonly CloneColumnInfo[],
  destinationColumns: readonly CloneColumnInfo[],
  tableName: string,
): string[] {
  const destinationByName = new Map(
    destinationColumns.map((column) => [column.columnName, column]),
  );
  const compatible: string[] = [];

  for (const source of sourceColumns) {
    const destination = destinationByName.get(source.columnName);
    if (!destination || source.isGenerated || destination.isGenerated) continue;

    if (source.dataType !== destination.dataType || source.udtName !== destination.udtName) {
      throw new Error(
        `Sanitized clone type mismatch for ${tableName}.${source.columnName}: source ${source.dataType}/${source.udtName}, destination ${destination.dataType}/${destination.udtName}`,
      );
    }
    compatible.push(source.columnName);
  }

  if (compatible.length === 0) {
    throw new Error(`Sanitized clone found no compatible insertable columns for ${tableName}`);
  }
  return compatible;
}

export function buildCompatibleSanitizedSelectList(
  sourceColumns: readonly CloneColumnInfo[],
  destinationColumns: readonly CloneColumnInfo[],
  tableName: string,
): string {
  const compatibleColumns = new Set(
    resolveCompatibleCopyColumns(sourceColumns, destinationColumns, tableName),
  );
  const columnTypes = new Map(
    sourceColumns
      .filter((column) => compatibleColumns.has(column.columnName))
      .map((column) => [
        column.columnName,
        { dataType: column.dataType, udtName: column.udtName },
      ]),
  );
  return buildSanitizedSelectList(columnTypes);
}

export function buildSourceCopyArgs(
  prodUrl: string,
  tableName: string,
  columns: readonly string[],
): string[] {
  const projection = columns.map(quoteIdentifier).join(", ");
  return [
    `--dbname=${prodUrl}`,
    "--set=ON_ERROR_STOP=1",
    `--command=COPY (SELECT ${projection} FROM ${quoteIdentifier(tableName)}) TO STDOUT WITH (FORMAT binary)`,
  ];
}

export function buildDestinationCopyArgs(
  devUrl: string,
  tableName: string,
  columns: readonly string[],
): string[] {
  const columnList = columns.map(quoteIdentifier).join(", ");
  return [
    `--dbname=${devUrl}`,
    "--set=ON_ERROR_STOP=1",
    `--command=COPY ${quoteIdentifier(tableName)} (${columnList}) FROM STDIN WITH (FORMAT binary)`,
  ];
}

export function buildPsqlArgs(devUrl: string): string[] {
  return [`--dbname=${devUrl}`, "--set=ON_ERROR_STOP=1"];
}

export function buildPsqlEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const replicationOption = "-c session_replication_role=replica";
  return {
    ...base,
    PGOPTIONS: base.PGOPTIONS
      ? `${base.PGOPTIONS} ${replicationOption}`
      : replicationOption,
  };
}

export type DatabaseIdentity = {
  databaseName: string;
  serverAddress: string;
  serverPort: number | null;
};

export function assertDistinctDatabaseIdentities(
  production: DatabaseIdentity,
  destination: DatabaseIdentity,
): void {
  if (
    production.databaseName === destination.databaseName
    && production.serverAddress === destination.serverAddress
    && production.serverPort === destination.serverPort
  ) {
    throw new Error(
      "PRODUCTION_DATABASE_URL and DATABASE_URL resolve to the same PostgreSQL database; refusing to clear the source",
    );
  }
}

/**
 * Run the sanitized clone from production to dev.
 * Both DATABASE_URL (dev) and PRODUCTION_DATABASE_URL (production) must be set.
 */
export async function runSanitizedClone(): Promise<void> {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  const devUrl = process.env.DATABASE_URL;

  if (!prodUrl) throw new Error("PRODUCTION_DATABASE_URL is not set");
  if (!devUrl) throw new Error("DATABASE_URL is not set");
  if (process.env.DPF_ENVIRONMENT !== "dev") {
    throw new Error("Sanitized Contributor preview provisioning requires DPF_ENVIRONMENT=dev");
  }
  const previewPassword = requireContributorPreviewPassword(
    process.env.CONTRIBUTOR_PREVIEW_PASSWORD,
  );

  const prodAdapter = new PrismaPg({ connectionString: prodUrl });
  const devAdapter = new PrismaPg({ connectionString: devUrl });
  const prod = new PrismaClient({ adapter: prodAdapter });
  const dev = new PrismaClient({ adapter: devAdapter });
  const sanitizedSource = new Client({ connectionString: prodUrl });

  try {
    console.log("[sanitized-clone] Connecting to production and dev databases...");
    await prod.$connect();
    await dev.$connect();
    await sanitizedSource.connect();
    // All confidential tables share one read-only snapshot and user ranking.
    await sanitizedSource.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const [productionIdentity, destinationIdentity] = await Promise.all([
      readDatabaseIdentity(prod),
      readDatabaseIdentity(dev),
    ]);
    assertDistinctDatabaseIdentities(productionIdentity, destinationIdentity);

    const destinationTables = await listPublicTables(dev, true);
    const destinationTableNames = new Set(destinationTables.map(({ tablename }) => tablename));

    await runSourceCheckedClone(
      () => resetDestinationData(dev, destinationTables.map(({ tablename }) => tablename)),
      () => assertSanitizedCloneSourceIntegrity(prod),
      async () => {
        const tables = await listPublicTables(prod, false);
        console.log(`[sanitized-clone] Found ${tables.length} tables to process`);

        // PostgreSQL owns user ranking; never materialize a User map in JS.
        const userCount = (await sanitizedSource.query('SELECT count(*) AS count FROM "User"')).rows;
        let autoIndex = Number(userCount[0]?.count ?? 0);
        const insertSanitizedRows = createSanitizedCloneInsertWriter(dev);
        const writeSanitizedBatch = async (tableName: string, rows: Array<Record<string, unknown>>, metrics: CloneFetchMetrics & { sanitizeMs: number; writeMs: number; transactionMs: number; transactionAttempts: number }) => {
          const transformStarted = performance.now();
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const userIndex = row.__dpfCloneUserIndex;
            delete row.__dpfCloneUserIndex;
            rows[i] = sanitizeConfidentialRow(row, userIndex == null ? ++autoIndex : Number(userIndex));
          }
          metrics.sanitizeMs += performance.now() - transformStarted;
          const writeStarted = performance.now();
          try { await insertSanitizedRows(tableName, rows, metrics); }
          finally { metrics.writeMs += performance.now() - writeStarted; }
        };
        const copySanitizedTable = async (tableName: string, limit?: number) => {
          const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, writeMs: 0, transactionMs: 0, transactionAttempts: 0 };
          const started = performance.now();
          let completed = false;
          try {
            await copyRowsForSanitization(sanitizedSource, prod, dev, tableName,
              rows => writeSanitizedBatch(tableName, rows, metrics), limit, metrics);
            completed = true;
          } finally {
            // transactionMs is a subset of writeMs, not an additive phase.
            console.log(`[sanitized-clone-phase] ${JSON.stringify({ table: tableName, completed, elapsedMs: performance.now() - started, ...metrics })}`);
          }
        };

        for (const { tablename } of tables) {
          if (!destinationTableNames.has(tablename)) {
            console.log(`  SKIP (source schema ahead): ${tablename}`);
            continue;
          }
          const sensitivity = getTableSensitivity(tablename);

          if (sensitivity === "restricted") {
            console.log(`  SKIP (restricted): ${tablename}`);
            continue;
          }

          const quotedTable = quoteIdentifier(tablename);
          const countResult: Array<{ count: bigint }> = await prod.$queryRawUnsafe(
            `SELECT count(*) as count FROM ${quotedTable}`,
          );
          const rowCount = Number(countResult[0]?.count ?? 0);

          if (rowCount === 0) {
            console.log(`  EMPTY: ${tablename}`);
            continue;
          }

          if (AUDIT_TABLES.has(tablename)) {
            const copyCount = Math.min(rowCount, AUDIT_RECORD_LIMIT);
            console.log(`  AUDIT (last ${copyCount} of ${rowCount}): ${tablename}`);
            await copySanitizedTable(tablename, copyCount);
            continue;
          }

          if (sensitivity === "public" || sensitivity === "internal") {
            console.log(`  COPY (${sensitivity}): ${tablename} (${rowCount} rows)`);
            await copyTableCompatible(tablename, prodUrl, devUrl, prod, dev);
          } else if (sensitivity === "confidential") {
            console.log(`  OBFUSCATE (confidential): ${tablename} (${rowCount} rows)`);
            await copySanitizedTable(tablename);
          }
        }

        await resetCloneInstallationIdentity(dev);
        await provisionContributorPreviewAdmin(dev, previewPassword);
      },
    );

    await sanitizedSource.query("COMMIT");
    console.log("[sanitized-clone] PostgreSQL clone complete");
  } finally {
    await sanitizedSource.end();
    await prod.$disconnect();
    await dev.$disconnect();
  }
}

async function readDatabaseIdentity(client: RawDatabaseClient): Promise<DatabaseIdentity> {
  const rows = await client.$queryRawUnsafe<DatabaseIdentity[]>(
    `SELECT current_database()::text AS "databaseName",
            COALESCE(inet_server_addr()::text, 'local') AS "serverAddress",
            inet_server_port()::int AS "serverPort"`,
  );
  const identity = rows[0];
  if (!identity) throw new Error("Unable to identify PostgreSQL clone endpoint");
  return identity;
}

async function listPublicTables(
  client: RawDatabaseClient,
  includeMigrationTable: boolean,
): Promise<Array<{ tablename: string }>> {
  const migrationPredicate = includeMigrationTable
    ? ""
    : "AND tablename != '_prisma_migrations'";
  return client.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        ${migrationPredicate}
      ORDER BY tablename`,
  );
}

async function resetDestinationData(
  client: RawDatabaseClient,
  tableNames: readonly string[],
): Promise<void> {
  const resetSql = buildDestinationResetSql(tableNames);
  if (!resetSql) return;
  console.log(`[sanitized-clone] Resetting ${tableNames.filter((name) => name !== "_prisma_migrations").length} destination tables`);
  await client.$executeRawUnsafe(resetSql);
}

async function copyRowsForSanitization(
  source: Client,
  sourceClient: RawDatabaseClient,
  destinationClient: RawDatabaseClient,
  tableName: string,
  write: (rows: Array<Record<string, unknown>>) => Promise<void>,
  limit?: number,
  metrics?: CloneFetchMetrics,
): Promise<void> {
  const [sourceColumns, destinationColumns] = await Promise.all([
    getCloneColumns(sourceClient, tableName),
    getCloneColumns(destinationClient, tableName),
  ]);
  const selectList = buildCompatibleSanitizedSelectList(
    sourceColumns,
    destinationColumns,
    tableName,
  );
  const compatibleColumns = new Set(
    resolveCompatibleCopyColumns(sourceColumns, destinationColumns, tableName),
  );

  const selectSql = buildSanitizedCursorQuery(tableName, selectList, compatibleColumns, limit);
  await copySanitizedCursorBatches(source, selectSql, async rows => {
    for (const row of rows) delete row.__dpfCloneRowOrder;
    await write(rows);
  }, 50, false, metrics);

}

/** Build the actual confidential cursor query, including its stable alias order. */
export function buildSanitizedCursorQuery(
  tableName: string,
  selectList: string,
  compatibleColumns: ReadonlySet<string>,
  limit?: number,
): string {
  const quotedTable = quoteIdentifier(tableName);
  const ordering = limit && compatibleColumns.has("createdAt")
    ? ["createdAt", ...(compatibleColumns.has("id") ? ["id"] : [])]
    : compatibleColumns.has("id") ? ["id"] : [];
  const orderSql = ordering.length
    ? ordering.map(column => quoteIdentifier(column) + (limit ? " DESC" : " ASC")).join(", ")
    : "ctid";
  const limitClause = limit ? ` LIMIT ${Math.max(0, Math.trunc(limit))}` : "";
  // Match the existing obfuscator's first non-null id/userId/createdById rule.
  const references = ["id", "userId", "createdById"].filter(column => compatibleColumns.has(column));
  const referenceSql = references.map(column => `r.${quoteIdentifier(column)}::text`).join(", ");
  // Carry the ordering through the join; batch boundaries cannot change aliases.
  const rowsSql = `SELECT ${selectList}, row_number() OVER (ORDER BY ${orderSql}) AS "__dpfCloneRowOrder" FROM ${quotedTable} ORDER BY ${orderSql}${limitClause}`;
  // The original keys expose the existing path ordering to PostgreSQL. Sorting
  // only by the generated ordinal forces a blocking full-table sort. Retain the
  // ordinal last so tied keys keep exactly the window's assigned alias order.
  const joinedOrderSql = [
    ...ordering.map(column => `r.${quoteIdentifier(column)}${limit ? " DESC" : " ASC"}`),
    'r."__dpfCloneRowOrder"',
  ].join(", ");
  const selectSql = references.length
    ? `SELECT r.*, u."__dpfCloneUserIndex" FROM (${rowsSql}) r LEFT JOIN
       (SELECT id, row_number() OVER (ORDER BY id) AS "__dpfCloneUserIndex" FROM "User") u
       ON u.id = ${references.length === 1 ? referenceSql : `COALESCE(${referenceSql})`}
       ORDER BY ${joinedOrderSql}`
    : rowsSql;
  return selectSql;
}

/**
 * Stream all compatible rows from production to dev using PostgreSQL binary
 * COPY. The explicit catalog-derived projection tolerates additive schema skew
 * without serializing values through JavaScript.
 */
async function copyTableCompatible(
  tableName: string,
  prodUrl: string,
  devUrl: string,
  prod: RawDatabaseClient,
  dev: RawDatabaseClient,
): Promise<void> {
  const [sourceColumns, destinationColumns] = await Promise.all([
    getCloneColumns(prod, tableName),
    getCloneColumns(dev, tableName),
  ]);
  const columns = resolveCompatibleCopyColumns(sourceColumns, destinationColumns, tableName);

  const sourcePsql = spawn("psql", buildSourceCopyArgs(prodUrl, tableName, columns), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const destinationPsql = spawn("psql", buildDestinationCopyArgs(devUrl, tableName, columns), {
    stdio: ["pipe", "ignore", "pipe"],
    env: buildPsqlEnvironment(),
  });

  const sourceError = collectBoundedStderr(sourcePsql);
  const destinationError = collectBoundedStderr(destinationPsql);

  try {
    await Promise.all([
      pipeline(sourcePsql.stdout!, destinationPsql.stdin!),
      waitForChild(sourcePsql, "source psql", sourceError),
      waitForChild(destinationPsql, "destination psql", destinationError),
    ]);
  } catch (error) {
    sourcePsql.kill();
    destinationPsql.kill();
    throw error;
  }
}

function collectBoundedStderr(child: ChildProcess): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  child.stderr?.on("data", (chunk: Buffer | string) => {
    if (size >= 8_192) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = 8_192 - size;
    chunks.push(buffer.subarray(0, remaining));
    size += Math.min(buffer.length, remaining);
  });
  return () => Buffer.concat(chunks).toString("utf8").trim();
}

function waitForChild(
  child: ChildProcess,
  label: string,
  stderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr();
      reject(new Error(
        `${label} failed (${signal ? `signal ${signal}` : `exit ${String(code)}`})${detail ? `: ${detail}` : ""}`,
      ));
    });
  });
}

/**
 * Insert rows into a table using raw SQL with proper type casting.
 * Used for obfuscated rows where we've modified values in JS.
 * The caller disables FK triggers in the same transaction used for the inserts.
 */
async function insertRows(
  client: RawDatabaseClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  columnTypes: ReadonlyMap<string, ColumnTypeInfo>,
): Promise<void> {
  for (const statement of buildSanitizedInsertStatements(tableName, rows, columnTypes)) {
    await client.$executeRawUnsafe(statement.sql, ...statement.values);
  }
}

export type SanitizedCloneInsertTransactionPolicy = {
  batchSize: number;
  maxWaitMs: number;
  timeoutMs: number;
};

export const SANITIZED_CLONE_INSERT_TRANSACTION_POLICY: Readonly<SanitizedCloneInsertTransactionPolicy> = Object.freeze({
  batchSize: 500,
  maxWaitMs: 10_000,
  timeoutMs: 30_000,
});

/** One clone attempt owns this cache; a new clone never reuses another schema's metadata. */
export function createSanitizedCloneInsertWriter(
  client: PrismaClient,
  policy: Readonly<SanitizedCloneInsertTransactionPolicy> = SANITIZED_CLONE_INSERT_TRANSACTION_POLICY,
): (tableName: string, rows: Array<Record<string, unknown>>, metrics?: { transactionAttempts: number; transactionMs: number }) => Promise<void> {
  const typesByTable = new Map<string, Map<string, ColumnTypeInfo>>();
  return async (tableName, rows, metrics) => {
    const batchSize = Math.max(1, Math.trunc(policy.batchSize));
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const started = performance.now();
      if (metrics) metrics.transactionAttempts++;
      try { await client.$transaction(async transaction => {
        // Pin trigger suppression to the connection used by these bounded writes.
        // Existing destination-wide cleanup still owns clone publication safety.
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        let columnTypes = typesByTable.get(tableName);
        if (!columnTypes) {
          columnTypes = await getColumnTypes(transaction, tableName);
          typesByTable.set(tableName, columnTypes);
        }
        await insertRows(transaction, tableName, batch, columnTypes);
      }, { maxWait: policy.maxWaitMs, timeout: policy.timeoutMs }); }
      finally { if (metrics) metrics.transactionMs += performance.now() - started; }
    }
  };
}

/** Compatibility entry: one direct call is an isolated attempt. */
export async function insertRowsWithReplicationDisabled(
  client: PrismaClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  policy: Readonly<SanitizedCloneInsertTransactionPolicy> = SANITIZED_CLONE_INSERT_TRANSACTION_POLICY,
): Promise<void> {
  await createSanitizedCloneInsertWriter(client, policy)(tableName, rows);
}

async function getColumnTypes(
  client: RawDatabaseClient,
  tableName: string,
): Promise<Map<string, ColumnTypeInfo>> {
  const rows = await client.$queryRawUnsafe<Array<{
    columnName: string;
    dataType: string;
    udtName: string;
  }>>(
    `SELECT column_name AS "columnName", data_type AS "dataType", udt_name AS "udtName"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    tableName,
  );

  return new Map(
    rows.map((row) => [
      row.columnName,
      { dataType: row.dataType, udtName: row.udtName },
    ]),
  );
}

async function getCloneColumns(
  client: RawDatabaseClient,
  tableName: string,
): Promise<CloneColumnInfo[]> {
  const rows = await client.$queryRawUnsafe<Array<{
    columnName: string;
    dataType: string;
    udtName: string;
    isGenerated: "ALWAYS" | "NEVER";
  }>>(
    `SELECT column_name AS "columnName",
            data_type AS "dataType",
            udt_name AS "udtName",
            is_generated AS "isGenerated"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    tableName,
  );

  return rows.map((row) => ({
    columnName: row.columnName,
    dataType: row.dataType,
    udtName: row.udtName,
    isGenerated: row.isGenerated === "ALWAYS",
  }));
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("sanitized-clone.ts") || process.argv[1]?.endsWith("sanitized-clone.js")) {
  runSanitizedClone()
    .then(() => {
      console.log("[sanitized-clone] Done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[sanitized-clone] Failed:", err);
      process.exit(1);
    });
}
