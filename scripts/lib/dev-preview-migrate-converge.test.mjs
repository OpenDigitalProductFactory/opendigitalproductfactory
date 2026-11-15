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

import { REGISTRY_MIGRATION, RELATION_DRIFT_MIGRATION, decideGraphRegistryRecovery, recoverGraphRegistry } from "./dev-preview-graph-registry-recovery.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function graphRegistryProof() {
  const migrationName = "20261114130000_relation_drift_repair";
  const logs = '23503 graph_edge_rel_type_fkey: Key (rel_type)=(PART_OF) is not present in table "graph_relation_type"';
  return {
    registrySql: readMigrationSql("20261028060000_graph_relation_type"),
    failedSql: readMigrationSql(migrationName),
    registryHistory: [{
      migration_name: "20261028060000_graph_relation_type",
      checksum: "b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8",
      finished_at: "2026-10-28T22:13:52.562Z", rolled_back_at: null, applied_steps_count: 1,
    }],
    failedRows: [{
      migration_name: migrationName,
      checksum: "2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa",
      finished_at: null, rolled_back_at: null, applied_steps_count: 0, logs,
    }],
    schema: {
      columns: [
        { column_name: "key", data_type: "text", udt_name: "text", is_nullable: "NO" },
        { column_name: "relation_class", data_type: "USER-DEFINED", udt_name: "GraphRelationClass", is_nullable: "NO" },
        { column_name: "label", data_type: "text", udt_name: "text", is_nullable: "NO" },
        { column_name: "inverse_label", data_type: "text", udt_name: "text", is_nullable: "NO" },
        { column_name: "status", data_type: "USER-DEFINED", udt_name: "GraphRelationStatus", is_nullable: "NO" },
      ],
      primaryKeyColumns: ["key"], registrySchema: "public", historySchema: "public",
    },
    existingKeys: ["SAME_AS", "CITES", "SUPERSEDES"],
  };
}

function graphDecision(proof) {
  return decideMigrationRepair({
    migrationName: "20261114130000_relation_drift_repair",
    failureLog: proof.failedRows[0].logs,
    effects: parseMigrationEffects(proof.failedSql),
    present: { columns: {}, tables: {}, indexes: {} },
    graphRegistry: proof,
  });
}

function completedGraphProof() {
  const proof = graphRegistryProof();
  const failed = proof.failedRows[0];
  proof.recoveryMode = "completed";
  proof.failedRows = [];
  proof.driftHistory = [
    { ...failed, rolled_back_at: "2026-11-15T10:12:14Z" },
    { ...failed, logs: null, finished_at: "2026-11-15T10:12:15Z", applied_steps_count: 1 },
  ];
  return proof;
}

test("completed exact history restores missing reference rows without migration retry", () => {
  const decision = decideGraphRegistryRecovery(completedGraphProof());
  assert.equal(decision.action, "restore-registry");
  assert.ok(decision.missingKeys.includes("PART_OF"));
  assert.doesNotMatch(decision.restoreSql, /UPDATE|DELETE|TRUNCATE/);
});

test("completed restoration refuses every unrecognized history shape or active failure", () => {
  for (const change of [
    p => { p.driftHistory = []; },
    p => { p.driftHistory.pop(); },
    p => { p.driftHistory.push({ ...p.driftHistory[1] }); },
    p => { p.driftHistory[1].checksum = "wrong"; },
    p => { p.driftHistory[1].applied_steps_count = 0; },
    p => { p.driftHistory[0].logs = "unrelated failure"; },
    p => { p.driftHistory[0].rolled_back_at = null; },
    p => { p.driftHistory[0].applied_steps_count = 1; },
    p => { p.driftHistory[0].finished_at = "2026-11-15T10:12:14Z"; },
    p => { p.failedRows = graphRegistryProof().failedRows; },
    p => { p.registrySql += "changed"; },
    p => { p.schema.primaryKeyColumns = []; },
    p => { p.recoveryMode = "unknown"; },
    p => { p.alreadyAttempted = true; },
  ]) {
    const proof = completedGraphProof(); change(proof);
    const decision = decideGraphRegistryRecovery(proof);
    assert.equal(decision.action, "blocked_sandbox_drift");
    assert.equal(decision.restoreSql, undefined);
  }
});

test("healthy completed history without a prior failure needs no restoration", () => {
  const proof = completedGraphProof();
  proof.existingKeys = decideGraphRegistryRecovery(proof).expectedKeys;
  proof.driftHistory = proof.driftHistory.filter(row => row.finished_at);
  assert.equal(decideGraphRegistryRecovery(proof).action, "registry-current");
  proof.existingKeys = [];
  assert.equal(decideGraphRegistryRecovery(proof).action, "blocked_sandbox_drift");
});

