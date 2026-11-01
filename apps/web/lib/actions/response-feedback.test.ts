import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn(), answer: vi.fn(), write: vi.fn() }));
vi.mock("./shared/guards", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/routing/response-feedback", () => ({ getResponseFeedback: mocks.read, getResponseFeedbackAnswer: mocks.answer, recordResponseFeedback: mocks.write }));
import { getResponseFeedbackAction, getResponseFeedbackAnswerAction, recordResponseFeedbackAction } from "./response-feedback";
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "u1" }); });
describe("response feedback authenticated actions", () => {
  it("derives the human actor from the session, ignoring caller attribution", async () => {
    mocks.write.mockResolvedValue({ ok: true, state: { value: true }, changed: true });
    expect(await recordResponseFeedbackAction({ messageId: "m1", value: true, expectedRevision: 0, agentId: "forged", source: "human" } as never)).toEqual({ ok: true, data: { state: { value: true }, changed: true } });
    expect(mocks.write).toHaveBeenCalledWith({ messageId: "m1", value: true, expectedRevision: 0 }, { userId: "u1", surface: "portal" });
  });
  it("returns canonical ActionResult with safe conflict codes", async () => {
    mocks.write.mockResolvedValue({ ok: false, error: "conflict" });
    expect(await recordResponseFeedbackAction({ messageId: "m1", value: false, expectedRevision: 2 })).toEqual({ ok: false, error: "conflict" });
    mocks.read.mockResolvedValue({ messageId: "m1", available: false });
    expect(await getResponseFeedbackAction("m1")).toEqual({ ok: true, data: { messageId: "m1", available: false } });
  });
  it("refuses unauthenticated callers and never exposes raw exception details", async () => {
    mocks.user.mockRejectedValue(new Error("secret session details"));
    expect(await getResponseFeedbackAction("m1")).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: "u1" }); mocks.read.mockRejectedValue(new Error("secret database URL"));
    expect(await getResponseFeedbackAction("m1")).toEqual({ ok: false, error: "save-failed" });
  });
  it("returns an explicit answer DTO only after authenticated exact-response authorization", async () => {
    mocks.answer.mockResolvedValue({ content: "Saved answer", state: { messageId: "m1" } });
    expect(await getResponseFeedbackAnswerAction("m1", "a1")).toEqual({ ok: true, data: { content: "Saved answer", state: { messageId: "m1" } } });
    expect(mocks.answer).toHaveBeenCalledWith("m1", "a1", { userId: "u1" });
    mocks.answer.mockResolvedValue(null);
    expect(await getResponseFeedbackAnswerAction("m1", "a1")).toEqual({ ok: false, error: "unavailable" });
    mocks.answer.mockRejectedValue(new Error("forbidden"));
    expect(await getResponseFeedbackAnswerAction("m1", "a1")).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses answer requests without an explicit clicked attempt before reading", async () => {
    mocks.answer.mockReset(); mocks.answer.mockResolvedValue({ content: "Wrong winner", state: { messageId: "m1" } });
    expect(await getResponseFeedbackAnswerAction("m1", "")).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.answer).not.toHaveBeenCalled();
  });

});
