// packages/db/src/sanitized-clone.ts
// Sanitized clone pipeline -- copies production data to dev with PII obfuscation.
// Classification driven by table-classification.ts.

import { getTableSensitivity } from "./table-classification";

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

/** Tables that contain audit/log data — clone only the last N rows with obfuscation */
const AUDIT_TABLES = new Set([
  "ComplianceAuditLog",
  "AuthorizationDecisionLog",
  "RouteDecisionLog",
  "RouteOutcome",
]);

/** Maximum audit records to clone per table */
const AUDIT_RECORD_LIMIT = 50;

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

    // Get all table names from production
    const tables: Array<{ tablename: string }> = await prod.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
      ORDER BY tablename
    `;

    console.log(`[sanitized-clone] Found ${tables.length} tables to process`);

    // Build a stable ID-to-index map from the User table for deterministic obfuscation
    const userIdMap = new Map<string, number>();
    const users: Array<{ id: string }> = await prod.$queryRaw`SELECT id FROM "User" ORDER BY id`;
    users.forEach((u, i) => userIdMap.set(u.id, i + 1));

    // Disable all FK constraints globally for the clone operation
    await dev.$executeRawUnsafe(`SET session_replication_role = replica`);

    let autoIndex = users.length; // Counter for rows without a user ID reference

    for (const { tablename } of tables) {
      const sensitivity = getTableSensitivity(tablename);

      // Audit tables override normal classification — clone last 50 rows with obfuscation
      if (AUDIT_TABLES.has(tablename)) {
        let rows: Array<Record<string, unknown>>;
        try {
          rows = await prod.$queryRawUnsafe(
            `SELECT * FROM "${tablename}" ORDER BY "createdAt" DESC LIMIT ${AUDIT_RECORD_LIMIT}`,
          );
        } catch {
          // Table may not have createdAt column
          rows = await prod.$queryRawUnsafe(
            `SELECT * FROM "${tablename}" LIMIT ${AUDIT_RECORD_LIMIT}`,
          );
        }
        if (rows.length > 0) {
          console.log(`  AUDIT (last ${rows.length}): ${tablename}`);
          const obfuscated = rows.map((row) => {
            const idx = ++autoIndex;
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === "string" && key in PII_FIELDS) {
                result[key] = obfuscateField(value, key, idx);
              } else {
                result[key] = value;
              }
            }
            return result;
          });
          await insertRows(dev, tablename, obfuscated);
        } else {
          console.log(`  AUDIT (empty): ${tablename}`);
        }
        continue;
      }

      if (sensitivity === "restricted") {
        console.log(`  SKIP (restricted): ${tablename}`);
        continue;
      }

      // Count source rows
      const countResult: Array<{ count: bigint }> = await prod.$queryRawUnsafe(
        `SELECT count(*) as count FROM "${tablename}"`,
      );
      const rowCount = Number(countResult[0]?.count ?? 0);

      if (rowCount === 0) {
        console.log(`  EMPTY: ${tablename}`);
        continue;
      }

      if (sensitivity === "public" || sensitivity === "internal") {
        // Copy verbatim
        console.log(`  COPY (${sensitivity}): ${tablename} (${rowCount} rows)`);
        const rows: Array<Record<string, unknown>> = await prod.$queryRawUnsafe(
          `SELECT * FROM "${tablename}"`,
        );
        await insertRows(dev, tablename, rows);
      } else if (sensitivity === "confidential") {
        console.log(`  OBFUSCATE (confidential): ${tablename} (${rowCount} rows)`);
        const rows: Array<Record<string, unknown>> = await prod.$queryRawUnsafe(
          `SELECT * FROM "${tablename}"`,
        );
        const obfuscated = rows.map((row) => {
          // Derive index from user ID if present, otherwise use auto-incrementing counter
          const userId = (row.id ?? row.userId ?? row.createdById) as string | undefined;
          const idx = userId && userIdMap.has(userId)
            ? userIdMap.get(userId)!
            : ++autoIndex;
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
        await insertRows(dev, tablename, obfuscated);
      }
    }

    // Re-enable FK constraints
    await dev.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);

    console.log("[sanitized-clone] PostgreSQL clone complete");
  } finally {
    await prod.$disconnect();
    await dev.$disconnect();
  }
}

/**
 * Insert rows into a table using raw SQL.
 * FK constraints are disabled globally via session_replication_role=replica
 * before the clone starts, so no per-table trigger toggling is needed.
 */
async function insertRows(
  client: PrismaClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const values = columns.map((col) => {
      const v = row[col];
      // Prisma raw queries can't pass JS objects for JSON columns — serialize them
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) {
        return JSON.stringify(v);
      }
      return v;
    });
    const columnList = columns.map((c) => `"${c}"`).join(", ");

    await client.$executeRawUnsafe(
      `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      ...values,
    );
  }
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

    const exportData = await exportResponse.json();
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
