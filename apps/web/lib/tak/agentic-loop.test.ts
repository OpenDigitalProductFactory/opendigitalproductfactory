import { describe, it, expect, vi, beforeEach } from "vitest";

// Import pure functions that don't need mocks
import { shouldNudge, detectFabrication } from "./agentic-loop";

vi.mock("./routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("./mcp-tools", () => ({
  executeTool: vi.fn(),
}));

import { runAgenticLoop } from "./agentic-loop";
import { routeAndCall } from "./routed-inference";
import { executeTool } from "./mcp-tools";

// Helper to build a mock RoutedInferenceResult
function mockResult(overrides: {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    content: overrides.content,
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    downgraded: false,
    downgradeMessage: null,
    toolsStripped: false,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    toolCalls: overrides.toolCalls ?? [],
    routeDecision: {} as any,
  };
}

describe("shouldNudge", () => {
  it("nudges on first iteration when model returns text-only with tools available", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 44,
      responseText: "I can help with that.",
    })).toBe(true);
  });

  it("does not nudge when response is a short clarifying question", () => {
    // HR case: "add John as employee" → agent correctly asks for last name
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 35,
      responseText: "What is John's last name?",
    })).toBe(false);
  });

  it("does not nudge when response is a multi-field clarifying question", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 70,
      responseText: "To add this employee I need their last name and department — could you provide those?",
    })).toBe(false);
  });

  it("nudges when response is a long non-question text (model stalled)", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 120,
      responseText: "I can help you add an employee. The system has several tools available including create_employee and list_departments that you can use.",
    })).toBe(true);
  });

  it("does not nudge when no tools available", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 0, maxIterations: 40,
      hasTools: false, executedToolCount: 0, responseLength: 44,
    })).toBe(false);
  });

  it("does not nudge on first iteration when response is long and not narration", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 2, maxIterations: 40,
      hasTools: true, executedToolCount: 3, responseLength: 250,
      responseText: "The feature brief describes the notification system and acceptance criteria.",
    })).toBe(false);
  });

  it("nudges when response contains code narration patterns", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 3, maxIterations: 40,
      hasTools: true, executedToolCount: 5, responseLength: 500,
      responseText: "Here's the exact code to add to agent-routing.ts for each agent.",
    })).toBe(true);
  });

  it("nudges when tools were used and model stalls with short response", () => {
    expect(shouldNudge({
      continuationNudges: 0, iteration: 3, maxIterations: 40,
      hasTools: true, executedToolCount: 2, responseLength: 5,
    })).toBe(true);
  });

  it("does not nudge if already nudged once", () => {
    expect(shouldNudge({
      continuationNudges: 1, iteration: 0, maxIterations: 40,
      hasTools: true, executedToolCount: 0, responseLength: 44,
    })).toBe(false);
  });
});

describe("detectFabrication", () => {
  it("detects completion claim with zero tools executed", () => {
    expect(detectFabrication("I've built the feature and deployed it.", 0, false)).toBe(true);
  });

  it("does not flag when build tools were executed", () => {
    expect(detectFabrication("I've built the feature.", 3, false, ["saveBuildEvidence", "generate_code"])).toBe(false);
  });

  it("does not flag when proposal was returned", () => {
    expect(detectFabrication("I've created the deployment.", 0, true)).toBe(false);
  });

  it("does not flag informational responses", () => {
    expect(detectFabrication("The feature brief describes a notification system.", 0, false)).toBe(false);
  });

  it("detects 'TESTS PASS' with no tools", () => {
    expect(detectFabrication("TESTS PASS\n✅ All 4 criteria met", 0, false)).toBe(true);
  });

  it("detects 'SHIPPED TO STAGING'", () => {
    expect(detectFabrication("SHIPPED TO STAGING. Feature live at /build.", 0, false)).toBe(true);
  });

  it("detects narration with only read tools (no build tools)", () => {
    expect(detectFabrication(
      "Here's the exact code to add to agent-routing.ts:\n```{ label: 'Analyze' }```",
      5, false, ["read_project_file", "search_project_files"],
    )).toBe(true);
  });

  it("does not flag narration when build tools were used", () => {
    expect(detectFabrication(
      "Here's what I added to the code.",
      3, false, ["saveBuildEvidence", "propose_file_change"],
    )).toBe(false);
  });
});

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
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Iteration 0: model calls a tool
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Searching for agent code.",
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found 3 files",
      data: { files: ["a.ts", "b.ts", "c.ts"] },
    });

    // Iteration 1: model responds with text only (short → nudge fires)
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts.",
      inputTokens: 200,
      outputTokens: 80,
    }));

    // Iteration 2: after nudge, model gives longer final answer → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts. These contain the component structure, routing logic, and message state management you'll need for the alert feature. The AgentFAB component already has a status indicator.",
      inputTokens: 300,
      outputTokens: 100,
    }));

    const result = await runAgenticLoop(baseParams);

    expect(result.content).toContain("I found 3 agent-related files");
    expect(result.executedTools).toHaveLength(1);

    // Verify the messages passed to the second routeAndCall call
    const secondCallMessages = mockRoute.mock.calls[1]![0]; // first arg is messages

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

  it("returns text-only response when no tool calls (after nudge)", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    // First response: short text-only → triggers nudge (iteration 0, < 200 chars)
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Hello! How can I help?",
      inputTokens: 50,
      outputTokens: 20,
    }));

    // Second response after nudge: still text-only → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I can help you build features. What would you like to create?",
      inputTokens: 80,
      outputTokens: 30,
    }));

    const result = await runAgenticLoop(baseParams);
    // After nudge, returns the second response
    expect(result.content).toBe("I can help you build features. What would you like to create?");
    expect(result.executedTools).toHaveLength(0);
    expect(result.proposal).toBeNull();
  });

  it("handles multiple tool calls in one iteration", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Model calls two tools at once
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Searching and reading.",
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: [
        { id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } },
        { id: "toolu_01B", name: "search_project_files", arguments: { query: "coworker" } },
      ],
    }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: "Found 3 files" })
      .mockResolvedValueOnce({ success: true, message: "Found 2 files" });

    // Iteration 1: model responds with text only (short → nudge fires)
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Found agent and coworker files.",
      inputTokens: 200,
      outputTokens: 80,
    }));

    // Iteration 2: after nudge, model gives longer response → exits loop
    mockRoute.mockResolvedValueOnce(mockResult({
      content: "I found agent-related files in the project. The main coworker panel is in AgentCoworkerPanel.tsx and the agent routing is in agent-routing.ts. Both files contain the patterns you need for your feature.",
      inputTokens: 300,
      outputTokens: 100,
    }));

    const result = await runAgenticLoop(baseParams);
    expect(result.executedTools).toHaveLength(2);

    // Should have ONE assistant message and TWO tool result messages in second call
    const secondCallMessages = mockRoute.mock.calls[1]![0];
    const toolMsgs = secondCallMessages.filter((m: any) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]!.toolCallId).toBe("toolu_01A");
    expect(toolMsgs[1]!.toolCallId).toBe("toolu_01B");
  });
});
