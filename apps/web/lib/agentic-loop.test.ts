import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ai-provider-priority", () => ({
  callWithFailover: vi.fn(),
}));
vi.mock("./routing/fallback", () => ({
  callWithFallbackChain: vi.fn(),
}));
vi.mock("./mcp-tools", () => ({
  executeTool: vi.fn(),
}));

import { runAgenticLoop } from "./agentic-loop";
import { callWithFailover } from "./ai-provider-priority";
import { executeTool } from "./mcp-tools";

describe("runAgenticLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const baseParams = {
    chatHistory: [{ role: "user" as const, content: "search for agent code" }],
    systemPrompt: "You are a helpful assistant.",
    sensitivity: "internal" as const,
    tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
    toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
    userId: "user-1",
    routeContext: "/build",
    agentId: "software-engineer",
    threadId: "thread-1",
  };

  it("creates structured messages with tool call IDs after tool execution", async () => {
    const mockFailover = vi.mocked(callWithFailover);
    const mockExecuteTool = vi.mocked(executeTool);

    // Iteration 0: model calls a tool
    mockFailover.mockResolvedValueOnce({
      content: "Searching for agent code.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 100,
      outputTokens: 50,
      inferenceMs: 500,
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    });

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found 3 files",
      data: { files: ["a.ts", "b.ts", "c.ts"] },
    });

    // Iteration 1: model responds with text only
    mockFailover.mockResolvedValueOnce({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 200,
      outputTokens: 80,
      inferenceMs: 400,
    });

    const result = await runAgenticLoop(baseParams);

    expect(result.content).toBe("I found 3 agent-related files: a.ts, b.ts, c.ts.");
    expect(result.executedTools).toHaveLength(1);

    // Verify the messages passed to the second callWithFailover call
    const secondCallMessages = mockFailover.mock.calls[1]![0]; // first arg is messages

    // Should have: user msg, assistant with toolCalls, tool result
    const assistantMsg = secondCallMessages.find((m: any) => m.role === "assistant" && m.toolCalls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls![0]!.id).toBe("toolu_01A");
    expect(assistantMsg!.toolCalls![0]!.name).toBe("search_project_files");

    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("toolu_01A");
    expect(toolMsg!.content).toContain("Found 3 files");
  });

  it("returns text-only response when no tool calls", async () => {
    const mockFailover = vi.mocked(callWithFailover);

    mockFailover.mockResolvedValueOnce({
      content: "Hello! How can I help?",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 50,
      outputTokens: 20,
      inferenceMs: 200,
    });

    const result = await runAgenticLoop(baseParams);
    expect(result.content).toBe("Hello! How can I help?");
    expect(result.executedTools).toHaveLength(0);
    expect(result.proposal).toBeNull();
  });

  it("handles multiple tool calls in one iteration", async () => {
    const mockFailover = vi.mocked(callWithFailover);
    const mockExecuteTool = vi.mocked(executeTool);

    // Model calls two tools at once
    mockFailover.mockResolvedValueOnce({
      content: "Searching and reading.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 100,
      outputTokens: 50,
      inferenceMs: 500,
      toolCalls: [
        { id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } },
        { id: "toolu_01B", name: "search_project_files", arguments: { query: "coworker" } },
      ],
    });

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: "Found 3 files" })
      .mockResolvedValueOnce({ success: true, message: "Found 2 files" });

    // Final response
    mockFailover.mockResolvedValueOnce({
      content: "Found agent and coworker files.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 200,
      outputTokens: 80,
      inferenceMs: 400,
    });

    const result = await runAgenticLoop(baseParams);
    expect(result.executedTools).toHaveLength(2);

    // Should have ONE assistant message and TWO tool result messages
    const secondCallMessages = mockFailover.mock.calls[1]![0];
    const toolMsgs = secondCallMessages.filter((m: any) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]!.toolCallId).toBe("toolu_01A");
    expect(toolMsgs[1]!.toolCallId).toBe("toolu_01B");
  });
});
