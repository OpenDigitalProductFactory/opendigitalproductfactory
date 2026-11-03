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
import { retainUnverifiedEvidenceDraft } from "./evidence-recovery-artifact";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";

const candidate = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const leased = process.env.DPF_NONPROD_LEASE_ID && candidate && ["localhost", "127.0.0.1"].includes(candidate.hostname)
  && /^\/dpf_local_ci_\d+$/.test(candidate.pathname) ? process.env.DATABASE_URL : undefined;
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `unverified_draft_${randomUUID().replaceAll("-", "")}`;
const digest = "a".repeat(64);
const input = { taskRunId: "TR-synthetic-current", userId: "synthetic-owner", agentId: "coo", threadId: "synthetic-thread",
  withheldContent: "Synthetic unverified draft, never a factual answer.", taskExecutionFence: captureTaskExecutionFence(null, digest)! };

describe.skipIf(!url)("unverified draft retention on isolated governed PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=20000`, max: 5 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) }); state.db = db;
    for (const table of ["TaskRun", "TaskArtifact"]) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "TaskArtifact", "TaskRun"');
    await db.taskRun.create({ data: { taskRunId: input.taskRunId, userId: input.userId,
      currentAgentId: input.agentId, threadId: input.threadId, status: "working",
      title: "Synthetic retention fixture", objective: "Test isolated diagnostic retention", a2aMetadata: { requestDigest: digest } } });
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  it("persists the exact unverified draft with a safe summary and deduplicates an identical capture", async () => {
    const first = await retainUnverifiedEvidenceDraft(input);
    const second = await retainUnverifiedEvidenceDraft(input);
    expect(first).toMatchObject({ state: "stored" }); expect(second).toEqual(first);
    const artifacts = await db.taskArtifact.findMany();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.metadata).toMatchObject({ state: "unverified", usableAsEvidence: false });
    expect(JSON.stringify(artifacts[0]!.parts)).toContain(input.withheldContent);
    expect(artifacts[0]!.description).not.toContain(input.withheldContent);
  });
  it.each([{ status: "canceled" }, { progressPayload: { resumeReservedAt: "another-generation" } }, { userId: "other-owner" }])(
    "retains nothing after a real task authority/generation change (%j)", async patch => {
      await db.taskRun.update({ where: { taskRunId: input.taskRunId }, data: patch });
      expect(await retainUnverifiedEvidenceDraft(input)).toEqual({ state: "unavailable", reason: "task-binding-mismatch" });
      expect(await db.taskArtifact.count()).toBe(0);
    },
  );
  it("rolls back a genuine artifact write failure without claiming retention", async () => {
    await pool.query(`CREATE FUNCTION "${schema}".reject_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic artifact failure'; END $$`);
    await pool.query('CREATE TRIGGER reject_draft BEFORE INSERT ON "TaskArtifact" FOR EACH ROW EXECUTE FUNCTION reject_draft()');
    try {
      expect(await retainUnverifiedEvidenceDraft(input)).toEqual({ state: "unavailable", reason: "write-failed" });
      expect(await db.taskArtifact.count()).toBe(0);
      expect((await db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } })).status).toBe("working");
    } finally { await pool.query('DROP TRIGGER reject_draft ON "TaskArtifact"'); await pool.query('DROP FUNCTION reject_draft()'); }
  });
  it("holds the current task row lock through artifact commit before cancellation can advance it", async () => {
    const key = Math.floor(Math.random() * 1_000_000_000) + 1;
    const blocker = await pool.connect(), cancel = await pool.connect();
    const { rows: [{ pid: cancelPid }] } = await cancel.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('SELECT pg_advisory_lock($1)', [key]);
    await pool.query(`CREATE FUNCTION "${schema}".wait_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER wait_draft BEFORE INSERT ON "TaskArtifact" FOR EACH ROW EXECUTE FUNCTION wait_draft()');
    const retention = retainUnverifiedEvidenceDraft(input);
    let cancellation: Promise<unknown> | undefined;
    try {
      let writerPid = 0;
      await vi.waitFor(async () => {
        const { rows } = await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted", [key]);
        expect(rows).toHaveLength(1); writerPid = rows[0].pid;
      }, { timeout: 5000, interval: 25 });
      cancellation = cancel.query('UPDATE "TaskRun" SET status=$1 WHERE "taskRunId"=$2', ["canceled", input.taskRunId]);
      await vi.waitFor(async () => {
        const { rows } = await pool.query('SELECT pg_blocking_pids($1) AS blockers', [cancelPid]);
        expect(rows[0].blockers).toContain(writerPid);
      }, { timeout: 5000, interval: 25 });
      await blocker.query('SELECT pg_advisory_unlock($1)', [key]);
      expect(await retention).toMatchObject({ state: "stored" }); await cancellation;
      expect((await db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } })).status).toBe("canceled");
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [key]);
      await Promise.allSettled([retention, ...(cancellation ? [cancellation] : [])]);
      blocker.release(); cancel.release();
      await pool.query('DROP TRIGGER wait_draft ON "TaskArtifact"'); await pool.query('DROP FUNCTION wait_draft()');
    }
  }, 30000);
});
