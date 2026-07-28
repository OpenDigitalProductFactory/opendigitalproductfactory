// packages/db/src/sanitized-clone.ts
// Sanitized clone pipeline -- copies production data to dev with PII obfuscation.
// Classification driven by table-classification.ts.

import { getTableSensitivity } from "./table-classification";
import { spawn, type ChildProcess } from "node:child_process";
import { pipeline } from "node:stream/promises";

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
// @ts-expect-error -- importable runtime guard is plain .mjs by design
import { checkIndexIntegrity } from "../scripts/index-integrity-core.mjs";

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

export type ColumnTypeInfo = {
  dataType: string;
  udtName: string;
};

export type CloneColumnInfo = ColumnTypeInfo & {
  columnName: string;
  isGenerated: boolean;
};

const OMITTED_NATIVE_TYPES = new Set(["tsvector", "vector"]);

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

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

/**
 * A clone cannot share one transaction with pg_dump/psql child processes.
 * Make publication fail-safe by clearing the disposable destination first and
 * clearing it again before propagating any clone failure.
 */
export async function runWithDestinationCleanup<T>(
  resetDestination: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  await resetDestination();
  try {
    return await clone();
  } catch (cloneError) {
    try {
      await resetDestination();
    } catch (cleanupError) {
      throw new AggregateError(
        [cloneError, cleanupError],
        "Sanitized clone failed and destination cleanup also failed",
      );
    }
    throw cloneError;
  }
}

export async function runSourceCheckedClone<T>(
  resetDestination: () => Promise<void>,
  checkSource: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  return runWithDestinationCleanup(resetDestination, async () => {
    await checkSource();
    return clone();
  });
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

export function prepareInsertParameter(
  value: unknown,
  columnType: ColumnTypeInfo | undefined,
  paramIdx: number,
): { placeholder: string; value: unknown } {
  const placeholder = `$${paramIdx}`;

  if (value === null || value === undefined) {
    return { placeholder, value: null };
  }

  if (columnType?.dataType === "json" || columnType?.dataType === "jsonb") {
    return {
      placeholder: `${placeholder}::${columnType.dataType}`,
      value: JSON.stringify(value),
    };
  }

  if (columnType?.dataType === "ARRAY" && Array.isArray(value)) {
    return {
      placeholder: `${placeholder}::${arrayElementTypeCast(columnType.udtName)}`,
      value: toPostgresTextArrayLiteral(value),
    };
  }

  if (
    columnType &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    const toString = (value as { toString?: () => string }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      return { placeholder, value: toString.call(value) };
    }
    return { placeholder, value };
  }

  if (typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    if (Array.isArray(value)) {
      // PostgreSQL array columns need an array literal. JSON/JSONB arrays are
      // handled above from catalog type information.
      return {
        placeholder: `${placeholder}::text[]`,
        value: toPostgresTextArrayLiteral(value),
      };
    }

    return {
      placeholder: `${placeholder}::jsonb`,
      value: JSON.stringify(value),
    };
  }

  return { placeholder, value };
}

function toPostgresTextArrayLiteral(value: unknown[]): string {
  return `{${value.map((item: unknown) => `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function arrayElementTypeCast(arrayUdtName: string): string {
  if (!arrayUdtName.startsWith("_") || arrayUdtName.length === 1) {
    throw new Error(`Unexpected PostgreSQL array UDT name: ${arrayUdtName}`);
  }

  // PostgreSQL exposes array UDTs as _<element-type>. Quote the catalog-owned
  // identifier so built-ins (int4/text) and case-sensitive custom enums both
  // resolve without treating any part of the name as SQL syntax.
  const elementType = arrayUdtName.slice(1).replaceAll('"', '""');
  return `"${elementType}"[]`;
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

  const prodAdapter = new PrismaPg({ connectionString: prodUrl });
  const devAdapter = new PrismaPg({ connectionString: devUrl });
  const prod = new PrismaClient({ adapter: prodAdapter });
  const dev = new PrismaClient({ adapter: devAdapter });

  try {
    console.log("[sanitized-clone] Connecting to production and dev databases...");
    await prod.$connect();
    await dev.$connect();

    const [productionIdentity, destinationIdentity] = await Promise.all([
      readDatabaseIdentity(prod),
      readDatabaseIdentity(dev),
    ]);
    assertDistinctDatabaseIdentities(productionIdentity, destinationIdentity);

    const destinationTables = await listPublicTables(dev, true);
    const destinationTableNames = new Set(destinationTables.map(({ tablename }) => tablename));

    await runSourceCheckedClone(
      () => resetDestinationData(dev, destinationTables.map(({ tablename }) => tablename)),
      () => assertSourceInventoryIntegrity(prod),
      async () => {
        const tables = await listPublicTables(prod, false);
        console.log(`[sanitized-clone] Found ${tables.length} tables to process`);

        // Build a stable ID-to-index map from the User table for deterministic obfuscation.
        // This happens after the initial reset so even an early source-query failure
        // cannot leave a previously partial preview dataset available.
        const userIdMap = new Map<string, number>();
        const users: Array<{ id: string }> = await prod.$queryRaw`SELECT id FROM "User" ORDER BY id`;
        users.forEach((u, i) => userIdMap.set(u.id, i + 1));

        let autoIndex = users.length;

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
            const rows = await selectRowsForSanitization(prod, dev, tablename, copyCount);
            const obfuscated = obfuscateRows(rows, userIdMap, () => ++autoIndex);
            await insertRowsWithReplicationDisabled(dev, tablename, obfuscated);
            continue;
          }

          if (sensitivity === "public" || sensitivity === "internal") {
            console.log(`  COPY (${sensitivity}): ${tablename} (${rowCount} rows)`);
            await copyTableCompatible(tablename, prodUrl, devUrl, prod, dev);
          } else if (sensitivity === "confidential") {
            console.log(`  OBFUSCATE (confidential): ${tablename} (${rowCount} rows)`);
            const rows = await selectRowsForSanitization(prod, dev, tablename);
            const obfuscated = obfuscateRows(rows, userIdMap, () => ++autoIndex);
            await insertRowsWithReplicationDisabled(dev, tablename, obfuscated);
          }
        }
      },
    );

    console.log("[sanitized-clone] PostgreSQL clone complete");
  } finally {
    await prod.$disconnect();
    await dev.$disconnect();
  }
}

