import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BLOCKED_SANDBOX_DRIFT_EXIT,
  HIVE_CONTRIBUTIONS_MIGRATION,
  decideMigrationRepair,
  formatBlockedMessage,
  hiveContributionsPresentProbe,
  parseAlreadyExistsFromLog,
  parseFailedMigrationFromStatus,
  parseMigrationEffects,
  readMigrationSql,
} from "./dev-preview-migrate-converge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

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
  const present = hiveContributionsPresentProbe({
    deviceFingerprintOptIn: true,
    hiveContributionsPaused: true,
    hasLedger: true,
  });
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

test("decideMigrationRepair blocks partial schema-ahead without inventing objects", () => {
  const effects = parseMigrationEffects(
    'ALTER TABLE "PlatformDevConfig" ADD COLUMN "deviceFingerprintOptIn" BOOLEAN;\n' +
      'CREATE TABLE "HiveContributionLedger" ("id" TEXT NOT NULL);',
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
    migrationName: "20260101000000_example",
    failureLog: "ERROR: relation \"Foo\" does not exist",
    effects: { addColumns: [], createTables: [], createIndexes: [] },
    present: { columns: {}, tables: {}, indexes: {} },
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

test("blocked exit code is reserved and distinct from generic failure", () => {
  assert.equal(BLOCKED_SANDBOX_DRIFT_EXIT, 3);
});
