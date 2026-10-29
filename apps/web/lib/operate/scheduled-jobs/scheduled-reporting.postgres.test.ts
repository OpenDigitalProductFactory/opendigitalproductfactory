import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureScheduledReportingFor } from "./scheduled-reporting-config";
import { settleScheduledReportingRun, type ScheduledReportingRunInput } from "./scheduled-reporting-run";
import { scheduledReportingRevision, scheduledReportingScopeDigest } from "./scheduled-reporting-contract";
import { withCurrentScheduledTask } from "@/lib/actions/agent-task-claim";
import { createCommunicationDispatcher } from "@/lib/communications/dispatcher";
import { createInAppAdapter } from "@/lib/communications/in-app-adapter";
import { recordDeliveryAttempt } from "@/lib/communications/delivery-evidence";

// Never use the installed DATABASE_URL. Only the explicitly governed test
// target is eligible, and all mutations stay in this suite's disposable schema.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `reporting_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["ScheduledAgentTask", "ScheduledJob", "TaskRun", "ToolExecution", "TaskMessage", "AgentMessage", "Notification", "CommunicationDeliveryAttempt"];
const reader = { name: "observe_health", description: "Observe", inputSchema: { type: "object", properties: {} }, requiredCapability: null,
  sideEffect: false, executionMode: "immediate" as const };
const now = new Date("2026-10-29T06:00:00Z");
const report = (state = "routine", extra = {}) => JSON.stringify({ version: 1, state, summary: "Measured current health", evidenceToolNames: [reader.name], ...extra });