async function assertSourceInventoryIntegrity(
  source: RawDatabaseClient,
): Promise<void> {
  const queryClient = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await source.$queryRawUnsafe<unknown[]>(
        sql,
        ...(params as never[]),
      ),
    }),
  };
  const report = await checkIndexIntegrity(queryClient, {
    amcheckMode: "require",
    schema: "public",
    table: "InventoryEntity",
    uniqueOnly: false,
    requiredIndexes: [{ name: "InventoryEntity_entityKey_key", unique: true }],
  });
  if (!report.failed) return;

  const details = report.corrupted
    .map((row: { index: string; error: string }) => `${row.index}: ${row.error}`)
    .join("; ");
  throw new Error(
    `Production InventoryEntity source failed index/heap integrity; preview was not published. ${details}`,
  );
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

async function selectRowsForSanitization(
  sourceClient: RawDatabaseClient,
  destinationClient: RawDatabaseClient,
  tableName: string,
  limit?: number,
): Promise<Array<Record<string, unknown>>> {
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

  const quotedTable = quoteIdentifier(tableName);
  const orderColumn = compatibleColumns.has("createdAt")
    ? quoteIdentifier("createdAt")
    : compatibleColumns.has("id")
      ? quoteIdentifier("id")
      : null;
  const orderClause = limit && orderColumn ? ` ORDER BY ${orderColumn} DESC` : "";
  const limitClause = limit ? ` LIMIT ${Math.max(0, Math.trunc(limit))}` : "";

  return sourceClient.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${selectList} FROM ${quotedTable}${orderClause}${limitClause}`,
  );
}

function obfuscateRows(
  rows: Array<Record<string, unknown>>,
  userIdMap: ReadonlyMap<string, number>,
  nextIndex: () => number,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const userId = (row.id ?? row.userId ?? row.createdById) as string | undefined;
    const idx = userId && userIdMap.has(userId)
      ? userIdMap.get(userId)!
      : nextIndex();
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && key in PII_FIELDS) {
        result[key] = obfuscateField(value, key, idx);
      } else if (key === "passwordHash") {
        result[key] = "$2a$10$devhashplaceholdernotreal000000000000000000000";
      } else {
        result[key] = value;
      }
    }
    return result;
  });
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
): Promise<void> {
  if (rows.length === 0) return;

  const columnTypes = await getColumnTypes(client, tableName);

  for (const row of rows) {
    const columns = Object.keys(row);
    const values: unknown[] = [];
    const castPlaceholders: string[] = [];
    let paramIdx = 1;

    for (const col of columns) {
      const prepared = prepareInsertParameter(row[col], columnTypes.get(col), paramIdx);
      castPlaceholders.push(prepared.placeholder);
      values.push(prepared.value);
      paramIdx++;
    }

    const columnList = columns.map(quoteIdentifier).join(", ");

    await client.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${castPlaceholders.join(", ")}) ON CONFLICT DO NOTHING`,
      ...values,
    );
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

