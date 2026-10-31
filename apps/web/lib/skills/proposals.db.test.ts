import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  const value = state.db[key as keyof PrismaClient];
  return typeof value === "function" ? value.bind(state.db) : value;
} }) }));
import { submitSkillImprovementProposal } from "./proposals";

const leased = process.env.DPF_NONPROD_LEASE_ID && process.env.DATABASE_URL
  && /^\/dpf_local_ci_\d+$/.test(new URL(process.env.DATABASE_URL).pathname) ? process.env.DATABASE_URL : undefined;
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `skill_draft_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["SkillDefinition", "ImprovementProposal", "AgentThread"];
const draft = { skillId: "fixture-skill", proposedContent: "Explicit synthetic suggested body", title: "Synthetic draft",
  description: "Fixture evidence only", submittedById: "fixture-owner", agentId: "fixture-agent", routeContext: "/build", threadId: "fixture-thread" };

describe.skipIf(!url)("skill draft persistence on isolated leased PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=20000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) }); state.db = db;
    // Real table structure and unique indexes, synthetic rows only; no copied install records.
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(", ")}`);
    await db.skillDefinition.create({ data: { skillId: draft.skillId, name: "Fixture", description: "Synthetic fixture",
      sourceType: "internal", skillMdContent: "Original unchanged body", category: "operations" } });
    await db.skillDefinition.create({ data: { skillId: "second-skill", name: "Second fixture", description: "Synthetic fixture",
      sourceType: "internal", skillMdContent: "Second unchanged body", category: "operations" } });
    await db.agentThread.create({ data: { id: draft.threadId, userId: draft.submittedById } });
    await db.agentThread.create({ data: { id: "second-thread", userId: draft.submittedById, contextKey: "second" } });
    await db.agentThread.create({ data: { id: "foreign-thread", userId: "different-owner" } });
    await db.agentThread.create({ data: { id: "cancelled-thread", userId: draft.submittedById, contextKey: "cancelled", cancelledAt: new Date() } });
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^skill_draft_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("concurrent exact repeats create one proposed row and preserve skill bytes", async () => {
    const before = await db.skillDefinition.findUniqueOrThrow({ where: { skillId: draft.skillId } });
    const [first, second] = await Promise.all([submitSkillImprovementProposal(draft), submitSkillImprovementProposal(draft)]);
    expect(first.proposalId).toBe(second.proposalId);
    expect(await db.improvementProposal.count()).toBe(1);
    expect(await db.skillDefinition.findUnique({ where: { skillId: draft.skillId } })).toEqual(before);
    const saved = await db.improvementProposal.findUniqueOrThrow({ where: { proposalId: first.proposalId } });
    expect(saved).toMatchObject({ status: "proposed", category: "skill", targetSkillId: draft.skillId,
      conversationExcerpt: draft.proposedContent, submittedById: draft.submittedById, threadId: draft.threadId });
  });
  it.each(["agentId", "routeContext", "proposedContent", "description", "observedFriction", "title"])("isolates complete %s scope/content", async key => {
    const first = await submitSkillImprovementProposal(draft);
    const second = await submitSkillImprovementProposal({ ...draft, [key]: "Different synthetic value" });
    expect(second.proposalId).not.toBe(first.proposalId);
    expect(await db.improvementProposal.count()).toBe(2);
  });
  it.each([{ skillId: "second-skill" }, { threadId: "second-thread" }, { severity: "high" as const }])("isolates target, thread and severity %j", async changed => {
    const first = await submitSkillImprovementProposal(draft);
    const second = await submitSkillImprovementProposal({ ...draft, ...changed });
    expect(second.proposalId).not.toBe(first.proposalId);
  });
  it("does not return another owner's draft without a thread", async () => {
    const first = await submitSkillImprovementProposal({ ...draft, threadId: null });
    const second = await submitSkillImprovementProposal({ ...draft, threadId: null, submittedById: "other-owner" });
    expect(second.proposalId).not.toBe(first.proposalId);
  });
  it.each(["foreign-thread", "cancelled-thread", "missing-thread"])("rejects %s before any proposal persists", async threadId => {
    await expect(submitSkillImprovementProposal({ ...draft, threadId })).rejects.toThrow(/context|thread/i);
    expect(await db.improvementProposal.count()).toBe(0);
  });
  it("refuses a missing target without persisting a draft", async () => {
    await expect(submitSkillImprovementProposal({ ...draft, skillId: "missing-skill" })).rejects.toThrow(/unknown skillId/);
    expect(await db.improvementProposal.count()).toBe(0);
  });
  it("never revives a reviewed proposal", async () => {
    const first = await submitSkillImprovementProposal(draft);
    await db.improvementProposal.update({ where: { proposalId: first.proposalId }, data: { status: "rejected" } });
    const second = await submitSkillImprovementProposal(draft);
    expect(second.proposalId).not.toBe(first.proposalId);
    expect((await db.improvementProposal.findUniqueOrThrow({ where: { proposalId: first.proposalId } })).status).toBe("rejected");
  });
});
