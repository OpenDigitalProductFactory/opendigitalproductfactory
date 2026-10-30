import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adapter integration only: real worker + real execution context/fences.
// Persistence and the coworker turn are controlled doubles, not PostgreSQL or
// Finance tool execution. This cannot prove recovery of the unbound owner job.
const fixture = vi.hoisted(() => ({
  load: vi.fn(), update: vi.fn(), list: vi.fn(), findMessage: vi.fn(),
  upsertMessage: vi.fn(), patchMessage: vi.fn(), thread: vi.fn(), human: vi.fn(),
  session: vi.fn(), turn: vi.fn(), wake: vi.fn(), emit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {
  taskRun: { findUnique: fixture.load, updateMany: fixture.update, findMany: fixture.list },
  agentThread: { findUnique: fixture.thread },
  agentMessage: { findFirst: fixture.findMessage, upsert: fixture.upsertMessage, updateMany: fixture.patchMessage },
} }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: fixture.human }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireUser: fixture.session }));
vi.mock("@/lib/actions/agent-coworker", () => ({ sendMessage: fixture.turn }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: fixture.wake } }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: {
  clearCancel: vi.fn(), markActive: vi.fn(), markIdle: vi.fn(), emit: fixture.emit,
} }));

import { foregroundRequestDigest } from "./foreground-request-digest";
import { assertForegroundAgent, requireForegroundUser } from "./foreground-work-context";
import { executeForegroundWork, reconcileForegroundWork } from "./foreground-work-worker";

const route = "/finance/expense-claims";
const taskRunId = "TR-finance-controlled-fixture";
const request = "Show the expense-entry path and required receipt information. Do not create an expense or move money.";
const resultContent = "Controlled fixture guidance only; no actual Finance result is claimed.";
type Message = { id: string; threadId: string; taskRunId: string; role: string; content: string; routeContext?: string };

