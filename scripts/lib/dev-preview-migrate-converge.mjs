// scripts/lib/dev-preview-migrate-converge.mjs
//
// BI-4DB4B415 — Contributor-preview (dev-postgres) migration convergence.
// Disposable environment only: never touch the live portal database.
//
// Problem class: schema is ahead of Prisma history (or a migration failed with
// "already exists") so `prisma migrate deploy` wedges and dev-init never
// completes, blocking the leased :3001 preview.
//
// Safe repair: only the known hive-contributions migration is eligible, and
// only when its complete column/table/key/index contract is already present.
// Then mark it applied (`prisma migrate resolve --applied`) and continue deploy.
// Unrecoverable drift exits with blocked_sandbox_drift (code 3) and one next
// action: recreate the disposable dev_pgdata volume only.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HIVE_CONTRIBUTIONS_MIGRATION = "20260605060000_hive_contributions_surface";
export const BLOCKED_SANDBOX_DRIFT_EXIT = 3;
export const MAX_REPAIR_ROUNDS = 25;

const HIVE_CONTRIBUTIONS_EFFECTS = Object.freeze({
  normalizedSqlSha256:
    "42c491f48d28b0a17ed104ba782d51e05d49327311349db737b56c38849f48f2",
  addColumns: Object.freeze([
    "PlatformDevConfig.deviceFingerprintOptIn",
    "PlatformDevConfig.hiveContributionsPaused",
  ]),
  createTables: Object.freeze(["HiveContributionLedger"]),
  createIndexes: Object.freeze([
    "HiveContributionLedger_contributionType_idx",
    "HiveContributionLedger_status_idx",
    "HiveContributionLedger_contributor_idx",
  ]),
});

const ALREADY_EXISTS_RE =
  /already exists|column .* of relation .* already exists|relation .* already exists|42701|42P07|42710/i;

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && actual.every((value) => expected.includes(value));
}

function hasExpectedHiveContributionEffects(effects) {
  const columns = effects.addColumns.map(({ table, column }) => `${table}.${column}`);
  return effects.normalizedSqlSha256 === HIVE_CONTRIBUTIONS_EFFECTS.normalizedSqlSha256
    && sameMembers(columns, HIVE_CONTRIBUTIONS_EFFECTS.addColumns)
    && sameMembers(effects.createTables, HIVE_CONTRIBUTIONS_EFFECTS.createTables)
    && sameMembers(effects.createIndexes, HIVE_CONTRIBUTIONS_EFFECTS.createIndexes);
}

export function isDisposablePreviewDatabaseUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    if (url.username !== "dpf" || url.pathname !== "/dpf") return false;

    if (url.hostname === "dev-postgres") {
      return url.port === "" || url.port === "5432";
    }

    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.port === "5433";
  } catch {
    return false;
  }
}

/**
 * Parse a Prisma migration SQL file for structural effects we can probe.
 * Intentionally narrow: ADD COLUMN / CREATE TABLE / CREATE INDEX only.
 *
 * @param {string} sql
 * @returns {{
 *   normalizedSqlSha256: string,
 *   addColumns: { table: string, column: string }[],
 *   createTables: string[],
 *   createIndexes: string[]
 * }}
 */
