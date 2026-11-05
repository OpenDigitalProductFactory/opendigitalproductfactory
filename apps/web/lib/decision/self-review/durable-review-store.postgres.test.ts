import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@dpf/db", async original => ({ ...await original<object>(), get prisma() { return context.db; } }));
vi.mock("@/lib/agent-toolchain/served-toolchain", () => ({ getInstallationDeviceId: async () => "did-review-sql-fixture" }));
import { executeDurableReview } from "./durable-review-store";
import { emptyRoutingSummary } from "./route-review-findings";
import type { ReviewLine } from "./measures";
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["ScheduledAgentTask", "ScheduledJob", "TaskRun", "TaskNode", "TaskArtifact", "TaskMessage", "PlatformCapability", "RuntimeCapabilityTransition"];
const line: ReviewLine = { lineKey: "fixture", scope: "wwmd", measureKey: "volume", professionKey: null, headline: "Fixture count", evidence: { count: 2 }, proposedAction: "no-action" };
describe.skipIf(!url)("durable weekly review on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=15000`, max: 8 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    context.db = db;
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    const enums = await pool.query<{ ddl: string }>(`SELECT DISTINCT format('CREATE DOMAIN %I.%I AS %I.%I', $1::text, e.typname, en.nspname, e.typname) AS ddl
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
      JOIN pg_type e ON e.oid=CASE WHEN t.typtype='e' THEN t.oid ELSE t.typelem END JOIN pg_namespace en ON en.oid=e.typnamespace
      WHERE n.nspname=$1::text AND a.attnum>0 AND NOT a.attisdropped AND e.typtype='e'`, [schema]);
    for (const { ddl } of enums.rows) await pool.query(ddl);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
    await db.scheduledAgentTask.create({ data: { taskId: "review-fixture", ownerUserId: "review-owner", agentId: "platform-engineer", title: "Review fixture", routeContext: "decision-engine-review", prompt: "Measure fixture", schedule: "0 6 * * 1", taskKind: "decision-engine-review", isActive: true, nextRunAt: new Date("2026-11-09") } });
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^review_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  async function input() {
    const commission = await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "review-fixture" } });
    return { task: commission, commission, periodKey: "2026-W45", now: new Date("2026-11-02T06:00:00Z"),
      measure: vi.fn(async () => [line]), prepare: vi.fn(async () => ({ kind: "report", target: "fixture" })),
      reconcile: async () => undefined, route: vi.fn(async (_line, _period, tx) => {
        const run = await tx.taskRun.findFirstOrThrow({ where: { userId: "review-owner" } });
        await tx.taskMessage.create({ data: { id: randomUUID(), messageId: randomUUID(), taskRunId: run.id, role: "system", parts: [{ type: "fixture-effect", text: "one effect" }], referenceTaskIds: [] } });
        return emptyRoutingSummary();
      }) as Parameters<typeof executeDurableReview>[0]["route"],
    } satisfies Parameters<typeof executeDurableReview>[0];
  }
  it("admits one concurrent logical run and replays its frozen result", async () => {
    const first = await input(), second = await input();
    const outcomes = await Promise.allSettled([executeDurableReview(first), executeDurableReview(second)]);
    expect(outcomes.some(result => result.status === "fulfilled" && result.value)).toBe(true);
    expect(await db.taskRun.count()).toBe(1);
    expect(await db.taskMessage.count()).toBe(1);
    const run = await db.taskRun.findFirstOrThrow();
    expect(run.status).toBe("completed");
    const replay = await input();
    await executeDurableReview(replay);
    expect(await db.taskMessage.count()).toBe(1);
    expect(await db.taskRun.findFirstOrThrow()).toMatchObject({ completedAt: run.completedAt });
  });
  it("rolls back the effect and permits one retry with the frozen measurement", async () => {
    const request = await input();
    const route = request.route;
    request.route = async (...args) => { await route(...args); throw new Error("fixture transaction rollback"); };
    await expect(executeDurableReview(request)).rejects.toThrow("fixture transaction rollback");
    expect(await db.taskMessage.count()).toBe(0);
    expect(await db.taskArtifact.count({ where: { name: { startsWith: "rollback:" } } })).toBe(1);
    const retry = await input();
    await expect(executeDurableReview(retry)).resolves.toBe(true);
    expect(retry.measure).not.toHaveBeenCalled();
    expect(retry.prepare).not.toHaveBeenCalled();
    expect(await db.taskMessage.count()).toBe(1);
  });
  it("rejects a superseded commission before creating any review run", async () => {
    const request = await input();
    await db.scheduledAgentTask.update({ where: { taskId: "review-fixture" }, data: { isActive: false } });
    await expect(executeDurableReview(request)).rejects.toThrow("before admission");
    expect(await db.taskRun.count()).toBe(0);
    expect(await db.taskMessage.count()).toBe(0);
  });
  it("prevents destination mutation after revocation between preparation and intent", async () => {
    const request = await input();
    request.prepare = vi.fn(async () => { await db.scheduledAgentTask.update({ where: { taskId: "review-fixture" }, data: { isActive: false } }); return { kind: "report", target: "fixture" }; });
    await expect(executeDurableReview(request)).rejects.toThrow("commission superseded");
    expect(request.route).not.toHaveBeenCalled();
    expect(await db.taskMessage.count()).toBe(0);
  });
  it("does not let a stale rival cancel the valid creator before node activation", async () => {
    const creator = await input(), stale = await input();
    let release!: () => void, admitted!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const created = new Promise<void>(resolve => { admitted = resolve; });
    const original = db.taskRun.findUniqueOrThrow.bind(db.taskRun);
    // This caller awaits the lookup; its Prisma fluent relation methods are unused.
    const delegate = db.taskRun as unknown as { findUniqueOrThrow(args: Parameters<typeof original>[0]): Promise<Awaited<ReturnType<typeof original>>> };
    const spy = vi.spyOn(delegate, "findUniqueOrThrow").mockImplementationOnce(async args => {
      const row = await original(args);
      admitted();
      await held;
      return row;
    });
    const pending = executeDurableReview(creator);
    try {
      await created;
      await expect(executeDurableReview(stale)).resolves.toBe(false);
      expect((await db.taskRun.findFirstOrThrow()).status).toBe("working");
    } finally { release(); spy.mockRestore(); }
    await expect(pending).resolves.toBe(true);
    expect(await db.taskMessage.count()).toBe(1);
  });

});
