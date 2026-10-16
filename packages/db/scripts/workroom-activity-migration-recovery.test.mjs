import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  APPEND_ONLY_MESSAGE, classifyWorkroomActivityMigrationRecovery, recoveryProbeSql,
  WORKROOM_ACTIVITY_MIGRATION, WORKROOM_ACTIVITY_SHA256, WORKROOM_ACTIVITY_PREPARATION_SHA256,
} from "./lib/workroom-activity-migration-recovery.mjs";
import { inspectRecoveryState, probeEffectFreeFailure, readRecoverySources,
  verifyRolledBackMigration } from "./recover-workroom-activity-migration.mjs";

const failed = { id: "11111111-1111-4111-8111-111111111111", migrationName: WORKROOM_ACTIVITY_MIGRATION,
  checksum: WORKROOM_ACTIVITY_SHA256, appliedStepsCount: 0, logs: null };
const proof = () => ({ unresolvedMigrations: [{ ...failed }], migrationChecksum: WORKROOM_ACTIVITY_SHA256,
  preparationChecksum: WORKROOM_ACTIVITY_PREPARATION_SHA256, activeMigrationCount: 0, predecessorMatches: true,
  probe: { rolledBack: true, historyUnchanged: true, code: "P0001", message: APPEND_ONLY_MESSAGE } });

test("missing Prisma logs require exact reproduced failure, atomic rollback and old schema", () => {
  assert.deepEqual(classifyWorkroomActivityMigrationRecovery(proof()), { action: "recover", migrationId: failed.id });
  const logged = proof(); logged.unresolvedMigrations[0].logs = `P3018: ${APPEND_ONLY_MESSAGE}`;
  assert.equal(classifyWorkroomActivityMigrationRecovery(logged).action, "recover");
});

test("unrelated and clean migration histories remain with their existing owners", () => {
  assert.deepEqual(classifyWorkroomActivityMigrationRecovery({ unresolvedMigrations: [] }), { action: "not-needed" });
  assert.deepEqual(classifyWorkroomActivityMigrationRecovery({ unresolvedMigrations: [{ migrationName: "unrelated" }] }), { action: "not-needed" });
});

for (const [name, alter] of [
  ["multiple unresolved rows", x => x.unresolvedMigrations.push({ ...failed, id: "22222222-2222-4222-8222-222222222222" })],
  ["invalid row id", x => { x.unresolvedMigrations[0].id = "not-a-uuid"; }],
  ["altered published migration", x => { x.migrationChecksum = "0".repeat(64); }],
  ["altered ledger checksum", x => { x.unresolvedMigrations[0].checksum = "0".repeat(64); }],
  ["altered preparation", x => { x.preparationChecksum = "0".repeat(64); }],
  ["applied steps", x => { x.unresolvedMigrations[0].appliedStepsCount = 1; }],
  ["different recorded failure", x => { x.unresolvedMigrations[0].logs = "lock timeout"; }],
  ["other active migration", x => { x.activeMigrationCount = 1; }],
  ["unreadable active transactions", x => { x.activeMigrationCount = -1; }],
  ["changed predecessor", x => { x.predecessorMatches = false; }],
  ["missing rollback", x => { x.probe.rolledBack = false; }],
  ["changed history", x => { x.probe.historyUnchanged = false; }],
  ["other SQLSTATE", x => { x.probe.code = "55P03"; }],
  ["other trigger error", x => { x.probe.message = "different append-only message"; }],
  ["successful replay", x => { x.probe.code = null; x.probe.message = null; }],
]) test(`refuses ${name}`, () => {
  const candidate = proof(); alter(candidate);
  assert.equal(classifyWorkroomActivityMigrationRecovery(candidate).action, "blocked");
});

test("source proof binds immutable original, predecessor and preparation bytes", () => {
  const sources = readRecoverySources();
  assert.equal(sources.migrationChecksum, WORKROOM_ACTIVITY_SHA256);
  assert.equal(sources.preparationChecksum, WORKROOM_ACTIVITY_PREPARATION_SHA256);
  assert.match(sources.assignmentBody, /IF NEW\."sequence" IS NULL THEN/);
  assert.equal(sources.refusalBody, `\nBEGIN\n  RAISE EXCEPTION '${APPEND_ONLY_MESSAGE}';\nEND;\n`);
  const sql = recoveryProbeSql(sources.migration);
  assert.match(sql, /LOCK TABLE "WorkCapsule" IN ACCESS EXCLUSIVE MODE/);
  assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT|ROLLBACK);/);
  assert.equal(createHash("sha256").update(readFileSync(new URL("../prisma/migrations/20261014012000_workroom_activity_ingestion_hardening/migration.sql", import.meta.url))).digest("hex"), WORKROOM_ACTIVITY_SHA256);
});

test("replay rejects nested or missing transaction boundaries", () => {
  for (const sql of ["UPDATE x;", "BEGIN; UPDATE x;", "BEGIN; COMMIT; BEGIN; COMMIT;"]) {
    assert.throws(() => recoveryProbeSql(sql));
  }
});

