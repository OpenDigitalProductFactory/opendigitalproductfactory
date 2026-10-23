import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { inspectRecoveryState, readRecoverySources } from "./recover-workroom-activity-migration.mjs";
import { classifyWorkroomActivityMigrationRecovery, WORKROOM_ACTIVITY_MIGRATION,
  WORKROOM_ACTIVITY_SHA256 } from "./lib/workroom-activity-migration-recovery.mjs";

// Never inherit DATABASE_URL: this suite requires an explicitly assigned test DB.
const databaseUrl = process.env.DPF_INGESTION_TEST_DATABASE_URL;
const postgresTest = (name, fn) => test(name, { skip: !databaseUrl }, fn);
const migration = name => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
const preparation = await migration("20261014011900_prepare_workroom_activity_ingestion");
const hardening = await migration("20261014012000_workroom_activity_ingestion_hardening");
const predecessor = await migration("20261013180000_workroom_activity_sequence");
const governance = await migration("20260808235000_initiative_readiness_receipts");
const originalGuard = governance.match(/CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
const intentTrigger = governance.match(/CREATE TRIGGER initiative_work_intent_immutable[\s\S]*?EXECUTE FUNCTION refuse_initiative_governance_activity_mutation\(\);/)?.[0];
const governanceTrigger = governance.match(/CREATE TRIGGER initiative_governance_activity_immutable[\s\S]*?EXECUTE FUNCTION refuse_initiative_governance_activity_mutation\(\);/)?.[0];
assert.ok(originalGuard && intentTrigger && governanceTrigger, "use the published guard and both real attachments");
const restoreMarker = "  -- Exact original refusal body:";
assert.equal(preparation.split(restoreMarker).length, 2);

async function fixture(t, { empty = false } = {}) {
  const schema = `ingestion_recovery_${randomUUID().replaceAll("-", "")}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  t.after(async () => {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  });
  await client.query(`
    CREATE TABLE "WorkCapsule" (id text PRIMARY KEY);
    CREATE TABLE "WorkCapsuleActivity" (
      id text PRIMARY KEY, "workCapsuleId" text NOT NULL REFERENCES "WorkCapsule"(id),
      kind text NOT NULL, summary text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
      "recordedAt" timestamp(3) NOT NULL DEFAULT '2026-10-12T12:00:00Z',
      "recordedById" text, "recordedByAgentId" text, "toolExecutionId" text,
      "commandScopeKey" text, "commandKey" text,
      "futureSemanticField" text NOT NULL DEFAULT 'must also stay unchanged'
    );
    CREATE TABLE "BacklogItemActivity" (
      id text PRIMARY KEY, kind text NOT NULL, summary text NOT NULL, payload jsonb NOT NULL
    );
    INSERT INTO "WorkCapsule" VALUES ('mixed'), ('overflow'), ('boundary'), ('negative'), ('ahead');
    INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, payload) VALUES
      ('mixed-intent-a', 'mixed', 'work-intent-declared', 'Original intent', '{"receipt":{"id":"retained"}}'),
      ('mixed-intent-b', 'mixed', 'work-intent-declared', 'Tie ordered by id', '{"scope":[1,2]}'),
      ('mixed-ordinary', 'mixed', 'note', 'Ordinary legacy row', '{"failure":"retained"}'),
      ('overflow-intent', 'overflow', 'work-intent-declared', 'Overflow intent', '{}'),
      ('overflow-ordinary', 'overflow', 'note', 'Overflow ordinary', '{}'),
      ('boundary-intent', 'boundary', 'work-intent-declared', 'Exactly enough headroom', '{}'),
      ('negative-intent', 'negative', 'work-intent-declared', 'Negative counter repaired', '{}'),
      ('ahead-intent', 'ahead', 'work-intent-declared', 'Preserve counter high water', '{}');
    INSERT INTO "BacklogItemActivity" VALUES
      ('governance', 'initiative_gate_receipt', 'Original governance', '{"decision":"retained"}');
  `);
  if (empty) await client.query(`DELETE FROM "WorkCapsuleActivity"; DELETE FROM "BacklogItemActivity"; DELETE FROM "WorkCapsule"`);
  await client.query(predecessor);
  // Explicit positions were legal in the real predecessor; do not disable guards.
  if (!empty) await client.query(`
    INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, "sequence") VALUES
      ('mixed-assigned', 'mixed', 'work-intent-declared', 'Assigned position stays 7', 7),
      ('ahead-assigned', 'ahead', 'note', 'Counter may already lead evidence', 2);
    UPDATE "WorkCapsule" SET "activitySequence" = CASE id
      WHEN 'mixed' THEN 2 WHEN 'overflow' THEN 2147483646
      WHEN 'boundary' THEN 2147483646 WHEN 'negative' THEN -3 WHEN 'ahead' THEN 10 END;
  `);
  await client.query(`${originalGuard}\n${intentTrigger}\n${governanceTrigger}`);
  return { client, schema };
}

async function snapshot(client) {
  return (await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM "WorkCapsuleActivity" a) AS activities,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "WorkCapsule" r) AS rooms,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM "BacklogItemActivity" a) AS governance,
    pg_get_functiondef('refuse_initiative_governance_activity_mutation()'::regprocedure) AS guard
  `)).rows[0];
}

