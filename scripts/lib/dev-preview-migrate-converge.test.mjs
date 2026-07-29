import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BLOCKED_SANDBOX_DRIFT_EXIT,
  HIVE_CONTRIBUTIONS_MIGRATION,
  decideMigrationRepair,
  evaluateHiveContributionsSchema,
  formatBlockedMessage,
  isDisposablePreviewDatabaseUrl,
  parseAlreadyExistsFromLog,
  parseFailedMigrationFromStatus,
  parseMigrationEffects,
  readMigrationSql,
} from "./dev-preview-migrate-converge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function completeHiveSchemaSnapshot() {
  return {
    platformColumns: [
      {
        column_name: "deviceFingerprintOptIn",
        data_type: "boolean",
        is_nullable: "NO",
        column_default: "true",
      },
      {
        column_name: "hiveContributionsPaused",
        data_type: "boolean",
        is_nullable: "NO",
        column_default: "false",
      },
    ],
    ledgerColumns: [
      { column_name: "id", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "contributionType", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "contributor", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "ruleKey", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "summary", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "payloadHash", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "status", data_type: "text", is_nullable: "NO", column_default: "'submitted'::text" },
      { column_name: "redactionStatus", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "createdAt", data_type: "timestamp without time zone", is_nullable: "NO", column_default: "CURRENT_TIMESTAMP" },
      { column_name: "updatedAt", data_type: "timestamp without time zone", is_nullable: "NO", column_default: null },
    ],
    primaryKeyColumns: ["id"],
    indexes: [
      {
        indexname: "HiveContributionLedger_contributionType_idx",
        indexdef: 'CREATE INDEX "HiveContributionLedger_contributionType_idx" ON public."HiveContributionLedger" USING btree ("contributionType")',
      },
      {
        indexname: "HiveContributionLedger_status_idx",
        indexdef: 'CREATE INDEX "HiveContributionLedger_status_idx" ON public."HiveContributionLedger" USING btree (status)',
      },
      {
        indexname: "HiveContributionLedger_contributor_idx",
        indexdef: 'CREATE INDEX "HiveContributionLedger_contributor_idx" ON public."HiveContributionLedger" USING btree (contributor)',
      },
    ],
  };
}

test("parseMigrationEffects extracts hive contributions surface objects", () => {
  const sql = readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root);
  const effects = parseMigrationEffects(sql);
  assert.deepEqual(effects.addColumns, [
    { table: "PlatformDevConfig", column: "deviceFingerprintOptIn" },
    { table: "PlatformDevConfig", column: "hiveContributionsPaused" },
  ]);
  assert.deepEqual(effects.createTables, ["HiveContributionLedger"]);
  assert.ok(effects.createIndexes.includes("HiveContributionLedger_contributionType_idx"));
});

test("decideMigrationRepair marks applied when schema is fully ahead (BI-4DB4B415)", () => {
  const sql = readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root);
  const effects = parseMigrationEffects(sql);
  const present = evaluateHiveContributionsSchema(completeHiveSchemaSnapshot());
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog:
      'ERROR: column "deviceFingerprintOptIn" of relation "PlatformDevConfig" already exists\nDatabase error code: 42701',
    effects,
    present,
  });
  assert.equal(decision.action, "mark-applied");
  assert.equal(decision.migrationName, HIVE_CONTRIBUTIONS_MIGRATION);
  assert.match(decision.reason, /schema-ahead|already-exists/);
});

test("decideMigrationRepair fails closed for migrations outside the repair allowlist", () => {
  const decision = decideMigrationRepair({
    migrationName: "20260101000000_unrelated_migration",
    failureLog: 'ERROR: relation "Unrelated" already exists',
    effects: { addColumns: [], createTables: ["Unrelated"], createIndexes: [] },
    present: {
      columns: {},
      tables: { Unrelated: true },
      indexes: {},
    },
  });
  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "migration-not-allowlisted");
});

test("decideMigrationRepair blocks when a required index is missing", () => {
  const sql = readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root);
  const effects = parseMigrationEffects(sql);
  const present = evaluateHiveContributionsSchema(completeHiveSchemaSnapshot());
  present.indexes.HiveContributionLedger_status_idx = false;

  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog: 'ERROR: relation "HiveContributionLedger" already exists',
    effects,
    present,
  });

  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "partial-schema-ahead");
});

test("schema evaluation rejects wrong defaults, missing primary key, and wrong index columns", () => {
  const wrongDefault = completeHiveSchemaSnapshot();
  wrongDefault.platformColumns[0].column_default = "false";
  assert.equal(
    evaluateHiveContributionsSchema(wrongDefault).columns[
      "PlatformDevConfig.deviceFingerprintOptIn"
    ],
    false,
  );

  const missingPrimaryKey = completeHiveSchemaSnapshot();
  missingPrimaryKey.primaryKeyColumns = [];
  assert.equal(
    evaluateHiveContributionsSchema(missingPrimaryKey).tables.HiveContributionLedger,
    false,
  );

  const wrongIndex = completeHiveSchemaSnapshot();
  wrongIndex.indexes[1].indexdef =
    'CREATE INDEX "HiveContributionLedger_status_idx" ON public."HiveContributionLedger" USING btree (contributor)';
  assert.equal(
    evaluateHiveContributionsSchema(wrongIndex).indexes.HiveContributionLedger_status_idx,
    false,
  );
});

