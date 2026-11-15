import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
  human: vi.fn(), thread: vi.fn(), original: vi.fn(), readMessage: vi.fn(), createMessage: vi.fn(), updateMessage: vi.fn(), runs: vi.fn(), messages: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { $queryRaw: f.lock, $transaction: f.transaction,
  taskRun: { findUnique: f.load, updateMany: f.update, findMany: f.runs }, user: { findUnique: f.human },
  agentThread: { findUnique: f.thread },
  agentMessage: { findFirst: f.original, findUnique: f.readMessage, findMany: f.messages, create: f.createMessage, updateMany: f.updateMessage },
} }));
import { prisma } from "@dpf/db";
import { foregroundExecutionFence, withForegroundWork } from "./foreground-work-context";
import { publishForegroundMessage, readForegroundPublication, readSettledForegroundNotices } from "./foreground-work-publication";

describe("foreground publication transaction", () => {
  let row: any;
  let messages: Map<string, any>;
  beforeEach(() => {
    vi.clearAllMocks();
    messages = new Map();
    row = { id: "record", taskRunId: "TR-one", userId: "owner", threadId: "thread", initiatingAgentId: "coo",
      source: "coworker", status: "working", archivedAt: null,
      progressPayload: { dispatch: { claimedAt: "original" }, foregroundAttempt: 1 },
      a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64), foregroundRequest: {
        schemaVersion: 1, userMessageId: "request", deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      } },
    };
    f.load.mockImplementation(async () => structuredClone(row));
    f.human.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [] });
    f.thread.mockResolvedValue({ userId: "owner" });
    f.original.mockResolvedValue({ id: "request" });
    f.lock.mockResolvedValue([{ id: "record" }]);
    f.readMessage.mockImplementation(async ({ where }) => messages.get(where.id) ?? null);
    f.createMessage.mockImplementation(async ({ data }) => {
      const message = { ...data, id: "answer" };
      messages.set(message.id, message);
      return message;
    });
    f.update.mockImplementation(async ({ where, data }) => {
      if (where.taskRunId !== row.taskRunId || where.status !== row.status) return { count: 0 };
      Object.assign(row, structuredClone(data));
      return { count: 1 };
    });
    f.updateMessage.mockImplementation(async ({ where, data }) => {
      const message = messages.get(where.id);
      if (!message || message.role !== where.role) return { count: 0 };
      Object.assign(message, data);
      return { count: 1 };
    });
    // A controlled transaction double: rollback is observable. PostgreSQL's
    // actual row-lock behavior still requires governed database verification.
    f.transaction.mockImplementation(async write => {
      const before = structuredClone(row), saved = new Map(messages);
      try { return await write(prisma); }
      catch (error) { row = before; messages = saved; throw error; }
    });
  });
  afterEach(() => vi.useRealTimers());
  const write = () => publishForegroundMessage(db => db.agentMessage.create({ data: {
    threadId: "thread", taskRunId: "TR-one", role: "assistant", content: "Accepted response",
  } }), { kind: "responded" });

  const waitNotice = { id: "wait", threadId: "thread", taskRunId: "TR-one", role: "system",
    content: "Your request is retained. DPF will retry when provider capacity permits, within its original recovery window. You do not need to resend.\n\nJob: TR-one" };
  async function settledNotices() {
    f.runs.mockImplementation(async () => [structuredClone(row)]);
    f.messages.mockImplementation(async () => [...messages.values()]);
    return readSettledForegroundNotices("thread", [waitNotice, ...messages.values()]);
  }
  it("projects a same-request earlier wait as history using batched saved completion proof without writes", async () => {
    await withForegroundWork("TR-one", write);
    f.update.mockClear(); f.createMessage.mockClear(); f.updateMessage.mockClear();
    expect(await settledNotices()).toEqual(new Set(["wait"]));
    expect(f.runs).toHaveBeenCalledTimes(1);
    expect(f.messages).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled(); expect(f.createMessage).not.toHaveBeenCalled(); expect(f.updateMessage).not.toHaveBeenCalled();
    expect(waitNotice.content).toContain("DPF will retry");
  });
  it.each(["submitted", "working", "input-required", "canceled", "failed"])("does not settle %s work from a later answer", async status => {
    await withForegroundWork("TR-one", write); row.status = status;
    expect(await settledNotices()).toEqual(new Set());
  });
  it.each(["publication", "fence", "digest", "deadline", "result", "result-role", "result-thread", "result-task", "owner", "human", "archived"])("preserves pending wording when %s completion proof is missing or mismatched", async change => {
    await withForegroundWork("TR-one", write);
    if (change === "publication") delete row.progressPayload.foregroundPublication;
    if (change === "fence") row.progressPayload.dispatch.claimedAt = "replacement";
    if (change === "digest") row.a2aMetadata.requestDigest = "b".repeat(64);
    if (change === "deadline") row.a2aMetadata.foregroundRequest.deadlineAt = "2000-01-01T00:00:00Z";
    if (change === "result") row.progressPayload.resultMessageId = "other";
    if (change === "result-role") messages.get("answer").role = "system";
    if (change === "result-thread") messages.get("answer").threadId = "other";
    if (change === "result-task") messages.get("answer").taskRunId = "TR-other";
    if (change === "owner") row.userId = "other";
    if (change === "human") f.human.mockResolvedValue({ isActive: false, groups: [], isSuperuser: false });
    if (change === "archived") row.archivedAt = new Date();
    expect(await settledNotices()).toEqual(new Set());
  });
  it("does not relabel approval text, unbound notices or another unresolved request", async () => {
    await withForegroundWork("TR-one", write);
    f.runs.mockResolvedValue([row]); f.messages.mockResolvedValue([...messages.values()]);
    const notices = [waitNotice, { ...waitNotice, id: "approval", content: "Waiting for your approval." },
      { ...waitNotice, id: "unbound", taskRunId: null }, { ...waitNotice, id: "old", taskRunId: "TR-unknown" }];
    expect(await readSettledForegroundNotices("thread", [...notices, ...messages.values()])).toEqual(new Set(["wait"]));
  });
  it("uses the canonical result binding when loading an earlier history page, without claiming its position", async () => {
    await withForegroundWork("TR-one", write);
    f.runs.mockResolvedValue([row]); f.messages.mockResolvedValue([...messages.values()]);
    expect(await readSettledForegroundNotices("thread", [waitNotice])).toEqual(new Set(["wait"]));
  });
  it("batches repeated wait history without per-notice task or message reads", async () => {
    await withForegroundWork("TR-one", write);
    f.runs.mockResolvedValue([row]); f.messages.mockResolvedValue([...messages.values()]);
    const waits = Array.from({ length: 50 }, (_, i) => ({ ...waitNotice, id: `wait-${i}` }));
    const result = await readSettledForegroundNotices("thread", waits);
    expect(result.size).toBe(50); expect(f.runs).toHaveBeenCalledTimes(1); expect(f.messages).toHaveBeenCalledTimes(1);
    expect(f.runs).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      threadId: "thread", userId: "owner", taskRunId: { in: ["TR-one"] } }) }));
  });

  it("accepts one message with its canonical result linkage and retained execution identity", async () => {
    await withForegroundWork("TR-one", async () => {
      const fence = foregroundExecutionFence();
      await write();
      expect(row.status).toBe("completed");
      expect(row.progressPayload.dispatch.claimedAt).toBe("original");
      expect(row.progressPayload.resultMessageId).toBe("answer");
      expect(await readForegroundPublication("TR-one", fence)).toEqual({ kind: "responded", agentMessageId: "answer" });
      row.status = "canceled"; // A later cancellation never revives the accepted job.
      expect(await readForegroundPublication("TR-one", fence)).toBeNull();
      expect(messages.has("answer")).toBe(true);
    });
  });

  it.each(["cancel", "generation", "digest", "archived", "thread-owner", "human-revoked", "deadline-changed"])("rejects %s before creating any response", async change => {
    await withForegroundWork("TR-one", async () => {
      if (change === "cancel") row.status = "canceled";
      if (change === "generation") row.progressPayload.dispatch.claimedAt = "replacement";
      if (change === "digest") row.a2aMetadata.requestDigest = "b".repeat(64);
      if (change === "archived") row.archivedAt = new Date();
      if (change === "thread-owner") f.thread.mockResolvedValue({ userId: "other" });
      if (change === "human-revoked") f.human.mockResolvedValue({ isActive: false, groups: [], isSuperuser: false });
      if (change === "deadline-changed") row.a2aMetadata.foregroundRequest.deadlineAt = new Date(Date.now() + 120_000).toISOString();
      await expect(write()).rejects.toThrow("no longer admissible");
      expect(f.createMessage).not.toHaveBeenCalled();
    });
  });

  it("checks the original deadline after waiting for the row lock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withForegroundWork("TR-one", async () => {
      f.lock.mockImplementation(async () => {
        vi.setSystemTime(Date.parse(row.a2aMetadata.foregroundRequest.deadlineAt) + 1);
        return [{ id: "record" }];
      });
      await expect(write()).rejects.toThrow("no longer admissible");
      expect(f.createMessage).not.toHaveBeenCalled();
    });
  });

  it("rolls back message and completion together if the guarded write crosses the deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withForegroundWork("TR-one", async () => {
      f.createMessage.mockImplementationOnce(async ({ data }) => {
        messages.set("answer", { ...data, id: "answer" });
        vi.setSystemTime(Date.parse(row.a2aMetadata.foregroundRequest.deadlineAt) + 1);
        return messages.get("answer");
      });
      await expect(write()).rejects.toThrow("no longer admissible");
      expect(messages.size).toBe(0);
      expect(row.status).toBe("working");
      expect(row.progressPayload.resultMessageId).toBeUndefined();
    });
  });

  it.each(["approval-required", "capacity-wait"] as const)("retains %s without inventing completion or changing the generation", async kind => {
    await withForegroundWork("TR-one", () => publishForegroundMessage(db => db.agentMessage.create({ data: {
      threadId: "thread", taskRunId: "TR-one", role: kind === "capacity-wait" ? "system" : "assistant", content: "Pending",
    } }), { kind, ...(kind === "capacity-wait" ? { resourceWait: "capacity" as const } : {}) }));
    expect(row.status).toBe(kind === "capacity-wait" ? "submitted" : "input-required");
    expect(row.progressPayload.foregroundOutcome).toBe(kind);
    expect(row.progressPayload.dispatch.claimedAt).toBe("original");
    expect(row.progressPayload.foregroundPublication.messageId).toBe("answer");
    if (kind === "capacity-wait") expect(row.progressPayload.resourceWait.attempt).toBe(1);
  });
  it("reads an acknowledged capacity publication in new and legacy wait states", async () => {
    let fence: ReturnType<typeof foregroundExecutionFence>;
    await withForegroundWork("TR-one", async () => {
      fence = foregroundExecutionFence();
      await publishForegroundMessage(db => db.agentMessage.create({ data: {
        threadId: "thread", taskRunId: "TR-one", role: "system", content: "Capacity wait",
      } }), { kind: "capacity-wait", resourceWait: "busy" });
    });
    for (const status of ["submitted", "input-required"]) {
      row.status = status;
      expect(await readForegroundPublication("TR-one", fence!)).toMatchObject({ kind: "capacity-wait", agentMessageId: "answer" });
    }
    row.progressPayload.resourceWait = { kind: "provider-capacity" };
    expect(await readForegroundPublication("TR-one", fence!)).toBeNull();
  });

  it("keeps auxiliary notices separate from job completion", async () => {
    await withForegroundWork("TR-one", () => publishForegroundMessage(db => db.agentMessage.create({ data: {
      threadId: "thread", taskRunId: "TR-one", role: "system", content: "A routing notice",
    } })));
    expect(row.status).toBe("working");
    expect(row.progressPayload.resultMessageId).toBeUndefined();
  });
});