async function refusal(client, sql, code = "P0001") {
  await assert.rejects(client.query(sql), error => {
    assert.equal(error.code, code);
    if (code === "P0001") assert.equal(error.message, "initiative governance activities are append-only");
    return true;
  });
}

function semantics(activities) {
  return activities.map(({ sequence: _position, ...rest }) => rest);
}

async function waitFor(client, pid, eventType) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await client.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
    if (rows[0]?.wait_event_type === eventType) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not wait on ${eventType}`);
}

postgresTest("published hardening reproduces P0001 and rolls back its data and function effects", async t => {
  const { client } = await fixture(t);
  const before = await snapshot(client);
  await refusal(client, hardening);
  await refusal(client, "SELECT 1", "25P02");
  await client.query("ROLLBACK");
  assert.deepEqual(await snapshot(client), before);
  assert.equal((await client.query("SELECT to_regprocedure('preserve_workroom_activity_sequence()') AS fn")).rows[0].fn, null);
});

postgresTest("the real recovery helper proves a NULL-log failure and leaves data, guards and history unchanged", async t => {
  const { client } = await fixture(t);
  await client.query(`CREATE TABLE "_prisma_migrations" (
    id text PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
    migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
  )`);
  const id = randomUUID();
  await client.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name) VALUES ($1,$2,$3)`,
    [id, WORKROOM_ACTIVITY_SHA256, WORKROOM_ACTIVITY_MIGRATION]);
  const before = await snapshot(client);
  const history = (await client.query(`SELECT * FROM "_prisma_migrations" ORDER BY id`)).rows;
  const state = await inspectRecoveryState(client, readRecoverySources());
  assert.deepEqual(classifyWorkroomActivityMigrationRecovery(state), { action: "recover", migrationId: id });
  assert.deepEqual(state.probe, { rolledBack: true, historyUnchanged: true,
    predecessorMatches: true, activeMigrationCount: 0,
    code: "P0001", message: "initiative governance activities are append-only" });
  assert.deepEqual(await snapshot(client), before);
  assert.deepEqual((await client.query(`SELECT * FROM "_prisma_migrations" ORDER BY id`)).rows, history);
  assert.equal((await client.query("SELECT to_regprocedure('preserve_workroom_activity_sequence()') AS fn")).rows[0].fn, null);
});

postgresTest("clean installs complete preparation and unchanged hardening without weakening append-only guards", async t => {
  const { client } = await fixture(t, { empty: true });
  const before = await snapshot(client);
  await client.query(preparation);
  await client.query(hardening);
  assert.deepEqual(await snapshot(client), before);
  await client.query(`INSERT INTO "WorkCapsule" (id) VALUES ('clean');
    INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",kind,summary) VALUES ('clean-intent','clean','work-intent-declared','First arrival')`);
  assert.equal((await client.query(`SELECT "sequence" FROM "WorkCapsuleActivity" WHERE id='clean-intent'`)).rows[0].sequence, 1);
  await refusal(client, `DELETE FROM "WorkCapsuleActivity" WHERE id='clean-intent'`);
});