export function parseMigrationEffects(sql) {
  const addColumns = [];
  const createTables = [];
  const createIndexes = [];
  const text = String(sql ?? "");
  const normalizedSql = text.replace(/\r\n/g, "\n").trim();
  const normalizedSqlSha256 = createHash("sha256")
    .update(normalizedSql)
    .digest("hex");

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

  return {
    normalizedSqlSha256,
    addColumns,
    createTables,
    createIndexes,
  };
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

  if (migrationName !== HIVE_CONTRIBUTIONS_MIGRATION) {
    return {
      action: "blocked_sandbox_drift",
      reason: "migration-not-allowlisted",
      migrationName,
      nextAction:
        "Automatic migration repair is allowlisted only for the verified hive-contributions drift. Inspect dev-init logs and recreate the disposable contributor-preview volume through the governed preview path.",
    };
  }

  const failureLog = String(input.failureLog ?? "");
  const alreadyExists = ALREADY_EXISTS_RE.test(failureLog);
  const effects = input.effects ?? { addColumns: [], createTables: [], createIndexes: [] };
  const present = input.present ?? { columns: {}, tables: {}, indexes: {} };

  if (!hasExpectedHiveContributionEffects(effects)) {
    return {
      action: "blocked_sandbox_drift",
      reason: "unsupported-migration-effects",
      migrationName,
      nextAction:
        "The allowlisted migration no longer matches its verified structural contract. Do not resolve it automatically; inspect the migration and disposable preview schema.",
    };
  }

  const missingColumns = effects.addColumns.filter(
    (c) => !present.columns[`${c.table}.${c.column}`],
  );
  const missingTables = effects.createTables.filter((t) => !present.tables[t]);
  const missingIndexes = effects.createIndexes.filter((i) => !present.indexes[i]);

  const structuralComplete =
    missingColumns.length === 0
    && missingTables.length === 0
    && missingIndexes.length === 0;

  if (structuralComplete && alreadyExists) {
    return {
      action: "mark-applied",
      migrationName,
      reason: alreadyExists
        ? "schema-ahead-already-exists"
        : "schema-effects-already-present",
    };
  }

  if (alreadyExists && !structuralComplete) {
    return {
      action: "blocked_sandbox_drift",
      reason: "partial-schema-ahead",
      migrationName,
      missingColumns,
      missingTables,
      missingIndexes,
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

const EXPECTED_PLATFORM_COLUMNS = Object.freeze({
  deviceFingerprintOptIn: Object.freeze({
    dataType: "boolean",
    nullable: "NO",
    defaultValue: "true",
  }),
  hiveContributionsPaused: Object.freeze({
    dataType: "boolean",
    nullable: "NO",
    defaultValue: "false",
  }),
});

const EXPECTED_LEDGER_COLUMNS = Object.freeze({
  id: ["text", "NO", null],
  contributionType: ["text", "NO", null],
  contributor: ["text", "NO", null],
  ruleKey: ["text", "YES", null],
  summary: ["text", "NO", null],
  payloadHash: ["text", "YES", null],
  status: ["text", "NO", "'submitted'::text"],
  redactionStatus: ["text", "YES", null],
  createdAt: ["timestamp without time zone", "NO", "current_timestamp"],
  updatedAt: ["timestamp without time zone", "NO", null],
});

const EXPECTED_LEDGER_INDEX_COLUMNS = Object.freeze({
  HiveContributionLedger_contributionType_idx: "contributionType",
  HiveContributionLedger_status_idx: "status",
  HiveContributionLedger_contributor_idx: "contributor",
});

function normalizeDefault(value) {
  return value == null ? null : String(value).trim().toLowerCase();
}

function columnMatches(row, [dataType, nullable, defaultValue]) {
  return row?.data_type === dataType
    && row?.is_nullable === nullable
    && (
      defaultValue == null
      || normalizeDefault(row?.column_default) === defaultValue
    );
}

function indexTargetsSingleColumn(indexDefinition, column) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\(\\s*"?${escaped}"?\\s*\\)\\s*$`, "i").test(
    String(indexDefinition ?? ""),
  );
}

export function evaluateHiveContributionsSchema(snapshot) {
  const platformByName = Object.fromEntries(
    (snapshot?.platformColumns ?? []).map((row) => [row.column_name, row]),
  );
  const ledgerByName = Object.fromEntries(
    (snapshot?.ledgerColumns ?? []).map((row) => [row.column_name, row]),
  );
  const indexByName = Object.fromEntries(
    (snapshot?.indexes ?? []).map((row) => [row.indexname, row]),
  );

  const ledgerColumnsMatch = Object.entries(EXPECTED_LEDGER_COLUMNS).every(
    ([name, expected]) => columnMatches(ledgerByName[name], expected),
  );
  const primaryKeyMatches =
    Array.isArray(snapshot?.primaryKeyColumns)
    && snapshot.primaryKeyColumns.length === 1
    && snapshot.primaryKeyColumns[0] === "id";

  return {
    columns: {
      "PlatformDevConfig.deviceFingerprintOptIn": columnMatches(
        platformByName.deviceFingerprintOptIn,
        [
          EXPECTED_PLATFORM_COLUMNS.deviceFingerprintOptIn.dataType,
          EXPECTED_PLATFORM_COLUMNS.deviceFingerprintOptIn.nullable,
          EXPECTED_PLATFORM_COLUMNS.deviceFingerprintOptIn.defaultValue,
        ],
      ),
      "PlatformDevConfig.hiveContributionsPaused": columnMatches(
        platformByName.hiveContributionsPaused,
        [
          EXPECTED_PLATFORM_COLUMNS.hiveContributionsPaused.dataType,
          EXPECTED_PLATFORM_COLUMNS.hiveContributionsPaused.nullable,
          EXPECTED_PLATFORM_COLUMNS.hiveContributionsPaused.defaultValue,
        ],
      ),
    },
    tables: {
      HiveContributionLedger: ledgerColumnsMatch && primaryKeyMatches,
    },
    indexes: Object.fromEntries(
      Object.entries(EXPECTED_LEDGER_INDEX_COLUMNS).map(([name, column]) => [
        name,
        indexTargetsSingleColumn(indexByName[name]?.indexdef, column),
      ]),
    ),
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

/**
 * Probe the exact allowlisted schema contract.
 * @param {(sql: string) => Promise<any[]>} query
 */
export async function probeHiveContributionsSchema(query) {
  const platformColumns = await query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'PlatformDevConfig'
        AND column_name IN ('deviceFingerprintOptIn', 'hiveContributionsPaused')`,
  );
  const ledgerColumns = await query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'HiveContributionLedger'
      ORDER BY ordinal_position`,
  );
  const primaryKeyRows = await query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_catalog = kcu.constraint_catalog
        AND tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'HiveContributionLedger'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position`,
  );
  const indexes = await query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'HiveContributionLedger'
        AND indexname IN (
          'HiveContributionLedger_contributionType_idx',
          'HiveContributionLedger_status_idx',
          'HiveContributionLedger_contributor_idx'
        )`,
  );

  return evaluateHiveContributionsSchema({
    platformColumns,
    ledgerColumns,
    primaryKeyColumns: primaryKeyRows.map((row) => row.column_name),
    indexes,
  });
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