test("verified registry-history drift admits missing-only restoration and a real migration retry", () => {
  const decision = graphDecision(graphRegistryProof());
  assert.equal(decision.action, "restore-registry-and-retry");
  assert.ok(decision.missingKeys.includes("PART_OF"));
  assert.ok(decision.missingKeys.includes("DEPENDS_ON"));
  assert.match(decision.restoreSql, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.doesNotMatch(decision.restoreSql, /DO UPDATE|DELETE|TRUNCATE/);
});

test("verified failed migration can resume after reference rows were already restored", () => {
  const proof = graphRegistryProof();
  const original = graphDecision(proof);
  proof.existingKeys = original.expectedKeys ?? ["PART_OF", "DEPENDS_ON"];
  const resumed = graphDecision(proof);
  assert.equal(resumed.action, "restore-registry-and-retry");
  assert.deepEqual(resumed.missingKeys, []);
});

test("registry recovery refuses unbound history, source, schema, concurrent failures and repeated retry", () => {
  const changes = [
    p => { p.registryHistory = []; },
    p => { p.registryHistory[0].finished_at = null; },
    p => { p.registryHistory[0].checksum = "0".repeat(64); },
    p => { p.registrySql += "\n-- changed source"; },
    p => { p.failedSql += "\n-- changed source"; },
    p => { p.failedRows[0].checksum = "0".repeat(64); },
    p => { p.failedRows[0].logs = "unrelated failure"; },
    p => { p.failedRows.push({ ...p.failedRows[0], migration_name: "another_failure" }); },
    p => { p.failedRows[0].rolled_back_at = "2026-11-15T00:00:00Z"; },
    p => { p.schema.columns.pop(); },
    p => { p.schema.registrySchema = "private"; },
    p => { p.schema.historySchema = "private"; },
    p => { p.schema.primaryKeyColumns = []; },
    p => { p.alreadyAttempted = true; },
  ];
  for (const change of changes) {
    const proof = graphRegistryProof();
    change(proof);
    const decision = graphDecision(proof);
    assert.equal(decision.action, "blocked_sandbox_drift");
    assert.equal(decision.restoreSql, undefined);
  }
});

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

// An I/O boundary double: actual immutable SQL is read; database replies model
// the observed failure. Assertions concern durable effects and command ordering.
function fixture({ wrongChecksum = false, restoreFails = false, incomplete = false, resolveFails = false, deployFails = false, completed = false } = {}) {
  const events = [];
  let restoredKeys = [];
  const query = async (sql, values = []) => {
    events.push({ sql, values });
    if (sql.includes("WHERE migration_name = $1") && values[0] === RELATION_DRIFT_MIGRATION) return completedGraphProof().driftHistory;
    if (sql.includes("WHERE migration_name = $1")) return [{ migration_name: REGISTRY_MIGRATION,
      checksum: wrongChecksum ? "wrong" : "b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8",
      finished_at: "2026-10-28T22:13:52Z", rolled_back_at: null, applied_steps_count: 1 }];
    if (sql.includes("WHERE finished_at IS NULL")) return completed ? [] : [{ migration_name: RELATION_DRIFT_MIGRATION,
      checksum: "2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa",
      finished_at: null, rolled_back_at: null, applied_steps_count: 0,
      logs: '23503 graph_edge_rel_type_fkey Key (rel_type)=(PART_OF) is not present in table "graph_relation_type"' }];
    if (sql.includes("information_schema.columns")) return [
      ["key", "text", "text"], ["relation_class", "USER-DEFINED", "GraphRelationClass"],
      ["label", "text", "text"], ["inverse_label", "text", "text"], ["status", "USER-DEFINED", "GraphRelationStatus"],
    ].map(([column_name, data_type, udt_name]) => ({ column_name, data_type, udt_name, is_nullable: "NO" }));
    if (sql.includes("pg_index")) return [{ column_name: "key" }];
    if (sql.includes("FROM pg_class")) return ["graph_relation_type", "_prisma_migrations"].map(relname => ({ relname, nspname: "public" }));
    if (sql.startsWith('INSERT INTO "graph_relation_type"')) {
      if (restoreFails) throw new Error("fixture interrupted insert");
      restoredKeys = [...sql.matchAll(/^\s*\('([A-Z_]+)',/gm)].map(m => m[1]);
    }
    if (sql.includes('WHERE "key" = ANY')) return (incomplete ? [] : restoredKeys).map(key => ({ key }));
    if (sql.startsWith('SELECT "key"')) return restoredKeys.map(key => ({ key }));
    return [];
  };
  const runPrisma = args => {
    events.push({ prisma: args });
    return { ok: args[1] === "resolve" ? !resolveFails : !deployFails, stdout: "actual deploy output", combined: "fixture Prisma output" };
  };
  return { query, runPrisma, readSql: readMigrationSql, events,
    context: { environment: "dev", databaseUrl: "postgresql://dpf@127.0.0.1:5433/dpf" } };
}

test("completed-state recovery commits missing-only rows and never invokes Prisma, including repeat", async () => {
  const f = fixture({ completed: true });
  const result = await recoverGraphRegistry({ ...f, recoveryMode: "completed" });
  assert.equal(result.action, "restored");
  assert.equal(f.events.filter(e => e.sql?.startsWith("INSERT")).length, 1);
  assert.equal(f.events.filter(e => e.prisma).length, 0);
  const repeated = await recoverGraphRegistry({ ...f, recoveryMode: "completed" });
  assert.equal(repeated.action, "registry-current");
  assert.equal(f.events.filter(e => e.sql?.startsWith("INSERT")).length, 1);
  assert.equal(f.events.filter(e => e.prisma).length, 0);
});

test("completed-state interrupted or incomplete restoration rolls back without history commands", async () => {
  for (const options of [{ restoreFails: true }, { incomplete: true }]) {
    const f = fixture({ completed: true, ...options });
    const result = await recoverGraphRegistry({ ...f, recoveryMode: "completed" });
    assert.equal(result.action, "blocked_sandbox_drift");
    assert.equal(f.events.at(-1).sql, "ROLLBACK");
    assert.equal(f.events.filter(e => e.prisma).length, 0);
  }
});

test("direct recovery entry refuses missing, production and foreign destinations before any query", async () => {
  for (const context of [undefined,
    { environment: "production", databaseUrl: "postgresql://dpf@127.0.0.1:5433/dpf" },
    { environment: "dev", databaseUrl: "postgresql://dpf@postgres:5432/dpf" },
    { environment: "dev", databaseUrl: "postgresql://dpf@127.0.0.1:5433/other" },
  ]) {
    const f = fixture();
    const result = await recoverGraphRegistry({ ...f, context });
    assert.equal(result.action, "blocked_sandbox_drift");
    assert.deepEqual(f.events, []);
  }
});

test("recovery commits verified missing-only insert before supported rollback and actual deploy", async () => {
  const f = fixture();
  const result = await recoverGraphRegistry(f);
  assert.equal(result.action, "recovered");
  const commit = f.events.findIndex(e => e.sql === "COMMIT");
  const firstPrisma = f.events.findIndex(e => e.prisma);
  assert.ok(commit > 0 && firstPrisma > commit);
  assert.deepEqual(f.events.filter(e => e.prisma).map(e => e.prisma), [
    ["migrate", "resolve", "--rolled-back", RELATION_DRIFT_MIGRATION], ["migrate", "deploy"],
  ]);
  assert.equal(f.events.filter(e => e.sql?.startsWith("INSERT")).length, 1);
  assert.ok(f.events.some(e => e.sql?.startsWith("LOCK TABLE public._prisma_migrations")));
  assert.equal(result.output, "actual deploy output");
});

test("unverified source history performs no insert or Prisma command", async () => {
  const f = fixture({ wrongChecksum: true });
  assert.equal((await recoverGraphRegistry(f)).action, "blocked_sandbox_drift");
  assert.equal(f.events.at(-1).sql, "ROLLBACK");
  assert.ok(!f.events.some(e => e.prisma || e.sql?.startsWith("INSERT")));
});

test("changed committed SQL bytes cannot be replaced with caller-supplied source hashes", async () => {
  const f = fixture();
  f.readSql = name => readMigrationSql(name) + "\n-- changed bytes";
  assert.equal((await recoverGraphRegistry(f)).reason, "registry-source-checksum-mismatch");
  assert.ok(!f.events.some(e => e.prisma || e.sql?.startsWith("INSERT")));
});

for (const options of [{ restoreFails: true }, { incomplete: true }]) {
  test(`interrupted or incomplete restoration rolls back without retry: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.equal((await recoverGraphRegistry(f)).reason, "registry-restoration-refused");
    assert.equal(f.events.at(-1).sql, "ROLLBACK");
    assert.ok(!f.events.some(e => e.sql === "COMMIT" || e.prisma));
  });
}

test("failed Prisma resolve does not deploy or mark applied", async () => {
  const f = fixture({ resolveFails: true });
  assert.equal((await recoverGraphRegistry(f)).reason, "registry-resolve-rolled-back-failed");
  assert.equal(f.events.filter(e => e.prisma).length, 1);
  assert.ok(!f.events.some(e => e.prisma?.includes("--applied")));
});

test("second migration failure is terminal for this recovery invocation", async () => {
  const f = fixture({ deployFails: true });
  assert.equal((await recoverGraphRegistry(f)).reason, "registry-retry-failed");
  assert.equal(f.events.filter(e => e.prisma).length, 2);
});

test("already attempted recovery performs neither data nor history repair", async () => {
  const f = fixture();
  assert.equal((await recoverGraphRegistry({ ...f, alreadyAttempted: true })).action, "blocked_sandbox_drift");
  assert.ok(!f.events.some(e => e.prisma || e.sql?.startsWith("INSERT")));
});
