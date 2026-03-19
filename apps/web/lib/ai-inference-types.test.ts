import { describe, it, expect } from "vitest";
import type { ChatMessage, InferenceResult } from "./ai-inference";

describe("ChatMessage type", () => {
  it("accepts plain string content (backward compat)", () => {
    const msg: ChatMessage = { role: "user", content: "hello" };
    expect(msg.content).toBe("hello");
  });

  it("accepts content block arrays", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A", name: "search_project_files", input: { query: "agent" } },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("accepts tool role with toolCallId", () => {
    const msg: ChatMessage = {
      role: "tool",
      content: "Found 3 files",
      toolCallId: "call_abc",
    };
    expect(msg.role).toBe("tool");
    expect(msg.toolCallId).toBe("call_abc");
  });

  it("accepts assistant with toolCalls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me search.",
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    };
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0]!.id).toBe("toolu_01A");
  });
});

describe("InferenceResult type", () => {
  it("includes id in toolCalls", () => {
    const result: InferenceResult = {
      content: "",
      inputTokens: 10,
      outputTokens: 5,
      inferenceMs: 100,
      toolCalls: [{ id: "toolu_01A", name: "search", arguments: {} }],
    };
    expect(result.toolCalls![0]!.id).toBe("toolu_01A");
  });
});
