import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { submitImprovementDraft, type ImprovementDraftDatabase } from "./improvement-draft";

const indexing = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: indexing }));

// Explicit governed PostgreSQL target only. Every row is created in this
// suite's unique schema; installed proposals, threads and backlog are untouched.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `learning_draft_test_${randomUUID().replaceAll("-", "")}`;
const input = { title: "Observed learning", description: "A measured local bottleneck", category: "performance" };
const context = { agentId: "test-agent", routeContext: "/build", threadId: "test-thread" };
const deps = {
  listRepoFiles: async () => [],
  searchSimilarItems: async () => ({ status: "ok", results: [] }),
  indexKnowledge: vi.fn(),
};

describe.skipIf(!url)("learning draft transactions on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  const submit = (client: ImprovementDraftDatabase = db) => submitImprovementDraft(input, "test-owner", context, client, deps);
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=15000`, max: 8 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of ["AgentThread", "ImprovementProposal", "BacklogItem", "BacklogItemActivity", "Epic"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const enums = await pool.query<{ ddl: string }>(`
      SELECT DISTINCT format('CREATE DOMAIN %I.%I AS %I.%I', $1::text, e.typname, en.nspname, e.typname) AS ddl
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
      JOIN pg_type e ON e.oid=CASE WHEN t.typtype='e' THEN t.oid ELSE t.typelem END
      JOIN pg_namespace en ON en.oid=e.typnamespace
      WHERE n.nspname=$1::text AND a.attnum>0 AND NOT a.attisdropped AND e.typtype='e'
    `, [schema]);
    for (const { ddl } of enums.rows) await pool.query(ddl);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await pool.query('DROP TRIGGER IF EXISTS learning_projection_failure ON "ImprovementProposal"');
    await pool.query('TRUNCATE "AgentThread", "ImprovementProposal", "BacklogItem", "BacklogItemActivity", "Epic"');
    await pool.query(`INSERT INTO "AgentThread" (id,"userId","contextKey","updatedAt") VALUES ('test-thread','test-owner','coworker',clock_timestamp())`);
  });
  afterAll(async () => {
    await db?.$disconnect();
    await pool?.end();
    if (admin && /^learning_draft_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("persists one proposal and intake origin across concurrent identical submissions", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => submit()));
    expect(new Set(results.map(result => result.entityId)).size).toBe(1);
    expect(results.every(result => result.success && !result.data?.projectionPending)).toBe(true);
    expect(await db.improvementProposal.count()).toBe(1);
    expect(await db.backlogItem.count()).toBe(1);
    const proposal = await db.improvementProposal.findFirstOrThrow();
    expect(proposal.conversationExcerpt).toBeNull();
    expect(proposal.backlogItemId).toBeTruthy();
    expect(await db.backlogItemActivity.count({ where: { kind: "intake_origin", payload: { path: ["origin", "id"], equals: proposal.proposalId } } })).toBe(1);
    await submit();
    expect(await db.backlogItem.count()).toBe(1);
    expect(deps.indexKnowledge).toHaveBeenCalledTimes(1);
  });

  it("rolls back interrupted intake and recovers it with the original durable proposal", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION fail_learning_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test projection interrupted'; END $$`);
    await pool.query('CREATE TRIGGER learning_projection_failure BEFORE UPDATE OF "backlogItemId" ON "ImprovementProposal" FOR EACH ROW EXECUTE FUNCTION fail_learning_projection()');
    const first = await submit();
    expect(first).toMatchObject({ success: true, data: { projectionPending: true } });
    expect(await db.improvementProposal.count()).toBe(1);
    expect(await db.backlogItem.count()).toBe(0);
    expect(await db.backlogItemActivity.count()).toBe(0);
    expect(deps.indexKnowledge).not.toHaveBeenCalled();
    await pool.query('DROP TRIGGER learning_projection_failure ON "ImprovementProposal"');
    expect(await submit()).toMatchObject({ entityId: first.entityId, data: { reused: true, projectionPending: false } });
    expect(await db.improvementProposal.count()).toBe(1);
    expect(await db.backlogItem.count()).toBe(1);
  });

  it("does not replay a committed draft when the acknowledgement is lost", async () => {
    let calls = 0;
    const client: ImprovementDraftDatabase = { $transaction: async (work, options) => {
      const value = await db.$transaction(work, options);
      if (++calls === 1) throw new Error("test lost acknowledgement");
      return value;
    } };
    await expect(submit(client)).rejects.toThrow("lost acknowledgement");
    expect(calls).toBe(1);
    const original = await db.improvementProposal.findFirstOrThrow();
    expect(await db.improvementProposal.count()).toBe(1);
    expect(await submit()).toMatchObject({ entityId: original.proposalId, data: { reused: true } });
    expect(await db.improvementProposal.count()).toBe(1);
  });

  it("reloads committed intake after a lost projection acknowledgement without a second intake origin", async () => {
    let calls = 0;
    const client: ImprovementDraftDatabase = { $transaction: async (work, options) => {
      const value = await db.$transaction(work, options);
      if (++calls === 2) throw new Error("test lost projection acknowledgement");
      return value;
    } };
    const first = await submit(client);
    expect(first.data?.projectionPending).toBe(true);
    expect(calls).toBe(2);
    expect(await db.backlogItem.count()).toBe(1);
    expect(await submit()).toMatchObject({ entityId: first.entityId, data: { reused: true, projectionPending: false } });
    expect(await db.backlogItem.count()).toBe(1);
    expect(await db.backlogItemActivity.count({ where: { kind: "intake_origin" } })).toBe(1);
  });

  it("refuses actual foreign and cancelled thread rows before creating anything", async () => {
    await db.agentThread.update({ where: { id: "test-thread" }, data: { userId: "other-owner" } });
    expect((await submit()).success).toBe(false);
    await db.agentThread.update({ where: { id: "test-thread" }, data: { userId: "test-owner", cancelledAt: new Date() } });
    expect((await submit()).success).toBe(false);
    expect(await db.improvementProposal.count()).toBe(0);
    expect(await db.backlogItem.count()).toBe(0);
  });

  it("never revives a reviewed original", async () => {
    const first = await submit();
    await db.improvementProposal.update({ where: { proposalId: first.entityId }, data: { status: "reviewed" } });
    const next = await submit();
    expect(next.entityId).not.toBe(first.entityId);
    expect((await db.improvementProposal.findUniqueOrThrow({ where: { proposalId: first.entityId } })).status).toBe("reviewed");
  });
});
