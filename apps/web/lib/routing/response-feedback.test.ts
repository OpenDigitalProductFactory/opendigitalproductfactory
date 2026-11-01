import { createHash } from "node:crypto";
import type { Prisma } from "@dpf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ current: vi.fn(), room: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: auth.current }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveCanonicalWorkroomActorAccess: auth.room }));
import { getResponseFeedback, getResponseFeedbackAnswer, recordResponseFeedback } from "./response-feedback";
const actor = { userId: "u1" };
const agentActor = { userId: "u1", agentId: "AGT-1" };
function fixture() {
  const message = { id: "msg1", threadId: "thread1", role: "assistant", content: "Exact saved answer. ",
    providerId: "provider1", modelId: "model1", responseAttemptId: "attempt1",
    responseContentDigest: createHash("sha256").update("Exact saved answer. ").digest("hex"),
    responseScope: "known_unroomed", responseWorkroomId: null, thread: { userId: "u1" } };
  const attempt = { id: "attempt1", agentMessageId: "msg1", threadId: "thread1", providerId: "provider1", modelId: "model1",
    traceId: "trace1", status: "success", executionMode: "single", finishedAt: new Date("2026-01-01T00:00:00Z"),
    userAccepted: null as boolean | null, acceptedAt: null as Date | null, feedbackPrincipalId: null as string | null,
    feedbackSource: null as "human" | "agent" | null, feedbackRevision: 0, feedbackPrincipal: null as { displayName: string } | null };
  const human = { id: "principal-human", principalId: "HUMAN-1", kind: "human", status: "active", displayName: "Owner" };
  const assistant = { id: "principal-agent", principalId: "AGT-1", kind: "agent", status: "active", displayName: "Assistant" };
  const db = {
    agentMessage: { findUnique: vi.fn(async () => message), count: vi.fn(async () => 1) },
    adapterRunTelemetry: { findUnique: vi.fn(async () => ({ ...attempt })), updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => { const previousRevision = attempt.feedbackRevision; const { feedbackRevision: _increment, ...data } = args.data; Object.assign(attempt, data); attempt.feedbackRevision = previousRevision + 1; return { count: 1 }; }) },
    principalAlias: { findFirst: vi.fn(async (args: { where: { aliasType: string } }) => ({ principal: args.where.aliasType === "agent" ? assistant : human })) },
    agent: { findUnique: vi.fn(async () => ({ status: "active", archived: false })) },
    user: { findUnique: vi.fn(async () => ({ email: "owner@example.test" })) },
    adminActivity: { create: vi.fn(async (_args: Prisma.AdminActivityCreateArgs) => ({ id: "audit1" })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const before = { ...attempt };
      try { return await fn(db); } catch (error) { Object.assign(attempt, before); throw error; }
    }),
  };
  return { db, message, attempt, human, assistant };
}
beforeEach(() => {
  vi.clearAllMocks(); auth.current.mockResolvedValue({ userId: "u1" });
  auth.room.mockImplementation(async (input: { requested: string }) => ({ decision: { level: input.requested, reason: "authorized" } }));
});
describe("exact response feedback", () => {
  it("saves exact successful response disposition with canonical human provenance and atomic audit", async () => {
    const { db, attempt } = fixture();
    const result = await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never);
    expect(result).toMatchObject({ ok: true, data: { changed: true, state: { available: true, value: true, source: "human", revision: 1 } } });
    expect(attempt.feedbackPrincipalId).toBe("principal-human");
    expect(attempt.acceptedAt).toBeInstanceOf(Date);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(auth.current).toHaveBeenCalledWith("u1", db);
    expect(db.adminActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1", toolName: "record_response_feedback", parameters: expect.objectContaining({ actorPrincipalId: "principal-human", source: "human", previous: expect.objectContaining({ value: null, revision: 0 }), next: expect.objectContaining({ value: true, revision: 1 }) }) }) }));
    expect(JSON.stringify(db.adminActivity.create.mock.calls)).not.toContain("Exact saved answer");
  });
  it("records correction then clear with retained clearing provenance and separate audit, duplicate is a no-op", async () => {
    const { db, attempt } = fixture();
    await recordResponseFeedback({ messageId: "msg1", value: false, expectedRevision: 0 }, actor, db as never);
    expect(attempt.acceptedAt).toBeInstanceOf(Date);
    expect(await recordResponseFeedback({ messageId: "msg1", value: false, expectedRevision: 1 }, actor, db as never)).toMatchObject({ ok: true, data: { changed: false } });
    expect(await recordResponseFeedback({ messageId: "msg1", value: null, expectedRevision: 1 }, actor, db as never)).toMatchObject({ ok: true, data: { changed: true, state: { value: null, revision: 2 } } });
    expect(attempt.acceptedAt).toBeNull(); expect(attempt.feedbackPrincipalId).toBe("principal-human");
    expect(db.adminActivity.create).toHaveBeenCalledTimes(2);
  });
  it.each(["foreign-thread", "inactive-user", "missing-principal", "inactive-principal", "automation-as-human"])("fails closed for %s without exposing another response", async (reason) => {
    const { db, message, human } = fixture();
    if (reason === "foreign-thread") message.thread.userId = "other";
    if (reason === "inactive-user") auth.current.mockResolvedValue(null);
    if (reason === "missing-principal") db.principalAlias.findFirst.mockResolvedValue(null as never);
    if (reason === "inactive-principal") human.status = "inactive";
    if (reason === "automation-as-human") db.user.findUnique.mockResolvedValue({ email: "automation@dpf.local" });
    await expect(getResponseFeedback("msg1", actor, db as never)).rejects.toThrow("forbidden");
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "forbidden" });
    expect(db.adapterRunTelemetry.updateMany).not.toHaveBeenCalled();
  });
  it.each(["missing-attempt", "unsuccessful", "unfinished", "shadow-alt", "race-loser", "wrong-message", "wrong-thread", "wrong-provider", "wrong-model", "edited-content", "duplicate-binding", "unknown-scope", "deleted-room"])("leaves %s unavailable without writing or guessing a producer", async (reason) => {
    const { db, message, attempt } = fixture();
    if (reason === "missing-attempt") db.adapterRunTelemetry.findUnique.mockResolvedValue(null as never);
    if (reason === "unsuccessful") attempt.status = "error";
    if (reason === "unfinished") attempt.finishedAt = null as never;
    if (reason === "shadow-alt" || reason === "race-loser") attempt.executionMode = reason;
    if (reason === "wrong-message") attempt.agentMessageId = "other";
    if (reason === "wrong-thread") attempt.threadId = "other";
    if (reason === "wrong-provider") attempt.providerId = "other";
    if (reason === "wrong-model") attempt.modelId = "other";
    if (reason === "edited-content") message.content = message.content.trim();
    if (reason === "duplicate-binding") db.agentMessage.count.mockResolvedValue(2);
    if (reason === "unknown-scope") message.responseScope = null as never;
    if (reason === "deleted-room") message.responseScope = "workroom";
    expect(await getResponseFeedback("msg1", actor, db as never)).toMatchObject({ available: false, value: null, source: null, canWrite: false });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "unavailable" });
    expect(db.adapterRunTelemetry.updateMany).not.toHaveBeenCalled();
  });
  it("requires action admission separately from read and repeats exact-room authorization on mutation", async () => {
    const { db, message } = fixture(); message.responseScope = "workroom"; message.responseWorkroomId = "room1" as never;
    auth.room.mockImplementation(async ({ requested }: { requested: string }) => ({ decision: { level: requested === "content" ? "content" : "none" } }));
    expect(await getResponseFeedback("msg1", actor, db as never)).toMatchObject({ available: true, canWrite: false });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "forbidden" });
    expect(auth.room).toHaveBeenCalledWith(expect.objectContaining({ workroomId: "room1", requested: "action" }), db);
  });
  it("never lets an agent replace or clear a human judgment, including a human-cleared state", async () => {
    const { db, attempt } = fixture(); attempt.feedbackSource = "human"; attempt.feedbackPrincipalId = "principal-human";
    for (const value of [true, false, null]) expect(await recordResponseFeedback({ messageId: "msg1", value, expectedRevision: 0 }, agentActor, db as never)).toEqual({ ok: false, error: "forbidden" });
    expect(db.adapterRunTelemetry.updateMany).not.toHaveBeenCalled();
  });
  it("allows only an agent's own judgment, while a human owner can replace it", async () => {
    const { db, attempt } = fixture();
    expect(await recordResponseFeedback({ messageId: "msg1", value: false, expectedRevision: 0 }, agentActor, db as never)).toMatchObject({ ok: true, data: { state: { source: "agent" } } });
    attempt.feedbackPrincipalId = "other-agent";
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 1 }, agentActor, db as never)).toEqual({ ok: false, error: "forbidden" });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 1 }, actor, db as never)).toMatchObject({ ok: true, data: { state: { source: "human" } } });
  });
  it("rejects stale version and lost CAS without audit", async () => {
    const { db } = fixture();
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 2 }, actor, db as never)).toEqual({ ok: false, error: "conflict" });
    db.adapterRunTelemetry.updateMany.mockResolvedValue({ count: 0 });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "conflict" });
    expect(db.adminActivity.create).not.toHaveBeenCalled();
  });
  it("rolls state back when mandatory audit fails and never retries uncertain connection errors", async () => {
    const { db, attempt } = fixture(); db.adminActivity.create.mockRejectedValue(new Error("connection lost"));
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "save-failed" });
    expect(attempt.userAccepted).toBeNull(); expect(attempt.feedbackRevision).toBe(0); expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("retries only a database-confirmed rollback and rereads authority before the bounded retry", async () => {
    const { db } = fixture(); db.$transaction.mockRejectedValueOnce({ code: "P2034" });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toMatchObject({ ok: true });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
  it("refuses inactive coworkers, removed room admission and legacy unattributed judgments", async () => {
    const { db, message, attempt } = fixture();
    db.agent.findUnique.mockResolvedValue({ status: "inactive", archived: false });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, agentActor, db as never)).toEqual({ ok: false, error: "forbidden" });
    db.agent.findUnique.mockResolvedValue({ status: "active", archived: false });
    attempt.userAccepted = true;
    expect(await recordResponseFeedback({ messageId: "msg1", value: null, expectedRevision: 0 }, agentActor, db as never)).toEqual({ ok: false, error: "forbidden" });
    message.responseScope = "workroom"; message.responseWorkroomId = "room1" as never;
    auth.room.mockResolvedValue({ decision: { level: "none" } });
    await expect(getResponseFeedback("msg1", actor, db as never)).rejects.toThrow("forbidden");
    expect(db.adapterRunTelemetry.updateMany).not.toHaveBeenCalled();
  });
  it("reauthorizes a confirmed rollback retry and stops when ownership authority has expired", async () => {
    const { db, attempt } = fixture();
    auth.current.mockResolvedValueOnce({ userId: "u1" }).mockResolvedValue(null);
    db.adminActivity.create.mockRejectedValueOnce({ code: "P2034" });
    expect(await recordResponseFeedback({ messageId: "msg1", value: true, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "forbidden" });
    expect(auth.current).toHaveBeenCalledTimes(2); expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(attempt.userAccepted).toBeNull(); expect(attempt.feedbackRevision).toBe(0);
  });
  it("bounds confirmed rollback retries and leaves repeated serialization conflict explicit", async () => {
    const { db } = fixture(); db.$transaction.mockRejectedValue({ code: "P2034" });
    expect(await recordResponseFeedback({ messageId: "msg1", value: false, expectedRevision: 0 }, actor, db as never)).toEqual({ ok: false, error: "conflict" });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("returns exact saved bytes only through the separately authorized answer read", async () => {
    const { db, message } = fixture();
    expect(await getResponseFeedbackAnswer("msg1", "attempt1", actor, db as never)).toMatchObject({ content: message.content, state: { messageId: "msg1", available: true } });
    const routine = await getResponseFeedback("msg1", actor, db as never);
    expect(routine).not.toHaveProperty("content"); expect(routine).not.toHaveProperty("answer");
  });
  it("exposes no answer to a foreign owner or an actor removed from the saved room", async () => {
    const { db, message } = fixture(); message.thread.userId = "other";
    await expect(getResponseFeedbackAnswer("msg1", "attempt1", actor, db as never)).rejects.toThrow("forbidden");
    message.thread.userId = "u1"; message.responseScope = "workroom"; message.responseWorkroomId = "room1" as never;
    auth.room.mockResolvedValue({ decision: { level: "none" } });
    for (const expected of ["attempt1", "different-attempt"])
      await expect(getResponseFeedbackAnswer("msg1", expected, actor, db as never)).rejects.toThrow("forbidden");
  });
  it.each(["edited", "duplicate", "missing-attempt", "mismatched-binding"])("returns no answer for %s evidence", async (reason) => {
    const { db, message, attempt } = fixture();
    if (reason === "edited") message.content += " edited";
    if (reason === "duplicate") db.agentMessage.count.mockResolvedValue(2);
    if (reason === "missing-attempt") db.adapterRunTelemetry.findUnique.mockResolvedValue(null as never);
    if (reason === "mismatched-binding") attempt.agentMessageId = "other";
    expect(await getResponseFeedbackAnswer("msg1", "attempt1", actor, db as never)).toBeNull();
  });

  it("never substitutes the winning response for a different attempt sharing its assistant message", async () => {
    const { db, attempt } = fixture();
    const earlier = { ...attempt, id: "failed-earlier", status: "error", providerId: "other-provider", modelId: "other-model" };
    db.adapterRunTelemetry.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { id: string } }).where.id === earlier.id ? earlier : { ...attempt });
    expect(earlier.agentMessageId).toBe(attempt.agentMessageId);
    expect(await getResponseFeedbackAnswer("msg1", earlier.id, actor, db as never)).toBeNull();
    expect(await getResponseFeedbackAnswer("msg1", attempt.id, actor, db as never)).toMatchObject({ content: "Exact saved answer. ", attemptId: "attempt1", providerId: "provider1", modelId: "model1" });
  });
  it.each(["", " "])("refuses an absent expected producing attempt (%j)", async (expected) => {
    const { db } = fixture(); expect(await getResponseFeedbackAnswer("msg1", expected, actor, db as never)).toBeNull();
  });

});
