import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";

// Early P4 boundary coverage only. Real worker, persistence, publication and
// current membership; the coworker turn, wake transport and events are doubles.
// This does not qualify portal authentication, queue delivery or Finance tools.
const ports = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown>, turn: vi.fn(), wake: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", async () => ({
  ...await import("../../../../packages/db/generated/client/client"),
  prisma: new Proxy({}, { get(_target, key) {
    if (!ports.db) throw new Error("Finance PostgreSQL fixture is not ready.");
    const value = ports.db[key as string];
    return typeof value === "function" ? value.bind(ports.db) : value;
  } }),
}));
vi.mock("@/lib/actions/agent-coworker", () => ({ sendMessage: ports.turn }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: ports.wake } }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: {
  clearCancel: vi.fn(), markActive: vi.fn(), markIdle: vi.fn(), emit: vi.fn(),
} }));
import { foregroundRequestDigest } from "./foreground-request-digest";
import { assertForegroundAgent, requireForegroundUser } from "./foreground-work-context";
import { publishForegroundMessage } from "./foreground-work-publication";
import { executeForegroundWork, reconcileForegroundWork } from "./foreground-work-worker";

// Never fall back to an install DATABASE_URL. Only an explicitly governed SQL
// test URL enables this suite; the helper clones definitions, never user rows.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_finance_${randomUUID().replaceAll("-", "")}`;
const taskRunId = "TR-FINANCE-PG";
const threadId = "finance-pg-thread", userId = "finance-pg-owner", agentId = "finance-pg-specialist";
const routeContext = "/finance/spend";
const content = "Show the native expense entry path and required receipt information. Do not create an expense or move money.";
const answer = "Synthetic guidance for the worker fixture; no real Finance advice or result is claimed.";
const tables = ["TaskRun", "AgentThread", "AgentMessage", "User", "UserGroup", "PlatformRole"];