export async function insertRowsWithReplicationDisabled(
  client: PrismaClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  policy: Readonly<SanitizedCloneInsertTransactionPolicy> = SANITIZED_CLONE_INSERT_TRANSACTION_POLICY,
): Promise<void> {
  if (rows.length === 0) return;

  const batchSize = Math.max(1, Math.trunc(policy.batchSize));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await client.$transaction(async (transaction) => {
      // PrismaPg uses a pool, so a SET issued before the transaction is not
      // guaranteed to govern the connection used by the inserts. SET LOCAL
      // pins the trigger posture to each bounded batch transaction and restores
      // it automatically. Destination-wide cleanup owns clone atomicity.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await insertRows(transaction, tableName, batch);
    }, {
      maxWait: policy.maxWaitMs,
      timeout: policy.timeoutMs,
    });
  }
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

// ── Neo4j Clone Pipeline ─────────────────────────────────────────────────────

/**
 * Clone Neo4j graph structure from production to dev with PII obfuscation.
 * Uses HTTP API. Both NEO4J_URI (dev) and PRODUCTION_NEO4J_URI (prod) must be set.
 */
export async function runNeo4jClone(): Promise<void> {
  const prodUri = process.env.PRODUCTION_NEO4J_URI;
  const devUri = process.env.NEO4J_URI;
  const prodUser = process.env.PRODUCTION_NEO4J_USER ?? process.env.NEO4J_USER ?? "neo4j";
  const prodPassword = process.env.PRODUCTION_NEO4J_PASSWORD ?? process.env.NEO4J_PASSWORD ?? "dpf_dev_password";

  if (!prodUri) {
    console.log("[sanitized-clone] PRODUCTION_NEO4J_URI not set, skipping Neo4j clone");
    return;
  }
  if (!devUri) {
    console.log("[sanitized-clone] NEO4J_URI not set, skipping Neo4j clone");
    return;
  }

  // Extract host:port from bolt:// URIs for HTTP access
  const prodHttpUrl = prodUri.replace("bolt://", "http://").replace(":7687", ":7474");

  const auth = Buffer.from(`${prodUser}:${prodPassword}`).toString("base64");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`,
  };

  console.log("[sanitized-clone] Exporting Neo4j graph from production...");

  try {
    const exportResponse = await fetch(`${prodHttpUrl}/db/neo4j/tx/commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        statements: [
          { statement: "MATCH (n) RETURN count(n) as nodeCount" },
          { statement: "MATCH ()-[r]->() RETURN count(r) as relCount" },
        ],
      }),
    });

    if (!exportResponse.ok) {
      console.log(`[sanitized-clone] Neo4j export failed: ${exportResponse.status}, skipping`);
      return;
    }

    const exportData = await exportResponse.json() as { results?: { data?: { row?: number[] }[] }[] };
    const nodeCount = exportData.results?.[0]?.data?.[0]?.row?.[0] ?? 0;
    const relCount = exportData.results?.[1]?.data?.[0]?.row?.[0] ?? 0;

    console.log(`[sanitized-clone] Neo4j production has ${nodeCount} nodes, ${relCount} relationships`);
    console.log("[sanitized-clone] Neo4j clone: structure counted (full APOC import TBD)");
  } catch (err) {
    console.log(`[sanitized-clone] Neo4j clone skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("sanitized-clone.ts") || process.argv[1]?.endsWith("sanitized-clone.js")) {
  runSanitizedClone()
    .then(() => runNeo4jClone())
    .then(() => {
      console.log("[sanitized-clone] Done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[sanitized-clone] Failed:", err);
      process.exit(1);
    });
}