describe("Finance retained-request adapter integration", () => {
  let row: any;
  let messages: Map<string, Message>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    messages = new Map([["finance-request", { id: "finance-request", threadId: "finance-thread", taskRunId, role: "user", content: request }]]);
    const deadlineAt = new Date(Date.now() + 3_600_000).toISOString();
    row = { id: "fixture-run", taskRunId, userId: "fixture-owner", initiatingAgentId: "fixture-finance",
      threadId: "finance-thread", routeContext: route, source: "coworker", status: "submitted",
      updatedAt: new Date(), progressPayload: null,
      a2aMetadata: { trigger: "interactive", foregroundRequest: {
        schemaVersion: 1, userMessageId: "finance-request", coworkerMode: "advise", deadlineAt,
      }, requestDigest: foregroundRequestDigest({ userId: "fixture-owner", agentId: "fixture-finance",
        threadId: "finance-thread", userMessageId: "finance-request", routeContext: route,
        content: request, coworkerMode: "advise", extras: {}, deadlineAt }) },
    };
    fixture.load.mockImplementation(async () => structuredClone(row));
    fixture.update.mockImplementation(async ({ where, data }) => {
      if (where.id !== row.id || where.status !== row.status
        || (where.updatedAt && +where.updatedAt !== +row.updatedAt)
        || (where.progressPayload && where.progressPayload.equals !== row.progressPayload?.dispatch?.claimedAt)) return { count: 0 };
      row = { ...row, ...structuredClone(data), updatedAt: new Date(+row.updatedAt + 1) };
      return { count: 1 };
    });
    fixture.findMessage.mockImplementation(async ({ where }) => {
      const message = messages.get(where.id);
      return message && message.threadId === where.threadId && message.taskRunId === where.taskRunId
        && message.role === where.role ? structuredClone(message) : null;
    });
    fixture.upsertMessage.mockImplementation(async ({ create, update }) => {
      messages.set(create.id, { ...(messages.get(create.id) ?? create), ...update });
    });
    fixture.patchMessage.mockImplementation(async ({ where, data }) => {
      const message = messages.get(where.id);
      if (!message || message.threadId !== where.threadId || message.taskRunId !== where.taskRunId || message.role !== where.role) return { count: 0 };
      messages.set(message.id, { ...message, ...data });
      return { count: 1 };
    });
    fixture.thread.mockResolvedValue({ userId: "fixture-owner" });
    fixture.human.mockResolvedValue({ platformRole: "employee", isSuperuser: false });
    fixture.session.mockRejectedValue(new Error("No browser session exists in this queue fixture"));
    fixture.list.mockImplementation(async ({ where }) => where.OR && row.status === "input-required"
      && row.progressPayload?.resourceWait ? [structuredClone(row)] : []);
    fixture.turn.mockImplementation(async (input) => {
      expect(await requireForegroundUser()).toMatchObject({ id: "fixture-owner", isSuperuser: false });
      assertForegroundAgent("fixture-finance");
      expect(input).toMatchObject({ threadId: "finance-thread", routeContext: route,
        content: request, acceptedUserMessageId: "finance-request", coworkerMode: "advise" });
      const answer = { id: "fixture-answer", threadId: input.threadId, taskRunId, role: "assistant", content: resultContent };
      messages.set(answer.id, answer);
      return { agentMessage: answer };
    });
  });
  afterEach(() => vi.useRealTimers());

  const assistantResults = () => [...messages.values()].filter(message => message.role === "assistant");
  const due = () => vi.setSystemTime(Date.parse(row.progressPayload.resourceWait.nextAttemptAt) + 1);

  async function parkBeforeInference() {
    fixture.turn.mockImplementationOnce(async () => {
      await requireForegroundUser();
      assertForegroundAgent("fixture-finance");
      const wait = { id: "fixture-capacity-wait", threadId: "finance-thread", taskRunId, role: "system", content: "Fixture provider busy before inference" };
      messages.set(wait.id, wait);
      return { agentMessage: wait, resourceWait: "capacity" };
    });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "capacity-wait" });
  }

  it("resumes one controlled Finance request and reads one linked fixture result after duplicate wakes", async () => {
    const digest = row.a2aMetadata.requestDigest;
    const deadline = row.a2aMetadata.foregroundRequest.deadlineAt;
    await parkBeforeInference();
    await executeForegroundWork(taskRunId);
    expect(fixture.turn).toHaveBeenCalledTimes(1);
    expect(messages.get("fixture-capacity-wait")?.content).toContain("You do not need to resend");
    due();
    await reconcileForegroundWork();
    expect(fixture.wake).toHaveBeenCalledWith({ name: "agent/foreground-work.run", data: { taskRunId } });
    await Promise.all([executeForegroundWork(taskRunId), executeForegroundWork(taskRunId)]);
    await executeForegroundWork(taskRunId);
    expect(fixture.turn).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ taskRunId, status: "completed", routeContext: route });
    expect(row.a2aMetadata.requestDigest).toBe(digest);
    expect(row.a2aMetadata.foregroundRequest.deadlineAt).toBe(deadline);
    expect(messages.get(row.progressPayload.resultMessageId)).toMatchObject({ taskRunId, threadId: "finance-thread", content: resultContent });
    expect(assistantResults()).toHaveLength(1);
    expect([...messages.values()].filter(message => message.role === "user")).toHaveLength(1);
    expect(fixture.session).not.toHaveBeenCalled();
  });

  it("retains a possibly saved Finance result without replaying an uncertain turn", async () => {
    fixture.turn.mockImplementationOnce(async () => {
      await requireForegroundUser();
      assertForegroundAgent("fixture-finance");
      messages.set("uncertain-result", { id: "uncertain-result", threadId: "finance-thread", taskRunId, role: "assistant", content: resultContent });
      throw new Error("Fixture transport lost after possible saved output");
    });
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "execution-uncertain" });
    await reconcileForegroundWork();
    await executeForegroundWork(taskRunId);
    expect(row.status).toBe("input-required");
    expect(row.progressPayload.executionUncertainty.settlement).toBe("unknown");
    expect(assistantResults()).toHaveLength(1);
    expect(fixture.turn).toHaveBeenCalledTimes(1);
    expect(fixture.wake).not.toHaveBeenCalled();
  });

  it("rechecks Finance authority after capacity returns before invoking another turn", async () => {
    await parkBeforeInference();
    due();
    fixture.human.mockResolvedValue(null);
    expect(await executeForegroundWork(taskRunId)).toEqual({ kind: "blocked" });
    expect(fixture.turn).toHaveBeenCalledTimes(1);
    expect(assistantResults()).toHaveLength(0);
    expect(row.status).toBe("input-required");
    expect(row.progressPayload.executionUncertainty).toBeUndefined();
  });
});