postgresTest("preparation refuses independently changed guard bodies or attachments without overwriting them", async t => {
  const changes = [
    `CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'Independently changed guard'; END; $$ LANGUAGE plpgsql`,
    `ALTER TABLE "WorkCapsuleActivity" DISABLE TRIGGER initiative_work_intent_immutable`,
    `ALTER FUNCTION refuse_initiative_governance_activity_mutation() SECURITY DEFINER`,
    `ALTER FUNCTION refuse_initiative_governance_activity_mutation() SET search_path TO public`,
    `ALTER FUNCTION refuse_initiative_governance_activity_mutation() STABLE`,
    `DROP TRIGGER initiative_work_intent_immutable ON "WorkCapsuleActivity";
      CREATE TRIGGER initiative_work_intent_immutable BEFORE UPDATE OR DELETE ON "WorkCapsuleActivity"
      FOR EACH ROW WHEN (OLD.kind = 'note')
      EXECUTE FUNCTION refuse_initiative_governance_activity_mutation()`,
    `DROP TRIGGER initiative_work_intent_immutable ON "WorkCapsuleActivity";
      CREATE TRIGGER initiative_work_intent_immutable BEFORE UPDATE OR DELETE ON "WorkCapsuleActivity"
      FOR EACH ROW WHEN (NEW.kind = 'work-intent-declared')
      EXECUTE FUNCTION refuse_initiative_governance_activity_mutation()`,
    `CREATE OR REPLACE FUNCTION workcapsule_activity_assign_sequence() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'Independently changed assignment'; END; $$ LANGUAGE plpgsql`,
    `ALTER TABLE "WorkCapsuleActivity" DISABLE TRIGGER workcapsule_activity_assign_sequence`,
  ];
  for (const change of changes) {
    await t.test(change.split("\n")[0], async subtest => {
      const { client } = await fixture(subtest);
      // DELETE triggers cannot refer to NEW. The altered UPDATE-only trigger is
      // deliberately unlike the predecessor despite a superficially equal kind.
      await client.query(change.includes("NEW.kind") ? change.replace("BEFORE UPDATE OR DELETE ON", "BEFORE UPDATE ON") : change);
      const before = await snapshot(client);
      const definitions = (await client.query(`SELECT tgname, pg_get_triggerdef(oid) AS definition, tgenabled
        FROM pg_trigger WHERE tgrelid='"WorkCapsuleActivity"'::regclass ORDER BY tgname`)).rows;
      const assignment = (await client.query(`SELECT pg_get_functiondef('workcapsule_activity_assign_sequence()'::regprocedure) AS definition`)).rows;
      await assert.rejects(client.query(preparation), error => {
        assert.equal(error.code, "23514");
        assert.equal(error.message, "Workroom ingestion preparation requires the original append-only and sequence guards");
        return true;
      });
      await client.query("ROLLBACK");
      assert.deepEqual(await snapshot(client), before);
      assert.deepEqual((await client.query(`SELECT tgname, pg_get_triggerdef(oid) AS definition, tgenabled
        FROM pg_trigger WHERE tgrelid='"WorkCapsuleActivity"'::regclass ORDER BY tgname`)).rows, definitions);
      assert.deepEqual((await client.query(`SELECT pg_get_functiondef('workcapsule_activity_assign_sequence()'::regprocedure) AS definition`)).rows, assignment);
    });
  }
});

postgresTest("preparation and unchanged hardening preserve semantic fields, assigned positions and overflow", async t => {
  const { client } = await fixture(t);
  const before = await snapshot(client);
  await client.query(preparation);
  const prepared = await snapshot(client);
  assert.equal(prepared.guard, before.guard, "the exact original refusal definition is restored before commit");
  assert.deepEqual(semantics(prepared.activities), semantics(before.activities));
  assert.deepEqual(prepared.governance, before.governance);
  assert.deepEqual(Object.fromEntries(prepared.activities.map(row => [row.id, row.sequence])), {
    "ahead-assigned": 2, "ahead-intent": 11, "boundary-intent": 2147483647,
    "mixed-assigned": 7, "mixed-intent-a": 8, "mixed-intent-b": 9, "mixed-ordinary": 10,
    "negative-intent": 1, "overflow-intent": null, "overflow-ordinary": null,
  });
  assert.deepEqual(Object.fromEntries(prepared.rooms.map(row => [row.id, row.activitySequence])), {
    ahead: 11, boundary: 2147483647, mixed: 10, negative: 1, overflow: 2147483646,
  });
  await client.query(preparation);
  assert.deepEqual(await snapshot(client), prepared, "repeated preparation allocates nothing");
  await client.query(hardening);
  assert.deepEqual(await snapshot(client), prepared);
  for (const statement of [
    `UPDATE "WorkCapsuleActivity" SET summary = 'changed' WHERE id = 'mixed-intent-a'`,
    `DELETE FROM "WorkCapsuleActivity" WHERE id = 'mixed-intent-a'`,
    `UPDATE "BacklogItemActivity" SET summary = 'changed' WHERE id = 'governance'`,
    `DELETE FROM "BacklogItemActivity" WHERE id = 'governance'`,
  ]) await refusal(client, statement);
  // PostgreSQL runs the alphabetically earlier position guard first.
  await refusal(client, `UPDATE "WorkCapsuleActivity" SET "sequence" = 15 WHERE id = 'overflow-intent'`, "23514");
  await refusal(client, `UPDATE "WorkCapsuleActivity" SET "sequence" = 25 WHERE id = 'mixed-ordinary'`, "23514");
  await refusal(client, `UPDATE "WorkCapsuleActivity" SET "workCapsuleId" = 'ahead' WHERE id = 'mixed-ordinary'`, "23514");
  await refusal(client, `INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",kind,summary,"sequence") VALUES ('explicit','mixed','note','Refused',99)`, "23514");
  assert.deepEqual(await snapshot(client), prepared);
  await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",kind,summary) VALUES ('new','mixed','note','Assigned by DB')`);
  assert.equal((await client.query(`SELECT "sequence" FROM "WorkCapsuleActivity" WHERE id='new'`)).rows[0].sequence, 11);
});

