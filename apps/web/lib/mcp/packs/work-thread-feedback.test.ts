import { ok } from "@/lib/shared/action-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
const domain = vi.hoisted(() => ({ read: vi.fn(), answer: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/routing/response-feedback", () => ({ getResponseFeedback: domain.read, getResponseFeedbackAnswer: domain.answer, recordResponseFeedback: domain.write }));
import { responseFeedbackHandlers } from "./work-thread-feedback";
const context = { agentId: "AGT-1", governedSource: "jsonrpc" as const, tokenScope: "write" as const, tokenGrantScopes: ["thread_write", "thread_read"] };
beforeEach(() => { vi.clearAllMocks(); });
describe("work-thread exact response feedback adapters", () => {
  it("uses authenticated acting coworker and validates the real write scope", async () => {
    domain.write.mockResolvedValue(ok({ state: { source: "agent" }, changed: true }));
    expect(await responseFeedbackHandlers.record_response_feedback({ messageId: "m1", value: false, expectedRevision: 0, agentId: "forged", source: "human" }, "u1", context)).toMatchObject({ success: true, data: { state: { source: "agent" } } });
    expect(domain.write).toHaveBeenCalledWith({ messageId: "m1", value: false, expectedRevision: 0 }, { userId: "u1", agentId: "AGT-1", surface: "mcp" });
    expect(await responseFeedbackHandlers.record_response_feedback({ messageId: "m1", value: true, expectedRevision: 0 }, "u1", { ...context, tokenScope: "read" })).toMatchObject({ success: false, error: "forbidden" });
    expect(domain.write).toHaveBeenCalledTimes(1);
  });
  it("never lets missing server actor context become a human judgment", async () => {
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1" }, "u1", {})).toMatchObject({ success: false, error: "forbidden" });
    expect(domain.read).not.toHaveBeenCalled();
  });
  it("rejects invalid request types and read-only grants before the shared writer", async () => {
    for (const params of [{ messageId: "m1", value: "false", expectedRevision: 0 }, { messageId: "m1", value: true, expectedRevision: -1 }])
      expect(await responseFeedbackHandlers.record_response_feedback(params, "u1", context)).toMatchObject({ success: false, error: "unavailable" });
    expect(await responseFeedbackHandlers.record_response_feedback({ messageId: "m1", value: true, expectedRevision: 0 }, "u1", { ...context, tokenGrantScopes: ["thread_read"] })).toMatchObject({ success: false, error: "forbidden" });
    expect(domain.write).not.toHaveBeenCalled();
  });
  it("reads the same safe state and never serializes a refused actor's exception", async () => {
    domain.read.mockResolvedValue({ messageId: "m1", available: false });
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1" }, "u1", context)).toMatchObject({ success: true, data: { state: { available: false } } });
    domain.read.mockRejectedValue(new Error("forbidden"));
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1" }, "u1", context)).toMatchObject({ success: false, error: "forbidden" });
  });
  it("keeps answer text out of default reads and requires an explicit boolean opt-in", async () => {
    domain.read.mockResolvedValue({ messageId: "m1", available: true });
    domain.answer.mockResolvedValue({ content: "Exact answer", state: { messageId: "m1", available: true } });
    const routine = await responseFeedbackHandlers.get_response_feedback({ messageId: "m1" }, "u1", context);
    expect(routine.data).not.toHaveProperty("answer"); expect(domain.answer).not.toHaveBeenCalled();
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1", includeAnswer: true, expectedAttemptId: "a1" }, "u1", context)).toMatchObject({ success: true, data: { answer: { content: "Exact answer" } } });
    expect(domain.answer).toHaveBeenCalledWith("m1", "a1", { userId: "u1", agentId: "AGT-1" });
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1", includeAnswer: "true" }, "u1", context)).toMatchObject({ success: false, error: "unavailable" });
    domain.answer.mockRejectedValue(new Error("forbidden"));
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1", includeAnswer: true, expectedAttemptId: "a1" }, "u1", context)).toMatchObject({ success: false, error: "forbidden" });
  });

  it("requires the clicked attempt for opted-in answer reads, keeping routine reads unchanged", async () => {
    domain.answer.mockResolvedValue({ content: "Wrong winner", state: { available: true } });
    expect(await responseFeedbackHandlers.get_response_feedback({ messageId: "m1", includeAnswer: true }, "u1", context)).toMatchObject({ success: false, error: "unavailable" });
    expect(domain.answer).not.toHaveBeenCalled();
  });

});