describe.skipIf(!url)("retained Finance worker with PostgreSQL and current membership", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: url!, schema, tables });
    ports.db = fixture.db as unknown as Record<string, unknown>;
  });
  afterAll(async () => { await fixture?.close(); });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    vi.clearAllMocks();
    ports.db = fixture.db as unknown as Record<string, unknown>;
    vi.useFakeTimers({ toFake: ["Date"] });
    await fixture.pool.query('TRUNCATE "TaskRun", "AgentThread", "AgentMessage", "User", "UserGroup", "PlatformRole"');
    await fixture.db.user.create({ data: { id: userId, email: "finance-worker@dpf.test", passwordHash: "not-a-login-hash", isSuperuser: false } });
    await fixture.db.platformRole.create({ data: { id: "fixture-role", roleId: "employee", name: "Fixture employee" } });
    await fixture.db.userGroup.create({ data: { userId, platformRoleId: "fixture-role" } });
    await fixture.db.agentThread.create({ data: { id: threadId, userId } });
    const deadlineAt = new Date(Date.now() + 3_600_000).toISOString();
    const request = { userId, agentId, threadId, userMessageId: "finance-pg-request", routeContext, content, coworkerMode: "advise" as const, extras: {}, deadlineAt };
    await fixture.db.taskRun.create({ data: {
      taskRunId, threadId, userId, initiatingAgentId: agentId, routeContext, source: "coworker", status: "submitted",
      title: "Synthetic retained Finance fixture", objective: content,
      a2aMetadata: { trigger: "interactive", requestDigest: foregroundRequestDigest(request), foregroundRequest: {
        schemaVersion: 1, userMessageId: request.userMessageId, coworkerMode: "advise", extras: {}, deadlineAt,
      } },
    } });
    await fixture.db.agentMessage.create({ data: { id: "finance-pg-request", threadId, taskRunId, role: "user", content } });
    ports.wake.mockResolvedValue({ ids: ["fixture-wake"] });
    ports.turn.mockImplementation(async () => {
      expect(await requireForegroundUser()).toEqual({ id: userId, platformRole: "employee", isSuperuser: false });
      assertForegroundAgent(agentId);
      return { agentMessage: await publishForegroundMessage(db => db.agentMessage.create({ data: {
        threadId, taskRunId, role: "assistant", content: answer,
      } }), { kind: "responded" }) };
    });
  });
  const run = () => fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId } });
  async function park() {
    ports.turn.mockImplementationOnce(async () => ({ agentMessage: await publishForegroundMessage(db => db.agentMessage.create({ data: {
      threadId, taskRunId, role: "system", content: "Synthetic pre-inference capacity refusal",
    } }), { kind: "capacity-wait", resourceWait: "capacity" }), resourceWait: "capacity" }));
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "capacity-wait" });
    const saved = await run();
    const progress = saved.progressPayload as { resourceWait: { nextAttemptAt: string } };
    vi.setSystemTime(Date.parse(progress.resourceWait.nextAttemptAt) + 1);
    return saved;
  }

  it("retains the original request across a capacity wait and duplicate deliveries, then reloads one stored result", async () => {
    const original = await run();
    await park();
    await reconcileForegroundWork();
    expect(ports.wake).toHaveBeenCalledWith({ name: "agent/foreground-work.run", data: { taskRunId } });
    // Both deliveries must observe the SAME pending row before either can
    // claim it. Only scheduling is controlled; reads/conditional writes remain
    // real Prisma/PostgreSQL operations, including the losing update count.
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const taskRuns = new Proxy(fixture.db.taskRun, { get(target, key) {
      if (key === "findUnique") return async (args: { where: { taskRunId?: string }; select?: unknown }) => {
        const row = await target.findUnique(args as never);
        if (!args.select && args.where.taskRunId === taskRunId && reads < 2) {
          if (++reads === 2) release();
          await bothRead;
        }
        return row;
      };
      const value = target[key as keyof typeof target];
      return typeof value === "function" ? value.bind(target) : value;
    } });
    ports.db = new Proxy(fixture.db, { get(target, key) {
      if (key === "taskRun") return taskRuns;
      const value = target[key as keyof typeof target];
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as Record<string, unknown>;
    const deliveries = [executeForegroundWork(taskRunId), executeForegroundWork(taskRunId)];
    try { await Promise.all(deliveries); }
    finally {
      release();
      await Promise.allSettled(deliveries);
      ports.db = fixture.db as unknown as Record<string, unknown>;
    }
    expect(reads).toBe(2);
    await executeForegroundWork(taskRunId);
    const saved = await run();
    expect(saved).toMatchObject({ status: "completed", userId, threadId, routeContext, a2aMetadata: original.a2aMetadata });
    expect(ports.turn).toHaveBeenCalledTimes(2); // One busy turn, one successful turn.
    const progress = saved.progressPayload as { resultMessageId: string };
    expect(await fixture.db.agentMessage.findUniqueOrThrow({ where: { id: progress.resultMessageId } })).toMatchObject({ taskRunId, threadId, role: "assistant", content: answer });
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "assistant" } })).toBe(1);
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "user" } })).toBe(1);
  }, 15_000);

  it("rechecks the actual user's active membership before resuming", async () => {
    await park();
    await fixture.db.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "blocked" });
    expect(ports.turn).toHaveBeenCalledOnce();
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "assistant" } })).toBe(0);
  });

  it("refuses a retained job whose thread owner changed while capacity was unavailable", async () => {
    await park();
    await fixture.db.agentThread.update({ where: { id: threadId }, data: { userId: "different-fixture-owner" } });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "blocked" });
    expect(ports.turn).toHaveBeenCalledOnce();
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "assistant" } })).toBe(0);
  });

  it("reconciles a committed publication after acknowledgement loss without executing another turn", async () => {
    const turn = ports.turn.getMockImplementation()!;
    ports.turn.mockImplementationOnce(async () => { await turn(); throw new Error("Synthetic acknowledgement loss"); });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "responded" });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "responded" });
    expect((await run()).status).toBe("completed");
    expect(ports.turn).toHaveBeenCalledOnce();
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "assistant", content: answer } })).toBe(1);
  });

  it("blocks changed request content rather than replaying under its old digest", async () => {
    await fixture.db.agentMessage.update({ where: { id: "finance-pg-request" }, data: { content: "Changed fixture instruction" } });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "blocked" });
    expect(ports.turn).not.toHaveBeenCalled();
    expect(await fixture.db.agentMessage.count({ where: { taskRunId, role: "assistant" } })).toBe(0);
  });
});