test("schema evaluation permits additive columns and a later default on an original column", () => {
  const advancedSchema = completeHiveSchemaSnapshot();
  advancedSchema.ledgerColumns.find(
    (column) => column.column_name === "updatedAt",
  ).column_default = "CURRENT_TIMESTAMP";
  advancedSchema.ledgerColumns.push({
    column_name: "resultBundle",
    data_type: "jsonb",
    is_nullable: "YES",
    column_default: null,
  });

  const present = evaluateHiveContributionsSchema(advancedSchema);
  assert.equal(present.tables.HiveContributionLedger, true);
});

test("decideMigrationRepair fails closed when SQL has no supported effects", () => {
  const effects = parseMigrationEffects(
    'ALTER TABLE "Example" ADD CONSTRAINT "Example_pkey" PRIMARY KEY ("id");',
  );
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog: 'ERROR: constraint "Example_pkey" already exists',
    effects,
    present: { columns: {}, tables: {}, indexes: {} },
  });

  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "unsupported-migration-effects");
});

test("decideMigrationRepair fails closed when allowlisted SQL gains an unverified effect", () => {
  const sql =
    `${readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root)}
ALTER TABLE "HiveContributionLedger"
  ADD CONSTRAINT "HiveContributionLedger_summary_check" CHECK (length("summary") > 0);`;
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog: 'ERROR: relation "HiveContributionLedger" already exists',
    effects: parseMigrationEffects(sql),
    present: evaluateHiveContributionsSchema(completeHiveSchemaSnapshot()),
  });

  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "unsupported-migration-effects");
});

test("decideMigrationRepair blocks partial schema-ahead without inventing objects", () => {
  const effects = parseMigrationEffects(
    readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root),
  );
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog: 'column "deviceFingerprintOptIn" of relation "PlatformDevConfig" already exists',
    effects,
    present: {
      columns: { "PlatformDevConfig.deviceFingerprintOptIn": true },
      tables: { HiveContributionLedger: false },
      indexes: {},
    },
  });
  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "partial-schema-ahead");
  assert.match(decision.nextAction, /dpf_dev_pgdata/);
  // Must name the disposable volume, not instruct deleting the live volume.
  assert.doesNotMatch(decision.nextAction, /volume rm dpf_pgdata(?!_)/);
  assert.doesNotMatch(decision.nextAction, /delete live|drop production/i);
});

test("decideMigrationRepair does not auto-resolve non-already-exists failures", () => {
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog: "ERROR: relation \"Foo\" does not exist",
    effects: parseMigrationEffects(
      readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root),
    ),
    present: { columns: {}, tables: {}, indexes: {} },
  });
  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "non-idempotent-migrate-failure");
});

test("decideMigrationRepair does not treat Prisma's generic failure prefix as repair evidence", () => {
  const decision = decideMigrationRepair({
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    failureLog:
      "Migration failed to apply. ERROR: permission denied for schema public",
    effects: parseMigrationEffects(
      readMigrationSql(HIVE_CONTRIBUTIONS_MIGRATION, root),
    ),
    present: evaluateHiveContributionsSchema(completeHiveSchemaSnapshot()),
  });

  assert.equal(decision.action, "blocked_sandbox_drift");
  assert.equal(decision.reason, "non-idempotent-migrate-failure");
});

test("parseFailedMigrationFromStatus extracts migration name from Prisma output", () => {
  const status = `
A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Migration name: 20260605060000_hive_contributions_surface
Database error code: 42701
`;
  assert.equal(
    parseFailedMigrationFromStatus(status),
    HIVE_CONTRIBUTIONS_MIGRATION,
  );
  assert.equal(parseAlreadyExistsFromLog(status), true);
});

test("formatBlockedMessage is explicit about blocked_sandbox_drift", () => {
  const msg = formatBlockedMessage({
    reason: "partial-schema-ahead",
    migrationName: HIVE_CONTRIBUTIONS_MIGRATION,
    nextAction: "recreate dpf_dev_pgdata",
  });
  assert.match(msg, /blocked_sandbox_drift/);
  assert.match(msg, /dpf_dev_pgdata/);
});

test("compose dev-init uses the converge wrapper instead of bare migrate deploy", () => {
  const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
  assert.match(compose, /dev-preview-migrate-deploy\.mjs/);
  assert.match(compose, /node \.\/scripts\/dev-preview-migrate-deploy\.mjs/);
});

test("preview refresh stops the existing portal before rebuilding its source clone", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const scriptName of ["dev:portal", "contributor:preview"]) {
    const command = packageJson.scripts[scriptName];
    assert.equal(command, "sh scripts/dev-portal-lease.sh refresh");
  }
});

test("blocked exit code is reserved and distinct from generic failure", () => {
  assert.equal(BLOCKED_SANDBOX_DRIFT_EXIT, 3);
});

test("database URL guard accepts only explicit contributor-preview endpoints", () => {
  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@dev-postgres:5432/dpf"),
    true,
  );
  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@127.0.0.1:5433/dpf"),
    true,
  );
  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@localhost:5433/dpf"),
    true,
  );

  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@postgres:5432/dpf"),
    false,
  );
  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@localhost:5432/dpf"),
    false,
  );
  assert.equal(
    isDisposablePreviewDatabaseUrl("postgresql://dpf:secret@db.example.com:5432/dpf"),
    false,
  );
  assert.equal(isDisposablePreviewDatabaseUrl("not a database URL"), false);
});
