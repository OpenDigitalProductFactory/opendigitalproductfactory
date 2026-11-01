import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";

const ports = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { requestCancel: vi.fn() } }));
vi.mock("@dpf/db", async () => ({
  ...await import("../../../../packages/db/generated/client/client"),
  prisma: new Proxy({}, { get(_target, key) {
    if (!ports.db) throw new Error("Foreground PostgreSQL fixture is not ready.");
    const value = ports.db[key as string];
    return typeof value === "function" ? value.bind(ports.db) : value;
  } }),
}));
// Authority is a controlled observation; all locks, messages, task settlement
// and rollback use actual PostgreSQL in an isolated synthetic schema.
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({ userId: "fixture-owner", platformRole: "employee", isSuperuser: false }) }));
import { withForegroundWork } from "./foreground-work-context";
import { publishForegroundMessage } from "./foreground-work-publication";
import { stopThreadTurn } from "@/lib/tak/thread-cancellation";
import { TERMINAL_TASK_STATE_LIST } from "@/lib/tak/task-states";

// No DATABASE_URL fallback and no install, real user, provider or business data.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_foreground_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "AgentThread", "AgentMessage"];

describe.skipIf(!url)("foreground publication on PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  let deadlineAt: string;
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: url!, schema, tables });
    ports.db = fixture.db as unknown as Record<string, unknown>;
  });
  afterAll(async () => { await fixture?.close(); });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    await fixture.pool.query('TRUNCATE "TaskRun", "AgentThread", "AgentMessage"');
    deadlineAt = new Date(Date.now() + 60_000).toISOString();
    await fixture.db.agentThread.create({ data: { id: "fixture-thread", userId: "fixture-owner" } });
    await fixture.db.taskRun.create({ data: {
      taskRunId: "TR-FG-SQL", userId: "fixture-owner", threadId: "fixture-thread", initiatingAgentId: "coo",
      routeContext: "/workspace", source: "coworker", title: "Synthetic foreground publication", objective: "Verify row-lock ordering only", status: "working",
      progressPayload: { dispatch: { claimedAt: "fixture-generation" }, foregroundAttempt: 1 },
      a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64), foregroundRequest: { schemaVersion: 1, userMessageId: "fixture-request", deadlineAt } },
    } });
    await fixture.db.agentMessage.create({ data: { id: "fixture-request", threadId: "fixture-thread", taskRunId: "TR-FG-SQL", role: "user", content: "Synthetic fixture" } });
  });

  const publish = () => withForegroundWork("TR-FG-SQL", () => publishForegroundMessage(db => db.agentMessage.create({ data: {
    id: "fixture-response", threadId: "fixture-thread", taskRunId: "TR-FG-SQL", role: "assistant", content: "Synthetic accepted response",
  } }), { kind: "responded" }));
  const waitForLock = () => vi.waitFor(async () => {
    const result = await fixture.pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = $2', [schema, "Lock"]);
    expect(result.rows[0].n).toBeGreaterThan(0);
  }, { timeout: 1500, interval: 10 });

  it("rejects publication when cancellation holds the row first", async () => {
    const cancel = await fixture.pool.connect();
    await cancel.query("BEGIN");
    try {
      await cancel.query(`UPDATE "TaskRun" SET status = $1 WHERE "taskRunId" = $2 AND "userId" = $3 AND "threadId" = $4
        AND source = 'coworker' AND NOT (status = ANY($5::text[])) AND "a2aMetadata" #>> '{foregroundRequest,schemaVersion}' = '1'`,
      ["canceled", "TR-FG-SQL", "fixture-owner", "fixture-thread", [...TERMINAL_TASK_STATE_LIST]]);
      const pending = publish();
      const rejected = expect(pending).rejects.toThrow("no longer admissible");
      await waitForLock();
      await cancel.query("COMMIT");
      await rejected;
      expect(await fixture.db.agentMessage.count({ where: { role: "assistant" } })).toBe(0);
      expect((await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: "TR-FG-SQL" } })).status).toBe("canceled");
    } finally { await cancel.query("ROLLBACK"); cancel.release(); }
  });

  it("preserves a response accepted before cancellation acquires the row", async () => {
    let entered!: () => void, release!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const pending = withForegroundWork("TR-FG-SQL", () => publishForegroundMessage(async db => {
      const message = await db.agentMessage.create({ data: { id: "fixture-response", threadId: "fixture-thread", taskRunId: "TR-FG-SQL", role: "assistant", content: "Accepted before cancellation" } });
      entered();
      await proceed;
      return message;
    }, { kind: "responded" }));
    await writing;
    const cancel = stopThreadTurn("fixture-thread", "fixture-owner");
    try { await waitForLock(); }
    finally { release(); }
    await pending;
    await cancel;
    const run = await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: "TR-FG-SQL" } });
    expect(run.status).toBe("completed"); // Production Stop never overwrites a terminal task.
    expect(run.progressPayload).toMatchObject({ resultMessageId: "fixture-response", foregroundPublication: { messageId: "fixture-response" } });
    expect(await fixture.db.agentMessage.count({ where: { role: "assistant" } })).toBe(1);
  });

  it("checks deadline expiry after an actual PostgreSQL lock wait", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const lock = await fixture.pool.connect();
    await lock.query("BEGIN");
    try {
      await lock.query('SELECT id FROM "TaskRun" WHERE "taskRunId" = $1 FOR UPDATE', ["TR-FG-SQL"]);
      const pending = publish();
      const rejected = expect(pending).rejects.toThrow("no longer admissible");
      await waitForLock();
      vi.setSystemTime(Date.parse(deadlineAt) + 1);
      await lock.query("COMMIT");
      await rejected;
      expect(await fixture.db.agentMessage.count({ where: { role: "assistant" } })).toBe(0);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });

  it("rolls back the message if publication fails before settlement", async () => {
    await expect(withForegroundWork("TR-FG-SQL", () => publishForegroundMessage(async db => {
      await db.agentMessage.create({ data: { id: "fixture-response", threadId: "fixture-thread", taskRunId: "TR-FG-SQL", role: "assistant", content: "Never accepted" } });
      throw new Error("Controlled write failure before settlement");
    }, { kind: "responded" }))).rejects.toThrow("Controlled write failure");
    expect(await fixture.db.agentMessage.count({ where: { role: "assistant" } })).toBe(0);
    expect((await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: "TR-FG-SQL" } })).status).toBe("working");
  });
});
