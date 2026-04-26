import { describe, it, expect, vi, beforeEach } from "vitest";

// Import pure functions that don't need mocks
import { shouldNudge, detectFabrication } from "./agentic-loop";

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: {
      findUnique: vi.fn(),
    },
    toolExecution: {
      create: vi.fn(),
    },
  },
}));
vi.mock("@/lib/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: vi.fn(),
  PLATFORM_TOOLS: [],
}));

import { runAgenticLoop } from "./agentic-loop";
import { routeAndCall } from "@/lib/routed-inference";
import { executeTool } from "@/lib/mcp-tools";
import { prisma } from "@dpf/db";

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
    responseId: undefined,
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
    })).toBe(false);
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

  it("detects plan-ready claims with zero tools executed", () => {
    expect(
      detectFabrication(
        "Planning is done; the next required action is approving Start Implementation for FB-9B19098C in the product UI.",
        0,
        false,
      ),
    ).toBe(true);
  });

  it("detects plan-summary narration with zero tools executed", () => {
    expect(
      detectFabrication(
        "I refined the plan to 5 small UI-only tasks across 4 existing files and the next approval in the product UI is Start Implementation for FB-9B19098C.",
        0,
        false,
      ),
    ).toBe(true);
  });

  it("detects narration with only read tools (no build tools)", () => {
    expect(detectFabrication(
      "Here's the exact code to add to agent-routing.ts:\n```{ label: 'Analyze' }```",
      5, false, ["read_project_file", "search_project_files"],
    )).toBe(true);
  });

  it("detects plan-ready claims when only read tools were executed", () => {
    expect(detectFabrication(
      "Plan ready — 5 tasks across 4 files, and Start Implementation is the correct next approval in the product UI.",
      2,
      false,
      ["list_project_directory", "search_project_files"],
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
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
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

    // First response is a generic question, which the loop now treats as a
    // legitimate conversational reply rather than force-nudging into tool use.
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
    expect(result.content).toBe("Hello! How can I help?");
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

  it("compacts oversized tool history before the next routing call", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Reading files.",
        toolCalls: [{ id: "toolu_01A", name: "read_project_file", arguments: { path: "big-file.ts" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Finished reading the file and condensed the key findings into a short summary so the next step can continue without replaying the entire raw payload back into the model context window. The important pieces are the exported handler, the request validation branch, and the persistence logic, which is enough context for the agent to move forward without carrying the whole file contents.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "The condensed summary is ready and the next routing call has the shortened tool payload instead of the full file dump.",
      }));

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Large file contents",
      data: {
        file: "x".repeat(20_000),
      },
    });

    await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "read_project_file", description: "Read", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "read_project_file", description: "Read", parameters: {} } },
      ],
    });

    const secondCallMessages = mockRoute.mock.calls[1]![0];
    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.length).toBeLessThanOrEqual(1500);
    expect(toolMsg!.content).toContain("[truncated");
  });

  it("caps long agentic history before routing", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content: "Done.",
    }));

    const longHistory = Array.from({ length: 40 }, (_, idx) => ({
      role: idx % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${idx}`,
    }));

    await runAgenticLoop({
      ...baseParams,
      chatHistory: longHistory,
      tools: [],
      toolsForProvider: undefined,
    });

    const firstCallMessages = mockRoute.mock.calls[0]![0];
    expect(firstCallMessages.length).toBeLessThanOrEqual(24);
    expect(firstCallMessages[0]!.content).toBe("message-0");
    expect(firstCallMessages[firstCallMessages.length - 1]!.content).toBe("message-39");
  });

  it("drops orphaned tool outputs when compaction removes the matching tool call", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute.mockResolvedValueOnce(mockResult({
      content:
        "I finished reviewing the existing complaint flow patterns and can continue with the design without replaying stale tool output into the next model call.",
      inputTokens: 120,
      outputTokens: 80,
    }));

    const historyWithTrimmedToolPair = [
      { role: "user" as const, content: "message-0" },
      { role: "assistant" as const, content: "message-1" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "call_abc", name: "search_project_files", arguments: { query: "complaint" } }],
      },
      {
        role: "tool" as const,
        content: "old tool result",
        toolCallId: "call_abc",
      },
      ...Array.from({ length: 22 }, (_, idx) => ({
        role: idx % 2 === 0 ? "user" as const : "assistant" as const,
        content: `filler-${idx}`,
      })),
    ];

    await runAgenticLoop({
      ...baseParams,
      chatHistory: historyWithTrimmedToolPair,
      tools: [],
      toolsForProvider: undefined,
    });

    const firstCallMessages = mockRoute.mock.calls[0]![0];
    const orphanedTool = firstCallMessages.find((m: any) => m.role === "tool" && m.toolCallId === "call_abc");

    expect(orphanedTool).toBeUndefined();
  });

  it("allows revised build plans after failed review instead of treating them as repetition", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    const buildPlanV1 = {
      fileStructure: [{ path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add complaint model" }],
      tasks: [
        { title: "Add complaint model", testFirst: "schema test", implement: "edit schema", verify: "prisma validate" },
      ],
    };

    const buildPlanV2 = {
      fileStructure: [{ path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add complaint model" }],
      tasks: [
        { title: "Add complaint model", testFirst: "schema test", implement: "edit schema", verify: "prisma validate" },
        { title: "Add complaint indexes", testFirst: "index test", implement: "add indexes", verify: "prisma validate" },
      ],
    };

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Saving the first plan draft.",
        toolCalls: [{ id: "toolu_01A", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlanV1 } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the first plan draft.",
        toolCalls: [{ id: "toolu_01B", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Splitting the oversized task and saving the revised plan.",
        toolCalls: [{ id: "toolu_01C", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlanV2 } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the revised plan.",
        toolCalls: [{ id: "toolu_01D", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Implementation plan ready — 1 file, 2 tasks. I split the oversized complaint work into separate schema and indexing tasks, reran the plan review, and the revised plan is now properly scoped for the build phase.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail. Task 1 is too large and needs to be broken down into smaller efforts.", data: { review: { decision: "fail", summary: "Task 1 is too large and needs to be broken down into smaller efforts." } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass. The tasks are now properly scoped.", data: { review: { decision: "pass", summary: "The tasks are now properly scoped." } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Implementation plan ready — 1 file, 2 tasks.");
    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
    expect(mockExecuteTool.mock.calls[2]?.[1]).toMatchObject({ field: "buildPlan", value: buildPlanV2 });
  });

  it("allows 3 review cycles when each review follows a plan revision", { timeout: 15_000 }, async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    // Pattern: save → review(fail) → save → review(fail) → save → review(pass) → done
    // 3 reviews, but each is preceded by a saveBuildEvidence, so it's progress.
    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v1.",
        toolCalls: [{ id: "t1", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v1" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v1.",
        toolCalls: [{ id: "t2", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v2.",
        toolCalls: [{ id: "t3", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v2" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v2.",
        toolCalls: [{ id: "t4", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving plan v3.",
        toolCalls: [{ id: "t5", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: { tasks: [{ title: "v3" }] } } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing plan v3.",
        toolCalls: [{ id: "t6", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValue(mockResult({
        content: "Plan passed after 3 revisions. The tasks are now properly scoped and include data seeding, schema changes, and API implementation with proper test coverage.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail.", data: { review: { decision: "fail" } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: fail.", data: { review: { decision: "fail" } } })
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass.", data: { review: { decision: "pass" } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).toContain("I called saveBuildEvidence 3 times with the same arguments and got stuck.");
    expect(mockExecuteTool).toHaveBeenCalledTimes(6);
  });

  it("does not treat scoped search_sandbox calls as repetition when glob changes", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    for (let idx = 0; idx < 7; idx++) {
      mockRoute.mockResolvedValueOnce(mockResult({
        content: `Searching complaint scope ${idx}.`,
        toolCalls: [
          {
            id: `toolu_search_${idx}`,
            name: "search_sandbox",
            arguments: { pattern: "complaint", glob: `apps/web/scope-${idx}/**/*`, maxResults: 20 },
          },
        ],
      }));
    }

    mockRoute.mockResolvedValueOnce(mockResult({
      content:
        "Completed complaint schema research across multiple codebase scopes and confirmed the implementation boundaries for schema, API, and UI wiring without repeating the same discovery calls. I mapped where Prisma models belong, identified the API route conventions for intake and triage, and captured the UI handoff points needed to replace placeholder state with persisted complaint workflow data end to end.",
    }));

    for (let idx = 0; idx < 7; idx++) {
      mockExecuteTool.mockResolvedValueOnce({ success: true, message: `Search results scope ${idx}` });
    }

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "search_sandbox", description: "Search sandbox", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "search_sandbox", description: "Search sandbox", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Completed complaint schema research across multiple codebase scopes");
    expect(result.executedTools).toHaveLength(7);
    expect(mockRoute).toHaveBeenCalledTimes(8);
  });

  it("nudges status-only build updates to continue implementation", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Inspecting schema and searching complaint references.",
        toolCalls: [
          {
            id: "toolu_01A",
            name: "search_sandbox",
            arguments: { pattern: "complaint", glob: "packages/db/prisma/schema.prisma", maxResults: 20 },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "I confirmed there is no complaint model yet and the next step is defining enums and relations. Ready to proceed when you confirm.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Creating schema changes now.",
        toolCalls: [
          {
            id: "toolu_01B",
            name: "edit_sandbox_file",
            arguments: { path: "packages/db/prisma/schema.prisma", old_text: "model User {", new_text: "enum ComplaintStatus {\\n  open\\n}\\n\\nmodel User {" },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "Implemented the complaint schema enum scaffolding and started wiring relations. Next I can continue with API routes and verification.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: "Search results for complaint" })
      .mockResolvedValueOnce({ success: true, message: "Updated schema.prisma" });

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      tools: [
        { name: "search_sandbox", description: "Search sandbox", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "edit_sandbox_file", description: "Edit sandbox file", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "search_sandbox", description: "Search sandbox", parameters: {} } },
        { type: "function", function: { name: "edit_sandbox_file", description: "Edit sandbox file", parameters: {} } },
      ],
    });

    expect(result.executedTools).toHaveLength(2);
    expect(result.content).toContain("Implemented the complaint schema enum scaffolding");
    const thirdCallMessages = mockRoute.mock.calls[2]?.[0] ?? [];
    const lastUserMessage = [...thirdCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain("Do not pause with status-only updates");
  });

  it("does not allow plan-ready claims after read-only tool use without build-plan persistence", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Checking the existing Build Studio workflow files.",
        toolCalls: [{ id: "toolu_read_1", name: "search_project_files", arguments: { query: "BuildStudio workflow actions" } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files, and Start Implementation is the correct next approval in the product UI.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files, and Start Implementation is the correct next approval in the product UI.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "",
      }));

    mockExecuteTool.mockResolvedValueOnce({ success: true, message: "Found Build Studio workflow files." });

    const result = await runAgenticLoop(baseParams);

    expect(result.content).not.toContain("Plan ready");
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
  });

  it("uses a plan-specific recovery nudge when the model claims Start Implementation is next without saving build evidence", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    const buildPlan = {
      fileStructure: [
        { path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix header overlap" },
      ],
      tasks: [
        { title: "Stabilize build studio header layout", testFirst: "render workflow at constrained height", implement: "adjust layout containers", verify: "pnpm --filter web typecheck" },
      ],
    };

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files. Building now.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Saving the implementation plan now.",
        toolCalls: [{ id: "toolu_plan_1", name: "saveBuildEvidence", arguments: { field: "buildPlan", value: buildPlan } }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Reviewing the implementation plan now.",
        toolCalls: [{ id: "toolu_plan_2", name: "reviewBuildPlan", arguments: {} }],
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 1 task across 1 file, and Start Implementation is the correct next approval in the product UI. I saved the implementation plan, completed the review, and confirmed the scoped header-overlap fix is ready for sandbox execution.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: true, message: 'Evidence "buildPlan" saved.' })
      .mockResolvedValueOnce({ success: true, message: "Plan review: pass.", data: { review: { decision: "pass" } } });

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).toContain("Start Implementation is the correct next approval");
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockRoute.mock.calls[1]?.[0] ?? [];
    const lastUserMessage = [...secondCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain('saveBuildEvidence with field "buildPlan"');
    expect(lastUserMessage?.content).toContain("reviewBuildPlan");
  });

  it("blocks a repeated fabricated plan-ready reply instead of surfacing it to the user", async () => {
    const mockRoute = vi.mocked(routeAndCall);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files. Building now.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Plan ready — 5 tasks across 4 files. Building now.",
      }));

    const result = await runAgenticLoop({
      ...baseParams,
      tools: [
        { name: "saveBuildEvidence", description: "Save evidence", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "reviewBuildPlan", description: "Review build plan", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "saveBuildEvidence", description: "Save evidence", parameters: {} } },
        { type: "function", function: { name: "reviewBuildPlan", description: "Review build plan", parameters: {} } },
      ],
    });

    expect(result.content).not.toContain("Plan ready");
    expect(result.content).toContain("Start Implementation cannot unlock until I save buildPlan");
  });

  it("nudges build agent to use fallback steps after failed read stalls", async () => {
    const mockRoute = vi.mocked(routeAndCall);
    const mockExecuteTool = vi.mocked(executeTool);

    mockRoute
      .mockResolvedValueOnce(mockResult({
        content: "Trying to read Prisma schema.",
        toolCalls: [
          {
            id: "toolu_02A",
            name: "run_sandbox_command",
            arguments: { command: "cat /workspace/packages/db/prisma/schema.prisma" },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "I inspected the API folder layout and tried reading the Prisma schema to confirm complaint model updates, but the file read command kept failing, so I'll pause there. Next I'll reattempt schema access.",
      }))
      .mockResolvedValueOnce(mockResult({
        content: "Applying schema scaffolding now.",
        toolCalls: [
          {
            id: "toolu_02B",
            name: "edit_sandbox_file",
            arguments: {
              path: "packages/db/prisma/schema.prisma",
              old_text: "model User {",
              new_text: "enum ComplaintSeverity {\\n  low\\n  medium\\n  high\\n}\\n\\nmodel User {",
            },
          },
        ],
      }))
      .mockResolvedValueOnce(mockResult({
        content:
          "Added initial complaint severity enum scaffolding and resumed implementation with concrete schema updates instead of pausing on read retries.",
      }));

    mockExecuteTool
      .mockResolvedValueOnce({ success: false, message: "Could not read schema.prisma", error: "File not found: packages/db/prisma/schema.prisma" })
      .mockResolvedValueOnce({ success: true, message: "Updated schema.prisma" });

    const result = await runAgenticLoop({
      ...baseParams,
      routeContext: "/build",
      tools: [
        { name: "run_sandbox_command", description: "Run sandbox command", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
        { name: "edit_sandbox_file", description: "Edit sandbox file", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false },
      ],
      toolsForProvider: [
        { type: "function", function: { name: "run_sandbox_command", description: "Run sandbox command", parameters: {} } },
        { type: "function", function: { name: "edit_sandbox_file", description: "Edit sandbox file", parameters: {} } },
      ],
    });

    expect(result.executedTools).toHaveLength(2);
    expect(result.content).toContain("Added initial complaint severity enum scaffolding");
    const thirdCallMessages = mockRoute.mock.calls[2]?.[0] ?? [];
    const lastUserMessage = [...thirdCallMessages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage?.content).toContain("Do not pause after a failed read");
  });
});
