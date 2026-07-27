// scripts/lib/dev-preview-migrate-converge.mjs
//
// BI-4DB4B415 — Contributor-preview (dev-postgres) migration convergence.
// Disposable environment only: never touch the live portal database.
//
// Problem class: schema is ahead of Prisma history (or a migration failed with
// "already exists") so `prisma migrate deploy` wedges and dev-init never
// completes, blocking the leased :3001 preview.
//
// Safe repair: when every effect of the failed migration is already present,
// mark it applied (`prisma migrate resolve --applied`) and continue deploy.
// Unrecoverable drift exits with blocked_sandbox_drift (code 3) and one next
// action: recreate the disposable dev_pgdata volume only.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HIVE_CONTRIBUTIONS_MIGRATION = "20260605060000_hive_contributions_surface";
export const BLOCKED_SANDBOX_DRIFT_EXIT = 3;
export const MAX_REPAIR_ROUNDS = 25;

const ALREADY_EXISTS_RE =
  /already exists|column .* of relation .* already exists|relation .* already exists|duplicate key value|42701|42P07|42710/i;

/**
 * Parse a Prisma migration SQL file for structural effects we can probe.
 * Intentionally narrow: ADD COLUMN / CREATE TABLE / CREATE INDEX only.
 *
 * @param {string} sql
 * @returns {{ addColumns: { table: string, column: string }[], createTables: string[], createIndexes: string[] }}
 */
export function parseMigrationEffects(sql) {
  const addColumns = [];
  const createTables = [];
  const createIndexes = [];
  const text = String(sql ?? "");

  // ALTER TABLE "Foo" ADD COLUMN "bar" ...
  // ALTER TABLE "Foo" ADD COLUMN IF NOT EXISTS "bar" ...
  const colRe =
    /ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi;
  for (const match of text.matchAll(colRe)) {
    addColumns.push({ table: match[1], column: match[2] });
  }

  const tableRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi;
  for (const match of text.matchAll(tableRe)) {
    createTables.push(match[1]);
  }

  const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi;
  for (const match of text.matchAll(indexRe)) {
    createIndexes.push(match[1]);
  }

  return { addColumns, createTables, createIndexes };
}

/**
 * Decide how to handle a failed / pending migration given live schema probes.
 *
 * @param {{
 *   migrationName: string,
 *   failureLog?: string | null,
 *   effects: ReturnType<typeof parseMigrationEffects>,
 *   present: {
 *     columns: Record<string, boolean>, // key: Table.column
 *     tables: Record<string, boolean>,
 *     indexes: Record<string, boolean>,
 *   },
 * }} input
 */
export function decideMigrationRepair(input) {
  const migrationName = String(input.migrationName ?? "").trim();
  if (!migrationName) {
    return {
      action: "blocked_sandbox_drift",
      reason: "missing-migration-name",
      nextAction:
        "Recreate the disposable contributor-preview volume only: docker compose --profile dev stop dev-portal dev-init dev-postgres && docker volume rm dpf_dev_pgdata && docker compose --profile dev up -d --profile dev",
    };
  }

  const failureLog = String(input.failureLog ?? "");
  const alreadyExists = ALREADY_EXISTS_RE.test(failureLog);
  const effects = input.effects ?? { addColumns: [], createTables: [], createIndexes: [] };
  const present = input.present ?? { columns: {}, tables: {}, indexes: {} };

  const missingColumns = effects.addColumns.filter(
    (c) => !present.columns[`${c.table}.${c.column}`],
  );
  const missingTables = effects.createTables.filter((t) => !present.tables[t]);
  // Indexes are optional for "complete enough to mark applied" when tables exist —
  // Prisma will not re-run the migration; missing indexes would be a separate defect.
  // Require tables + columns; indexes reported as soft gaps.
  const missingIndexes = effects.createIndexes.filter((i) => !present.indexes[i]);

  const structuralComplete = missingColumns.length === 0 && missingTables.length === 0;

  if (structuralComplete && (alreadyExists || failureLog.includes("failed to apply") || !failureLog)) {
    return {
      action: "mark-applied",
      migrationName,
      reason: alreadyExists
        ? "schema-ahead-already-exists"
        : "schema-effects-already-present",
      softGaps: missingIndexes.length > 0 ? { missingIndexes } : undefined,
    };
  }

  if (alreadyExists && !structuralComplete) {
    return {
      action: "blocked_sandbox_drift",
      reason: "partial-schema-ahead",
      migrationName,
      missingColumns,
      missingTables,
      nextAction:
        "Contributor-preview schema is partially ahead of migration history. Recreate disposable volume dpf_dev_pgdata only (never the live portal volume), then re-run dev-init.",
    };
  }

  if (!alreadyExists && failureLog) {
    return {
      action: "blocked_sandbox_drift",
      reason: "non-idempotent-migrate-failure",
      migrationName,
      nextAction:
        "Inspect dev-init logs for the failed migration. For disposable contributor preview only: recreate dpf_dev_pgdata and re-run `docker compose --profile dev up`. Do not resolve --applied without evidence the schema matches.",
    };
  }

  return {
    action: "migrate-deploy",
    reason: "no-repair-needed",
    migrationName,
  };
}

