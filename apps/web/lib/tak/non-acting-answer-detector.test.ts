import { describe, it, expect } from "vitest";
import { detectNonActingAnswer } from "./non-acting-answer-detector";

describe("detectNonActingAnswer (non-acting bridge)", () => {
  it("detects a tool-action turn with tools attached, zero tool calls, and a guidance-only reply", () => {
    const detect = detectNonActingAnswer({
      taskType: "tool-action",
      attachedToolCount: 15,
      toolCallCount: 0,
      replyText: "Here is how you could proceed, though I only have guidance-only access.",
    });
    expect(detect).toBe(true);
  });

  it("returns false when a tool call was made", () => {
    const detect = detectNonActingAnswer({
      taskType: "tool-action",
      attachedToolCount: 15,
      toolCallCount: 1,
      replyText: "guidance-only access",
    });
    expect(detect).toBe(false);
  });

  it("returns false when the task type is not eligible", () => {
    const detect = detectNonActingAnswer({
      taskType: "question-answer",
      attachedToolCount: 15,
      toolCallCount: 0,
      replyText: "guidance-only access",
    });
    expect(detect).toBe(false);
  });

  it("returns false when no tools were attached", () => {
    const detect = detectNonActingAnswer({
      taskType: "tool-action",
      attachedToolCount: 0,
      toolCallCount: 0,
      replyText: "guidance-only access",
    });
    expect(detect).toBe(false);
  });

  it("returns false when the reply shows no unavailable/unfinished signal", () => {
    const detect = detectNonActingAnswer({
      taskType: "tool-action",
      attachedToolCount: 15,
      toolCallCount: 0,
      replyText: "Done — I completed the requested action.",
    });
    expect(detect).toBe(false);
  });

  it("detects via the tool-refused-despite-availability path (generic refusal)", () => {
    const detect = detectNonActingAnswer({
      taskType: "tool-action",
      attachedToolCount: 15,
      toolCallCount: 0,
      replyText: "My tool list is currently `[]`, pending follow-on grant.",
    });
    expect(detect).toBe(true);
  });
});
