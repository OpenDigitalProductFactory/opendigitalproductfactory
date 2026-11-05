// BI-A8679D84 — the forced final step reaches the provider call: the owed
// writer alone, tool_choice "required", released once the writer ran.
// Harness as agentic-loop-terminal-truncation.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";

const writer = "record_workroom_evidence";
const reader = "get_backlog_item";
const reply = (content: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []) => ({
  content, truncated: false, toolCalls, inputTokens: 10, outputTokens: 40,
  providerId: "anthropic", modelId: "stage-model", downgraded: false,
  downgradeMessage: null, toolsStripped: false, routeDecision: {},
});
const toolDef = (name: string, sideEffect: boolean) => ({ name, description: name, inputSchema: {},
  requiredCapability: null, executionMode: "immediate" as const, sideEffect });
const params = {
  chatHistory: [{ role: "user" as const, content: "Call record_workroom_evidence now." }],
  systemPrompt: "Record the stage.", sensitivity: "internal" as const,
  tools: [toolDef(reader, false), toolDef(writer, true)],
  toolsForProvider: [
    { type: "function", function: { name: reader, parameters: {} } },
    { type: "function", function: { name: writer, parameters: {} } },
  ],
  userId: "user-1", agentId: "build-specialist", threadId: "thread-1", routeContext: "/ops/workrooms",
  interactionMode: "autonomous" as const,
};

describe("a forced-writer loop (BI-A8679D84)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "Evidence recorded." });
  });

  it("offers only the writer under tool_choice required, then releases it", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.mocked(routeAndCall).mockImplementation(async (...args) => {
      calls.push(structuredClone(args[3] as Record<string, unknown>));
      return (calls.length === 1
        ? reply("", [{ id: "w-1", name: writer, arguments: { outcome: "completed" } }])
        : reply("Recorded the stage evidence.")) as never;
    });

    const result = await runAgenticLoop({ ...params, forcedToolName: writer });

    expect(calls[0]).toMatchObject({ toolChoice: "required", terminalWriterToolName: writer });
    expect((calls[0]!.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name)).toEqual([writer]);
    expect((calls[1]!.tools as unknown[]).length).toBe(2);
    expect(calls[1]!.toolChoice).toBeUndefined();
    expect(result.executedTools.map((tool) => tool.name)).toEqual([writer]);
  });

  it("leaves the choice to the model when nothing is forced", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.mocked(routeAndCall).mockImplementation(async (...args) => {
      calls.push(structuredClone(args[3] as Record<string, unknown>));
      return reply("Nothing to record.") as never;
    });

    await runAgenticLoop(params);

    expect(calls[0]!.toolChoice).toBeUndefined();
  });
});