postgresTest("the temporary guard admits only work-intent NULL-to-position metadata within its transaction", async t => {
  const { client } = await fixture(t);
  const before = await snapshot(client);
  const temporaryGuard = preparation.match(/  CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation\(\)[\s\S]*?\$guard\$ LANGUAGE plpgsql;/)?.[0];
  assert.ok(temporaryGuard);
  await client.query(`BEGIN; LOCK TABLE "WorkCapsule" IN ACCESS EXCLUSIVE MODE; LOCK TABLE "WorkCapsuleActivity" IN ACCESS EXCLUSIVE MODE; ${temporaryGuard}`);
  const statements = [
    `UPDATE "WorkCapsuleActivity" SET summary='changed', "sequence"=4 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET payload='{"changed":true}', "sequence"=4 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET "futureSemanticField"='changed', "sequence"=4 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET kind='note', "sequence"=4 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET "workCapsuleId"='ahead', "sequence"=4 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET "sequence"=0 WHERE id='mixed-intent-a'`,
    `UPDATE "WorkCapsuleActivity" SET "sequence"=8 WHERE id='mixed-assigned'`,
    `DELETE FROM "WorkCapsuleActivity" WHERE id='mixed-intent-a'`,
    `UPDATE "BacklogItemActivity" SET summary='changed' WHERE id='governance'`,
    `DELETE FROM "BacklogItemActivity" WHERE id='governance'`,
  ];
  for (const statement of statements) {
    await client.query("SAVEPOINT refusal");
    await refusal(client, statement);
    await client.query("ROLLBACK TO SAVEPOINT refusal");
  }
  await client.query(`UPDATE "WorkCapsuleActivity" SET "sequence"=8 WHERE id='mixed-intent-a'`);
  await client.query("ROLLBACK");
  assert.deepEqual(await snapshot(client), before);
});

postgresTest("interruption rolls back preparation and its function replacement while competing activity writes wait", async t => {
  const { client, schema } = await fixture(t);
  const observer = new pg.Client({ connectionString: databaseUrl });
  const writer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  await writer.connect();
  t.after(async () => { await observer.end(); await writer.end(); });
  await observer.query(`SET search_path TO "${schema}"`);
  await writer.query(`SET search_path TO "${schema}"`);
  const before = await snapshot(client);
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const running = client.query(preparation.replace(restoreMarker, `  PERFORM pg_sleep(30);\n${restoreMarker}`));
  // Observe the caught result immediately so cancellation cannot be unhandled.
  const result = running.then(() => null, error => error);
  await waitFor(observer, pid, "Timeout");
  // The other table still observes the committed append-only guard.
  await refusal(observer, `UPDATE "BacklogItemActivity" SET summary='changed' WHERE id='governance'`);
  const competing = writer.query(`UPDATE "WorkCapsuleActivity" SET summary=summary WHERE id='mixed-ordinary'`);
  const competingResult = competing.then(() => null, error => error);
  await waitFor(observer, writerPid, "Lock");
  assert.equal((await observer.query("SELECT pg_cancel_backend($1) AS cancelled", [pid])).rows[0].cancelled, true);
  assert.equal((await result)?.code, "57014");
  await client.query("ROLLBACK");
  assert.equal(await competingResult, null);
  assert.deepEqual(await snapshot(client), before);
  await refusal(client, `UPDATE "WorkCapsuleActivity" SET "sequence"=8 WHERE id='mixed-intent-a'`);
});

postgresTest("already-hardened installs leave retained rows and both function definitions untouched", async t => {
  const { client } = await fixture(t);
  await client.query(preparation);
  await client.query(hardening);
  const before = await snapshot(client);
  const definitions = (await client.query(`SELECT pg_get_functiondef('workcapsule_activity_assign_sequence()'::regprocedure) AS assign,
    pg_get_functiondef('preserve_workroom_activity_sequence()'::regprocedure) AS preserve`)).rows;
  await client.query(preparation);
  assert.deepEqual(await snapshot(client), before);
  assert.deepEqual((await client.query(`SELECT pg_get_functiondef('workcapsule_activity_assign_sequence()'::regprocedure) AS assign,
    pg_get_functiondef('preserve_workroom_activity_sequence()'::regprocedure) AS preserve`)).rows, definitions);
});
