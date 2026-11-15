import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationSql } from "./dev-preview-migrate-converge.mjs";
import {
  REGISTRY_MIGRATION, RELATION_DRIFT_MIGRATION, recoverGraphRegistry,
} from "./dev-preview-graph-registry-recovery.mjs";

// An I/O boundary double: actual immutable SQL is read; database replies model
// the observed failure. Assertions concern durable effects and command ordering.
function fixture({ wrongChecksum = false, restoreFails = false, incomplete = false, resolveFails = false, deployFails = false } = {}) {
  const events = [];
  let restoredKeys = [];
  const query = async (sql, values = []) => {
    events.push({ sql, values });
    if (sql.includes("WHERE migration_name = $1")) return [{ migration_name: REGISTRY_MIGRATION,
      checksum: wrongChecksum ? "wrong" : "b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8",
      finished_at: "2026-10-28T22:13:52Z", rolled_back_at: null, applied_steps_count: 1 }];
    if (sql.includes("WHERE finished_at IS NULL")) return [{ migration_name: RELATION_DRIFT_MIGRATION,
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
    if (sql.startsWith('SELECT "key"')) return [];
    return [];
  };
  const runPrisma = args => {
    events.push({ prisma: args });
    return { ok: args[1] === "resolve" ? !resolveFails : !deployFails, stdout: "actual deploy output", combined: "fixture Prisma output" };
  };
  return { query, runPrisma, readSql: readMigrationSql, events,
    context: { environment: "dev", databaseUrl: "postgresql://dpf@127.0.0.1:5433/dpf" } };
}

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