/**
 * Known high-signal probe for BI-4DB4B415 (hive contributions surface).
 */
export function hiveContributionsPresentProbe(row) {
  return {
    columns: {
      "PlatformDevConfig.deviceFingerprintOptIn": Boolean(row?.deviceFingerprintOptIn),
      "PlatformDevConfig.hiveContributionsPaused": Boolean(row?.hiveContributionsPaused),
    },
    tables: {
      HiveContributionLedger: Boolean(row?.hasLedger),
    },
    indexes: {
      HiveContributionLedger_contributionType_idx: Boolean(row?.hasLedger),
      HiveContributionLedger_status_idx: Boolean(row?.hasLedger),
      HiveContributionLedger_contributor_idx: Boolean(row?.hasLedger),
    },
  };
}

export function formatBlockedMessage(decision) {
  return [
    "[dev-preview-migrate] blocked_sandbox_drift",
    `reason=${decision.reason}`,
    decision.migrationName ? `migration=${decision.migrationName}` : null,
    `next=${decision.nextAction}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── runtime helpers (I/O) ───────────────────────────────────────────────────

function repoRootFromHere() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function migrationsDir(root = repoRootFromHere()) {
  return join(root, "packages/db/prisma/migrations");
}

export function readMigrationSql(migrationName, root = repoRootFromHere()) {
  const path = join(migrationsDir(root), migrationName, "migration.sql");
  if (!existsSync(path)) {
    throw new Error(`migration SQL not found: ${migrationName}`);
  }
  return readFileSync(path, "utf8");
}

export function listMigrationNames(root = repoRootFromHere()) {
  return readdirSync(migrationsDir(root), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * Build a present-map by probing information_schema via a provided query fn.
 * @param {(sql: string) => Promise<any[]>} query
 * @param {ReturnType<typeof parseMigrationEffects>} effects
 */
export async function probeEffectsPresent(query, effects) {
  const columns = {};
  const tables = {};
  const indexes = {};

  for (const { table, column } of effects.addColumns) {
    const rows = await query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${table.replace(/'/g, "''")}'
          AND column_name = '${column.replace(/'/g, "''")}'
        LIMIT 1`,
    );
    columns[`${table}.${column}`] = Array.isArray(rows) && rows.length > 0;
  }

  for (const table of effects.createTables) {
    const rows = await query(
      `SELECT 1 AS ok FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '${table.replace(/'/g, "''")}'
        LIMIT 1`,
    );
    tables[table] = Array.isArray(rows) && rows.length > 0;
  }

  for (const index of effects.createIndexes) {
    const rows = await query(
      `SELECT 1 AS ok FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = '${index.replace(/'/g, "''")}'
        LIMIT 1`,
    );
    indexes[index] = Array.isArray(rows) && rows.length > 0;
  }

  return { columns, tables, indexes };
}

export function parseFailedMigrationFromStatus(statusText) {
  const text = String(statusText ?? "");
  // Prisma prints: "Following migration have failed:" / "The `name` migration ..."
  const patterns = [
    /Migration name:\s*([0-9]{14}_[A-Za-z0-9_]+)/i,
    /The `([0-9]{14}_[A-Za-z0-9_]+)` migration/i,
    /migrate found failed migrations in the target database.*?([0-9]{14}_[A-Za-z0-9_]+)/is,
    /failed migration[s]?:\s*([0-9]{14}_[A-Za-z0-9_]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function parseAlreadyExistsFromLog(text) {
  return ALREADY_EXISTS_RE.test(String(text ?? ""));
}