function clientFixture({ failure = { code: "P0001", message: APPEND_ONLY_MESSAGE },
  active = 0, schemaMatches = true, attributesMatch = true, guardUsesNew = false,
  rollbackFails = false, lockFails = false, historyChanges = false } = {}) {
  const sources = readRecoverySources();
  const queries = [];
  let historyReads = 0;
  const client = { async query(sql) {
    queries.push(sql);
    if (sql === "ROLLBACK" && rollbackFails) throw new Error("connection lost during rollback");
    if (sql.startsWith('LOCK TABLE') && lockFails) throw Object.assign(new Error("lock timeout"), {code: "55P03"});
    if (sql.includes('FROM "_prisma_migrations"') && sql.includes('ORDER BY started_at')) {
      historyReads++;
      return {rows: historyChanges && historyReads > 1 ? [{...failed, appliedStepsCount: 1}] : [{...failed}]};
    }
    if (sql.includes("FROM pg_stat_activity")) return {rows: [{count: active}]};
    if (sql.includes("AS assignment")) return {rows: [{assignment: sources.assignmentBody, refusal: sources.refusalBody,
      functionAttributesMatch: attributesMatch,
      preservationFunctionAbsent: schemaMatches, preservationTriggerAbsent: true, assignmentTriggerMatches: true,
      guardDefinition: `CREATE TRIGGER initiative_work_intent_immutable BEFORE DELETE OR UPDATE ON fixture."WorkCapsuleActivity" FOR EACH ROW WHEN ((${guardUsesNew ? "new" : "old"}.kind = 'work-intent-declared'::text)) EXECUTE FUNCTION refuse_initiative_governance_activity_mutation()`}]};
    if (sql.includes('UPDATE "WorkCapsuleActivity"')) {
      if (failure) throw Object.assign(new Error(failure.message), {code: failure.code});
    }
    return {rows: []};
  } };
  return {client, sources, queries};
}

test("probe replays immutable SQL in a savepoint and rolls back all effects", async () => {
  const fixture = clientFixture();
  const measured = await probeEffectFreeFailure(fixture.client, fixture.sources, [{...failed}]);
  assert.equal(measured.code, "P0001");
  assert.equal(measured.message, APPEND_ONLY_MESSAGE);
  assert.equal(measured.rolledBack, true);
  assert.equal(measured.historyUnchanged, true);
  assert.equal(fixture.queries[0], "BEGIN");
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
  assert.ok(fixture.queries.includes("ROLLBACK TO SAVEPOINT workroom_activity_recovery_probe"));
  assert.ok(fixture.queries.some(sql => sql.includes("lock_timeout = '5s'")));
  assert.ok(fixture.queries.indexOf("SAVEPOINT workroom_activity_recovery_probe")
    < fixture.queries.findIndex(sql => sql.includes('UPDATE "WorkCapsuleActivity"')));
  assert.ok(!fixture.queries.some(sql => /^(COMMIT|UPDATE "_prisma_migrations")/.test(sql)));
});

test("a successful replay still rolls back and never authorizes resolution", async () => {
  const fixture = clientFixture({failure: null});
  const measured = await probeEffectFreeFailure(fixture.client, fixture.sources, [{...failed}]);
  const candidate = {...proof(), probe: measured};
  assert.equal(classifyWorkroomActivityMigrationRecovery(candidate).action, "blocked");
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
});

test("active transactions or changed predecessor skip replay and roll back", async () => {
  for (const options of [{active: 1}, {schemaMatches: false}, {attributesMatch: false}, {guardUsesNew: true}]) {
    const fixture = clientFixture(options);
    const measured = await probeEffectFreeFailure(fixture.client, fixture.sources, [{...failed}]);
    assert.equal(measured.rolledBack, true);
    assert.equal(measured.historyUnchanged, false);
    assert.equal(fixture.queries.at(-1), "ROLLBACK");
    assert.ok(!fixture.queries.some(sql => sql.includes('UPDATE "WorkCapsuleActivity"')));
  }
});

test("lock timeout or rollback failure cannot yield a recovery decision", async () => {
  for (const options of [{lockFails: true}, {rollbackFails: true}]) {
    const fixture = clientFixture(options);
    await assert.rejects(probeEffectFreeFailure(fixture.client, fixture.sources, [{...failed}]));
    assert.equal(fixture.queries.at(-1), "ROLLBACK");
  }
});

test("post-savepoint history drift invalidates otherwise matching failure", async () => {
  const fixture = clientFixture({historyChanges: true});
  const state = await inspectRecoveryState(fixture.client, fixture.sources);
  assert.equal(classifyWorkroomActivityMigrationRecovery(state).action, "blocked");
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
});

test("rolled-back verification binds exact checksum, zero steps and clear global history", async () => {
  for (const [verifiedRows, unresolvedRows, checksum, appliedStepsCount, expected] of [
    [1, 0, WORKROOM_ACTIVITY_SHA256, 0, true], [0, 0, WORKROOM_ACTIVITY_SHA256, 0, false],
    [1, 1, WORKROOM_ACTIVITY_SHA256, 0, false], [1, 0, "wrong", 0, false],
    [1, 0, WORKROOM_ACTIVITY_SHA256, 1, false],
  ]) {
    const client = {query: async sql => ({rows: [sql.includes('"verifiedRows"')
      ? {verifiedRows, unresolvedRows} : {checksum, appliedStepsCount}]})};
    assert.equal(await verifyRolledBackMigration(client, failed.id), expected);
  }
});
