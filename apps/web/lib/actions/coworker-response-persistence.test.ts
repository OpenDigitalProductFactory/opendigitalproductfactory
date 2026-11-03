import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistCoworkerResponse } from "./coworker-response-persistence";
import { createResponseProducer, responseContentDigest } from "../routing/response-producer";
const db = { agentThread: { findUnique: vi.fn() }, agentMessage: { create: vi.fn() }, taskRun: { findUnique: vi.fn(), findMany: vi.fn() }, workroom: { findMany: vi.fn() } };
const content = "A complete and useful answer for this task.";
const producer = createResponseProducer({ attemptId: "actual-attempt", providerId: "openai", modelId: "actual", content });
const input = () => ({ data: { id: "assistant-id", threadId: "thread", role: "assistant", content, agentId: "architect", providerId: "openai", modelId: "actual", taskRunId: null as string | null },
  responseProducer: producer, scope: { userId: "owner", threadId: "thread", taskRunId: null as string | null, requestedWorkroomId: null as string | null, serverContextResolved: true } });
beforeEach(() => {
  vi.resetAllMocks();db.agentThread.findUnique.mockResolvedValue({ userId: "owner", contextKey: "coworker:/platform/ai/operations-map" });db.taskRun.findMany.mockResolvedValue([]);db.workroom.findMany.mockResolvedValue([]);
  db.agentMessage.create.mockImplementation(async args => ({ ...args.data, createdAt: new Date(), routeContext: null }));
});
describe("saved response binding", () => {
  it("recognizes intentionally unroomed ordinary routes without a platform envelope", async () => {
    const request = input();request.scope.serverContextResolved = false;
    db.agentThread.findUnique.mockResolvedValue({ userId: "owner", contextKey: "coworker:/inventory" });
    expect((await persistCoworkerResponse(request, db as never)).message.responseScope).toBe("known_unroomed");
  });
  it("does not let an omitted route envelope hide a thread's recorded room", async () => {
    db.agentThread.findUnique.mockResolvedValue({ userId: "owner", contextKey: "coworker:/build/work/WC-RECORDED" });
    expect((await persistCoworkerResponse(input(), db as never)).message.responseScope).toBeNull();
  });

  it("does not bind a save whose message thread differs from its scope envelope", async () => {
    const request = input();request.data.threadId = "other-thread";
    const result = await persistCoworkerResponse(request, db as never);
    expect(result.message.responseAttemptId).toBeNull();
    expect(result.message.responseContentDigest).toBeNull();
    expect(result.message.responseScope).toBeNull();
    expect(db.agentThread.findUnique).not.toHaveBeenCalled();
  });
  it("does not bind a save whose persisted task differs from its scope envelope", async () => {
    const request = input();
    const result = await persistCoworkerResponse({ ...request, data: { ...request.data, taskRunId: "TR-OTHER" } }, db as never);
    expect(result.message.responseAttemptId).toBeNull();
    expect(result.message.responseScope).toBeNull();
    expect(db.agentThread.findUnique).not.toHaveBeenCalled();
  });
  it("persists the exact assistant attempt and exact final-byte digest without awaiting telemetry", async () => {
    const result = await persistCoworkerResponse(input(), db as never);
    expect(db.agentMessage.create.mock.calls[0][0].data).toMatchObject({ id: "assistant-id", responseAttemptId: "actual-attempt", responseContentDigest: responseContentDigest(content), responseScope: "known_unroomed", responseWorkroomId: null });
    expect(result.content).toBe(content);expect(result.message.responseAttemptId).toBe("actual-attempt");
  });
  it("resolves semantic TaskRun and requested room to their exact database identities", async () => {
    const request = input();request.scope.taskRunId = "TR-EXACT";request.data.taskRunId = "TR-EXACT";request.scope.requestedWorkroomId = "WC-EXACT";
    db.taskRun.findUnique.mockResolvedValue({ id: "task-db", taskRunId: "TR-EXACT", userId: "owner", threadId: "thread" });
    db.workroom.findMany.mockResolvedValue([{ id: "room-db", capsuleId: "WC-EXACT", taskRunId: "task-db" }]);
    const result = await persistCoworkerResponse(request, db as never);
    expect(db.taskRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { taskRunId: "TR-EXACT" } }));
    expect(result.message).toMatchObject({ responseScope: "workroom", responseWorkroomId: "room-db" });
  });
  it.each(["context", "task-error", "unexpected-task", "room-error", "room-ambiguous", "task-mismatch"])("keeps %s scope unavailable without losing the answer", async reason => {
    const request = input();
    if (reason === "context") request.scope.serverContextResolved = false;
    if (reason === "task-error") db.taskRun.findMany.mockRejectedValue(new Error("read unavailable"));
    if (reason === "unexpected-task") db.taskRun.findMany.mockResolvedValue([{ id: "unresolved-current-task" }]);
    if (reason.startsWith("room")) { request.scope.requestedWorkroomId = "WC-EXACT";
      if (reason === "room-error") db.workroom.findMany.mockRejectedValue(new Error("room read unavailable"));
      else db.workroom.findMany.mockResolvedValue([{ id: "room-a" }, { id: "room-b" }]); }
    if (reason === "task-mismatch") { request.scope.taskRunId = "TR-EXACT";request.data.taskRunId = "TR-EXACT";db.taskRun.findUnique.mockResolvedValue({ id: "task-db", userId: "other", threadId: "thread" }); }
    const result = await persistCoworkerResponse(request, db as never);
    expect(result.content).toBe(content);expect(result.message.responseScope).toBeNull();expect(result.message.responseWorkroomId).toBeNull();
  });
  it("does not bind a material replacement or system output", async () => {
    const rewritten = input();rewritten.data.content = "An independently rewritten answer with different content.";
    expect((await persistCoworkerResponse(rewritten, db as never)).message.responseAttemptId).toBeNull();
    const synthetic = input();synthetic.data.role = "system";
    expect((await persistCoworkerResponse(synthetic, db as never)).message.responseAttemptId).toBeNull();
  });
});
