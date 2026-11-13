import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.DPF_INGESTION_TEST_DATABASE_URL;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const prisma = resolve(root, "node_modules/.bin/prisma");
const migration = name => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
const hardeningName = "20261014012000_workroom_activity_ingestion_hardening";
const prepName = "20261014011900_prepare_workroom_activity_ingestion";
const sequenceName = "20261013180000_workroom_activity_sequence";

test("Prisma applies out-of-order preparation to failed and already-hardened histories", {skip: !databaseUrl, timeout: 60000}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-activity-prisma-"));
  const schema = `activity_prisma_${randomUUID().replaceAll("-", "")}`;
  const schemas = [schema];
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  const client = new pg.Client({connectionString: databaseUrl});
  await client.connect();
  t.after(async () => {
    for (const name of schemas) await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    await client.end();
    await rm(dir, {recursive: true, force: true});
  });
  const migrations = join(dir, "migrations");
  await mkdir(migrations);
  await writeFile(join(migrations, "migration_lock.toml"), 'provider = "postgresql"\n');
  await writeFile(join(dir, "schema.prisma"), 'datasource db {\n  provider = "postgresql"\n}\n');
  const config = join(dir, "prisma.config.ts");
  await writeFile(config, `export default {schema: ${JSON.stringify(join(dir,"schema.prisma"))}, migrations: {path: ${JSON.stringify(migrations)}}, datasource: {url: process.env.DPF_RECOVERY_PRISMA_TEST_URL}};\n`);
  const add = async (name, sql) => {await mkdir(join(migrations, name)); await writeFile(join(migrations, name, "migration.sql"), sql);};
  const governance = await migration("20260808235000_initiative_readiness_receipts");
  const guard = governance.match(/CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
  const trigger = governance.match(/CREATE TRIGGER initiative_work_intent_immutable[\s\S]*?EXECUTE FUNCTION refuse_initiative_governance_activity_mutation\(\);/)?.[0];
  assert.ok(guard && trigger);
  await add("20260808235000_recovery_fixture", `CREATE TABLE "WorkCapsule" (id text PRIMARY KEY);
    CREATE TABLE "WorkCapsuleActivity" (id text PRIMARY KEY, "workCapsuleId" text NOT NULL REFERENCES "WorkCapsule"(id),
      kind text NOT NULL, summary text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', "recordedAt" timestamptz NOT NULL DEFAULT now());
    INSERT INTO "WorkCapsule" VALUES ('retained');
    INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",kind,summary,payload) VALUES
      ('protected','retained','work-intent-declared','Keep intent','{"evidence":"unchanged"}'),
      ('ordinary','retained','note','Keep note','{}');\n${guard}\n${trigger}\n`);
  await add(sequenceName, await migration(sequenceName));
  await add(hardeningName, await migration(hardeningName));
  function run(...args) {
    const result = spawnSync(prisma, [...args, "--config", config], {cwd: root,
      env: {...process.env, DPF_RECOVERY_PRISMA_TEST_URL: url.href}, encoding:"utf8", timeout:20000});
    assert.ifError(result.error);
    return {status:result.status, output: `${result.stdout}\n${result.stderr}`};
  }
  const first = run("migrate", "deploy");
  assert.notEqual(first.status, 0, first.output);
  // Prisma loses the first exception while attempting to write its failed
  // ledger entry through this migration's already-aborted transaction.
  assert.match(first.output, /current transaction is aborted/);
  await client.query(`SET search_path TO "${schema}"`);
  const original = (await client.query(`SELECT id,kind,summary,payload,"sequence" FROM "WorkCapsuleActivity" ORDER BY id`)).rows;
  assert.ok(original.every(row => row.sequence === null));
  const unresolved = (await client.query(`SELECT migration_name,applied_steps_count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`)).rows;
  assert.deepEqual(unresolved, [{migration_name:hardeningName, applied_steps_count:0}]);
  await assert.rejects(client.query(await migration(hardeningName)), error =>
    error.code === "P0001" && error.message === "initiative governance activities are append-only");
  await client.query("ROLLBACK");
  await add(prepName, await migration(prepName));
  const resolution = run("migrate", "resolve", "--rolled-back", hardeningName);
  assert.equal(resolution.status, 0, resolution.output);
  const corrected = run("migrate", "deploy");
  assert.equal(corrected.status, 0, corrected.output);
  assert.ok(corrected.output.indexOf(prepName) < corrected.output.indexOf(hardeningName), corrected.output);
  const after = (await client.query(`SELECT id,kind,summary,payload,"sequence" FROM "WorkCapsuleActivity" ORDER BY id`)).rows;
  assert.deepEqual(after.map(({sequence:_,...row}) => row), original.map(({sequence:_,...row}) => row));
  assert.ok(after.every(row => Number.isInteger(row.sequence) && row.sequence > 0));
  const history = (await client.query(`SELECT migration_name,finished_at IS NOT NULL AS applied,rolled_back_at IS NOT NULL AS rolled_back
    FROM "_prisma_migrations" WHERE migration_name IN ($1,$2) ORDER BY started_at`, [prepName,hardeningName])).rows;
  assert.deepEqual(history, [
    {migration_name:hardeningName,applied:false,rolled_back:true},
    {migration_name:prepName,applied:true,rolled_back:false},
    {migration_name:hardeningName,applied:true,rolled_back:false},
  ]);
  const repeated = run("migrate", "deploy");
  assert.equal(repeated.status, 0, repeated.output);
  assert.match(repeated.output, /No pending migrations/);

  // A separate source history completed the published hardening before this
  // preparation existed. Its older pending migration must be an actual no-op.
  const hardenedSchema = `${schema}_applied`;
  schemas.push(hardenedSchema);
  url.searchParams.set("schema", hardenedSchema);
  await rm(join(migrations, prepName), {recursive:true});
  const fixturePath = join(migrations,"20260808235000_recovery_fixture","migration.sql");
  const initialSql = await readFile(fixturePath,"utf8");
  await writeFile(fixturePath, initialSql.replace("'protected','retained','work-intent-declared'", "'protected','retained','note'"));
  const alreadyApplied = run("migrate","deploy");
  assert.equal(alreadyApplied.status, 0, alreadyApplied.output);
  await client.query(`SET search_path TO "${hardenedSchema}"`);
  const snapshot = () => client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM "WorkCapsuleActivity" a) AS activities,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "WorkCapsule" r) AS rooms,
    pg_get_functiondef('workcapsule_activity_assign_sequence()'::regprocedure) AS assignment,
    pg_get_functiondef('preserve_workroom_activity_sequence()'::regprocedure) AS preservation,
    pg_get_functiondef('refuse_initiative_governance_activity_mutation()'::regprocedure) AS refusal`);
  const appliedBefore = (await snapshot()).rows;
  await add(prepName, await migration(prepName));
  const earlier = run("migrate","deploy");
  assert.equal(earlier.status, 0, earlier.output);
  assert.match(earlier.output, new RegExp(`Applying migration .${prepName}.`));
  assert.doesNotMatch(earlier.output, new RegExp(`Applying migration .${hardeningName}.`));
  assert.deepEqual((await snapshot()).rows, appliedBefore);
});
