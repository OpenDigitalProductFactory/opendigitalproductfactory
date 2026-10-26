import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordRuntimeVerification, type RuntimeCoordinationDb } from "./runtime-targets";

const external = vi.hoisted(() => ({ deployment: vi.fn() }));
vi.mock("@/lib/backlog/initiative-readiness/deployment-closure", () => ({ resolveBacklogDeploymentClosure: external.deployment }));
vi.mock("./small-acceptance-binding.server", async original => ({
  ...await original<typeof import("./small-acceptance-binding.server")>(),
  // The canonical projection is separately tested and driven live after merge.
  refreshSmallAcceptanceSnapshot: async () => {},
}));
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL
  ?? (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" ? process.env.DATABASE_URL : undefined);
const schema = `small_acceptance_${randomUUID().replaceAll("-", "")}`;
const sha = "a".repeat(40), head = "b".repeat(40), merge = "c".repeat(40);
const actor = { userId: "fixture-human", agentId: "fixture-agent", principalId: "fixture-principal" };
const tables = ["RuntimeVerification", "WorkCapsule", "WorkCapsuleActivity", "BacklogItem", "BacklogItemActivity",
  "PlatformConfig", "FeatureBuild", "ProductObjectiveWork"];

// Only the explicit governed SQL target is used. Every write is schema-local;
// installed work and history are never selected or changed.
describe.skipIf(!url)("Small runtime acceptance PostgreSQL transactions", () => {
  let admin: Pool, pool: Pool, db: PrismaClient, deployedAt: Date, closureAt: Date;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c statement_timeout=8000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    const domains = await pool.query<{ ddl: string }>(`
      SELECT DISTINCT format('CREATE DOMAIN %I.%I AS %I.%I', $1::text, e.typname, en.nspname, e.typname) AS ddl
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_type e ON e.oid=CASE WHEN t.typtype='e' THEN t.oid ELSE t.typelem END
      JOIN pg_namespace en ON en.oid=e.typnamespace
      WHERE n.nspname=$1::text AND a.attnum>0 AND NOT a.attisdropped AND e.typtype='e'`, [schema]);
    for (const row of domains.rows) await pool.query(row.ddl);
    await pool.query('CREATE TABLE "SelfUpgradeRun" (id text PRIMARY KEY, "runId" text UNIQUE)');
  });
  beforeEach(async () => {
    for (const table of [...tables, "SelfUpgradeRun"]) await pool.query(`TRUNCATE "${table}"`);
    deployedAt = new Date(Date.now() - 20_000); closureAt = new Date(Date.now() - 15_000);
    const deployment = { kind: "deployed", runId: "SUR-FIXTURE", repositoryFullName: "fixture/repo", pullRequestNumber: 1,
      headSha: head, mergeCommitSha: merge, servedSha: sha, targetSha: sha, completedAt: deployedAt.toISOString() };
    external.deployment.mockReset(); external.deployment.mockResolvedValue(deployment);
    await db.platformConfig.create({ data: { key: "portal.quiescence", value: { level: "normal" } } });
    await db.backlogItem.create({ data: { id: "item", itemId: "BI-FIXTURE", title: "Fixture Small repair", status: "done",
      type: "portfolio", source: "user-request", workType: "bug", scopeKind: "platform", effortSize: "small" } });
    await db.workroom.create({ data: { id: "room", capsuleId: "WC-FIXTURE", title: "Small fixture", objective: "Runtime check",
      source: "backlog", status: "archived", backlogItemId: "BI-FIXTURE", repositoryFullName: "fixture/repo",
      headBranch: "fix/fixture", headSha: head, pullRequestNumber: 1,
      scopeClaims: [{ workShape: "delivery-small@1.0.0" }] } });
    await db.backlogItemActivity.create({ data: { id: "closure", backlogItemId: "item", kind: "status_change",
      summary: "Fixture canonical closure", recordedAt: closureAt,
      payload: { to: "done", closureBasis: "canonical-deployment", deployment } } });
    await pool.query('INSERT INTO "SelfUpgradeRun" (id,"runId") VALUES ($1,$2)', ["upgrade", "SUR-FIXTURE"]);
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^small_acceptance_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  function check(id = "RV-SMALL-FIXTURE") {
    return { db: db as unknown as RuntimeCoordinationDb, actor, input: {
      verificationId: id, kind: "final-acceptance" as const, status: "passed" as const,
      workCapsuleId: "room", backlogActivityId: "closure", command: "Drive isolated recovery fixture",
      startedAt: new Date(closureAt.getTime() + 1000), completedAt: new Date(closureAt.getTime() + 2000),
      result: { observations: ["routing refused before dispatch", "unknown preserved"] },
    } };
  }
  it("serializes duplicate completion and returns the same immutable verification on retry", async () => {
    const args = check();
    const results = await Promise.allSettled([recordRuntimeVerification(args), recordRuntimeVerification(args)]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    // PostgreSQL may reject the competing Serializable snapshot; retry is exact-idempotent.
    const again = await recordRuntimeVerification(args);
    expect(await db.runtimeVerification.count()).toBe(1);
    expect((await db.runtimeVerification.findFirst())?.id).toBe(again.id);
    expect(await db.workroomActivity.count()).toBe(1);
  });
  it("rolls verification and activity back when the deployment changes before commit", async () => {
    const first = await external.deployment();
    external.deployment.mockResolvedValueOnce(first).mockResolvedValue({ ...first, runId: "SUR-REPLACED" });
    await expect(recordRuntimeVerification(check())).rejects.toThrow(/Deployment changed/);
    expect(await db.runtimeVerification.count()).toBe(0);
    expect(await db.workroomActivity.count()).toBe(0);
  });
  it("requires persisted normal quiescence before recording any acceptance effect", async () => {
    await db.platformConfig.update({ where: { key: "portal.quiescence" }, data: { value: { level: "swapping" } } });
    await expect(recordRuntimeVerification(check())).rejects.toThrow(/proven normal/);
    expect(await db.runtimeVerification.count()).toBe(0);
  });
});