describe.skipIf(!url)("scheduled reporting transactions on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  let input: ScheduledReportingRunInput;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=15000`, max: 8 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
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
    await pool.query('DROP TRIGGER IF EXISTS freeze_reporting_revision ON "ScheduledAgentTask"');
    await pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(",")}`);
    await db.scheduledAgentTask.create({ data: { taskId: "watch", ownerUserId: "owner", agentId: "platform-engineer", title: "Watch",
      prompt: "Original bounded observations; file per-tick evidence.", routeContext: "/ops", schedule: "23 */6 * * *", timezone: "UTC",
      isActive: true, taskRunId: "TR-REPORT", taskConfig: { routineReporting: { version: 1, mode: "read-only-history" } } } });
    await db.scheduledJob.create({ data: { jobId: "watch", name: "Watch", schedule: "23 */6 * * *", nextRunAt: now } });
    input = await createRun("TR-REPORT");
  });
  afterAll(async () => {
    await db?.$disconnect();
    await pool?.end();
    if (admin && /^reporting_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  async function createRun(taskRunId: string) {
    const task = await db.scheduledAgentTask.update({ where: { taskId: "watch" }, data: { taskRunId } });
    const scopeDigest = scheduledReportingScopeDigest(task);
    await db.taskRun.create({ data: { taskRunId, title: "Watch", objective: "Observe", userId: "owner", threadId: "thread", contextId: "thread",
      currentAgentId: "platform-engineer", status: "working", startedAt: new Date(now.getTime() - 5000),
      a2aMetadata: { sourceRef: { kind: "scheduled-task", id: "watch" }, scheduledReporting: { mode: "read-only-history", scopeDigest } } } });
    await db.toolExecution.create({ data: { threadId: "thread", taskRunId, userId: "owner", agentId: "platform-engineer", toolName: reader.name,
      parameters: {}, result: { success: true, data: { value: 7 } }, success: true, executionMode: "immediate", createdAt: new Date(now.getTime() - 1000) } });
    return { taskId: "watch", userId: "owner", taskRunId, threadId: "thread", agentId: "platform-engineer", scopeDigest, content: report(), admittedTools: [reader], now };
  }
  const actionable = () => ({ ...input, content: report("actionable", { recommendation: "Review the observed increase." }) });
  async function expectNoDelivery() {
    expect(await db.notification.count()).toBe(0);
    expect(await db.communicationDeliveryAttempt.count()).toBe(0);
    expect(await db.taskMessage.count()).toBe(0);
    expect((await db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } })).status).toBe("working");
    expect((await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } })).taskConfig).not.toHaveProperty("routineReportingState");
  }
  it("persists the existing history and settles a routine observation without a notice", async () => {
    expect(await settleScheduledReportingRun(input, { db })).toMatchObject({ status: "completed" });
    expect(await db.taskMessage.count()).toBe(1);
    expect(await db.agentMessage.count()).toBe(1);
    expect(await db.notification.count()).toBe(0);
    expect((await db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } })).status).toBe("completed");
  });
  it("serializes concurrent settlement and replay to one actual linked owner notice", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => settleScheduledReportingRun(actionable(), { db })));
    expect(results.filter(r => !r.reused)).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: "owner" } })).toBe(1);
    expect(await db.communicationDeliveryAttempt.count({ where: { status: "sent" } })).toBe(1);
    expect(await db.taskMessage.count()).toBe(1);
  });
  it("keeps paraphrased and routine follow-ups in history until exact fresh resolution", async () => {
    await settleScheduledReportingRun(actionable(), { db });
    const task = await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } });
    const condition = (task.taskConfig as { routineReportingState: { condition: { conditionId: string } } }).routineReportingState.condition;
    const next = await createRun("TR-NEXT");
    await settleScheduledReportingRun({ ...next, content: report("actionable", { recommendation: "Same issue in different words." }) }, { db });
    const routine = await createRun("TR-ROUTINE");
    await settleScheduledReportingRun(routine, { db });
    expect(await db.notification.count()).toBe(1);
    const resolved = await createRun("TR-RESOLVED");
    await expect(settleScheduledReportingRun({ ...resolved, content: report("resolved", { conditionId: randomUUID() }) }, { db })).rejects.toThrow();
    await settleScheduledReportingRun({ ...resolved, content: report("resolved", { conditionId: condition.conditionId }) }, { db });
    expect(await db.notification.count({ where: { read: true } })).toBe(1);
    expect(await db.taskMessage.count()).toBe(4);
  });
  it.each(["failed-return", "adapter-throw", "audit-failure", "missing-id"])("rolls back actual notification, audit and marker after %s", async failure => {
    const dispatch: NonNullable<Parameters<typeof settleScheduledReportingRun>[1]>["dispatch"] = async (tx, send) => {
      if (failure === "failed-return") return { channel: "in-app", status: "failed" };
      const adapter = createInAppAdapter(tx);
      const dispatcher = createCommunicationDispatcher([failure === "adapter-throw" ? { ...adapter, send: async () => { throw new Error("test adapter failure"); } } : adapter], {
        recordDelivery: attempt => failure === "audit-failure" ? Promise.reject(new Error("test audit failure")) : recordDeliveryAttempt(attempt, tx),
      });
      const delivered = await dispatcher.send(send);
      return failure === "missing-id" ? { ...delivered, providerMessageId: undefined } : delivered;
    };
    await expect(settleScheduledReportingRun(actionable(), { db, dispatch })).rejects.toThrow();
    await expectNoDelivery();
  });
  it("reconciles an acknowledgement lost after commit without sending again", async () => {
    const uncertain = { $transaction: async (...args: unknown[]) => {
      const value = await (db.$transaction as (...args: unknown[]) => Promise<unknown>)(...args);
      throw Object.assign(new Error("test committed acknowledgement lost"), { value });
    } } as unknown as typeof db;
    await expect(settleScheduledReportingRun(actionable(), { db: uncertain })).rejects.toThrow("acknowledgement lost");
    expect(await settleScheduledReportingRun(actionable(), { db })).toMatchObject({ reused: true });
    expect(await db.notification.count()).toBe(1);
    expect(await db.communicationDeliveryAttempt.count()).toBe(1);
  });
  it.each(["input-required", "auth-required"])("parks %s with the existing recurrence in one transaction", async status => {
    const request = status === "auth-required" ? { ...input, failure: { kind: "credentials" as const, message: "Provider sign-in expired." } }
      : { ...input, content: report("needs-decision", { decisionBrief: "Choose the measured operating limit." }) };
    await settleScheduledReportingRun(request, { db });
    expect(await db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } })).toMatchObject({ status, completedAt: null });
    expect(await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } })).toMatchObject({ lastStatus: "proposed", nextRunAt: null });
    expect(await db.scheduledJob.findUniqueOrThrow({ where: { jobId: "watch" } })).toMatchObject({ schedule: "disabled", nextRunAt: null });
  });
  it("refuses stale configuration even when the stored update timestamp is unchanged", async () => {
    await db.scheduledAgentTask.update({ where: { taskId: "watch" }, data: { isActive: false, taskConfig: {} } });
    const original = await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } });
    await pool.query(`CREATE OR REPLACE FUNCTION freeze_reporting_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."updatedAt"=OLD."updatedAt"; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER freeze_reporting_revision BEFORE UPDATE ON "ScheduledAgentTask" FOR EACH ROW EXECUTE FUNCTION freeze_reporting_revision()');
    const config = { taskId: "watch", expectedRevision: scheduledReportingRevision(original), mode: "read-only-history", reason: "Owner chose history for routine observations." };
    const results = await Promise.all([configureScheduledReportingFor("owner", config, db), configureScheduledReportingFor("owner", config, db)]);
    expect(results.filter(r => r.success)).toHaveLength(1);
    expect(await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } })).toMatchObject({ prompt: original.prompt, schedule: original.schedule,
      ownerUserId: original.ownerUserId, isActive: false, updatedAt: original.updatedAt });
  });
  it("blocks a late ordinary settlement and mirror write after reporting configuration", async () => {
    const original = await db.scheduledAgentTask.findUniqueOrThrow({ where: { taskId: "watch" } });
    original.taskConfig = null;
    let wrote = false;
    expect(await withCurrentScheduledTask(db, original, input.taskRunId, async tx => {
      wrote = true;
      await tx.scheduledJob.update({ where: { jobId: "watch" }, data: { nextRunAt: now } });
      return true;
    }, true)).toBeNull();
    expect(wrote).toBe(false);
  });
  it.each(["failed", "foreign", "stale"])("does not complete from %s observation evidence", async invalid => {
    await db.toolExecution.updateMany({ data: invalid === "failed" ? { success: false } : invalid === "foreign" ? { userId: "another-owner" }
      : { createdAt: new Date(now.getTime() - 60000) } });
    await expect(settleScheduledReportingRun(input, { db })).rejects.toThrow();
    await expectNoDelivery();
  });
});
