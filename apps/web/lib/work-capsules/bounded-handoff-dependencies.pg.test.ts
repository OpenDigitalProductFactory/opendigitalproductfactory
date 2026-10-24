/** Real Prisma predicate/plan qualification in an admitted disposable database.
 * Nothing here reads or mutates application schemas or invents a passing plan.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandoffDependencyPostgresFixture } from "../../../../packages/db/src/handoff-dependency-postgres-fixture";
import { assertBoundedHandoffDependencies } from "./bounded-handoff-dependencies";

const configured = process.env.DATABASE_URL?.trim() ?? "";
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || (() => {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(configured).pathname) ? configured : ""; }
  catch { return ""; }
})();
const SCHEMA = "dpf_handoff_dependency_" + randomUUID().replaceAll("-", "");
const HISTORY_ROWS = 10_000;
const ROOT = join(__dirname, "../../../..");
const INITIAL_MIGRATION = join(ROOT, "packages/db/prisma/migrations/20260526094500_nonprod_environment_leases/migration.sql");
const OWNER_INDEX_MIGRATION = join(ROOT, "packages/db/prisma/migrations/20261024010000_nonprod_lease_owner_session_status/migration.sql");
const OWNER_INDEX = "NonProductionEnvironmentLease_ownerSessionId_status_idx";
const OWNER_INDEX_SQL = `CREATE INDEX "${OWNER_INDEX}" ON "NonProductionEnvironmentLease" ("ownerSessionId", "status")`;
const room = { id: "room", capsuleId: "WC-room", featureBuildId: null, repositoryFullName: null,
  headSha: null, headBranch: null, executorKind: "claude-desktop", executorRef: "source" };
type PlanNode = { "Node Type": string; "Index Name"?: string; "Actual Rows"?: number; "Actual Loops"?: number;
  "Rows Removed by Filter"?: number; "Rows Removed by Index Recheck"?: number; "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number; Plans?: PlanNode[] };
function examinedRows(node: PlanNode): number {
  return ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)
    + (node["Rows Removed by Index Recheck"] ?? 0)) * (node["Actual Loops"] ?? 1)
    + (node.Plans ?? []).reduce((sum, child) => sum + examinedRows(child), 0);
}

describe.skipIf(!DATABASE_URL)("handoff dependency history and exact query plan (PostgreSQL)", () => {
  let pool: Pool;
  let fixture: ReturnType<typeof createHandoffDependencyPostgresFixture>;
  const check = () => assertBoundedHandoffDependencies(fixture.prisma, {
    capsule: room, sourceExecutorRef: "source", destinationExecutorRef: "receiver",
  });
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: "-c search_path=" + SCHEMA });
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    fixture = createHandoffDependencyPostgresFixture(DATABASE_URL, SCHEMA);
    await pool.query(readFileSync(INITIAL_MIGRATION, "utf8"));
    // Later production indexes are represented too; none is a session-leading index.
    await pool.query(`ALTER TABLE "NonProductionEnvironmentLease" ADD "queuedAt" TIMESTAMP(3), ADD "resourceClass" TEXT;
      CREATE INDEX "NonProductionEnvironmentLease_environmentKey_status_queuedAt_idx"
        ON "NonProductionEnvironmentLease" ("environmentKey", "status", "queuedAt");
      CREATE INDEX "NonProductionEnvironmentLease_resourceClass_status_idx"
        ON "NonProductionEnvironmentLease" ("resourceClass", "status");
      INSERT INTO "NonProductionEnvironmentLease" (id,"leaseId","environmentKey",status,"ownerProvider","ownerSessionId",purpose,url,"expiresAt","updatedAt")
      SELECT 'history-'||g, 'NPEL-history-'||g, 'local-integration-ci',
        (ARRAY['released','expired','cancelled'])[1 + g % 3], 'provider-'||(g % 100),
        CASE WHEN g <= 20 THEN 'source' WHEN g <= 40 THEN 'receiver' ELSE 'session-'||g END,
        repeat('fixture history ', 40), 'http://fixture.invalid', clock_timestamp()-interval '1 day', clock_timestamp()
      FROM generate_series(1, ${HISTORY_ROWS}) AS g;
      ANALYZE "NonProductionEnvironmentLease"`);
  });
  afterAll(async () => {
    await fixture?.prisma.$disconnect();
    if (pool) { try { await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); } finally { await pool.end(); } }
  });

  it("ignores terminal history without truncating the exact owner lookup", async () => {
    expect((await pool.query('SELECT count(*)::int AS n FROM "NonProductionEnvironmentLease"')).rows[0].n).toBe(HISTORY_ROWS);
    await expect(check()).resolves.toBeUndefined();
  });

  it.each(["source", "receiver"].flatMap(owner => ["queued", "active", "unknown-positive"].map(status => ({ owner, status }))))(
    "refuses old $status leases for $owner even after their TTL expired", async ({ owner, status }) => {
      await pool.query(`INSERT INTO "NonProductionEnvironmentLease" (id,"leaseId","environmentKey",status,"ownerProvider","ownerSessionId",purpose,url,"expiresAt","updatedAt")
        VALUES ('blocking','NPEL-blocking','local-integration-ci',$1,'foreign-provider',$2,'fixture','http://fixture.invalid',clock_timestamp()-interval '1 day',clock_timestamp())`, [status, owner]);
      try { await expect(check()).rejects.toMatchObject({ code: "handoff-lease-dependency", message: expect.stringContaining("NPEL-blocking") }); }
      finally { await pool.query('DELETE FROM "NonProductionEnvironmentLease" WHERE id = $1', ["blocking"]); }
    },
  );

  it("qualifies the actual Prisma session/status query before adopting an index", async () => {
    fixture.queries.length = 0;
    await check();
    const query = fixture.queries.find(entry => entry.query.includes('"NonProductionEnvironmentLease"') && entry.query.startsWith("SELECT"));
    expect(query).toBeDefined();
    // Raw EXPLAIN executes the exact SQL and bound values captured from the production delegate.
    const explain = async () => (await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query!.query, JSON.parse(query!.params))).rows[0]["QUERY PLAN"][0] as { Plan: PlanNode; "Execution Time": number };
    const before = await explain();
    const migrationPresent = existsSync(OWNER_INDEX_MIGRATION);
    await pool.query(migrationPresent ? readFileSync(OWNER_INDEX_MIGRATION, "utf8") : OWNER_INDEX_SQL);
    await pool.query('ANALYZE "NonProductionEnvironmentLease"');
    const after = await explain();
    const qualification = { historyRows: HISTORY_ROWS, beforeExaminedRows: examinedRows(before.Plan), afterExaminedRows: examinedRows(after.Plan),
      beforeBlocks: (before.Plan["Shared Hit Blocks"] ?? 0) + (before.Plan["Shared Read Blocks"] ?? 0),
      afterBlocks: (after.Plan["Shared Hit Blocks"] ?? 0) + (after.Plan["Shared Read Blocks"] ?? 0),
      beforePlan: before.Plan, afterPlan: after.Plan };
    console.info("handoff-lease-query-qualification", JSON.stringify(qualification));
    expect(qualification.afterExaminedRows).toBeLessThanOrEqual(100);
    expect(JSON.stringify(after.Plan)).toContain(OWNER_INDEX);
    if (qualification.beforeExaminedRows > 100) {
      expect(migrationPresent, "The measured production lookup needs the qualified ownerSessionId/status migration; a fixture-only index is not delivery.").toBe(true);
      const schema = readFileSync(join(ROOT, "packages/db/prisma/schema/build-delivery.prisma"), "utf8");
      expect(schema).toContain("@@index([ownerSessionId, status])");
    }
  });
});
