import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
  human: vi.fn(), thread: vi.fn(), original: vi.fn(), readMessage: vi.fn(), createMessage: vi.fn(), updateMessage: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { $queryRaw: f.lock, $transaction: f.transaction,
  taskRun: { findUnique: f.load, updateMany: f.update }, user: { findUnique: f.human },
  agentThread: { findUnique: f.thread },
  agentMessage: { findFirst: f.original, findUnique: f.readMessage, create: f.createMessage, updateMany: f.updateMessage },
} }));
import { prisma } from "@dpf/db";
import { foregroundExecutionFence, withForegroundWork } from "./foreground-work-context";
import { publishForegroundMessage, readForegroundPublication } from "./foreground-work-publication";

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
    expect(row.status).toBe("input-required");
    expect(row.progressPayload.foregroundOutcome).toBe(kind);
    expect(row.progressPayload.dispatch.claimedAt).toBe("original");
    expect(row.progressPayload.foregroundPublication.messageId).toBe("answer");
    if (kind === "capacity-wait") expect(row.progressPayload.resourceWait.attempt).toBe(1);
  });

  it("keeps auxiliary notices separate from job completion", async () => {
    await withForegroundWork("TR-one", () => publishForegroundMessage(db => db.agentMessage.create({ data: {
      threadId: "thread", taskRunId: "TR-one", role: "system", content: "A routing notice",
    } })));
    expect(row.status).toBe("working");
    expect(row.progressPayload.resultMessageId).toBeUndefined();
  });
});
