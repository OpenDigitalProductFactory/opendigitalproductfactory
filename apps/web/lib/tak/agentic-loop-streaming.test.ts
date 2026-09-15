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

const result = (content: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []) => ({
  content, toolCalls, inputTokens: 10, outputTokens: 5, providerId: "codex", modelId: "test-model",
  downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {},
});
const params = {
  chatHistory: [{ role: "user" as const, content: "Read the evidence." }],
  systemPrompt: "Read the evidence and report it.", sensitivity: "internal" as const,
  tools: [{ name: "read_source_at_version", description: "Read source", inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
  toolsForProvider: [{ type: "function", function: { name: "read_source_at_version", parameters: {} } }],
  userId: "user-1", agentId: "reviewer", threadId: "thread-1", routeContext: "/review",
  taskType: "external-mcp",
};

describe("agent loop completed-result streaming intent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "Source evidence.",
      data: { content: "Immutable evidence." } });
  });

  it.each([undefined, "autonomous"] as const)("consumes completed tools and text with %s mode", async (interactionMode) => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(result("", [{ id: "read-1", name: "read_source_at_version", arguments: {} }]) as never)
      .mockResolvedValue(result("The source evidence is available for review.") as never);
    const outcome = await runAgenticLoop({ ...params, interactionMode });
    expect(governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: "read_source_at_version" }));
    expect(outcome.content).toContain("source evidence");
    expect(vi.mocked(routeAndCall).mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of vi.mocked(routeAndCall).mock.calls) {
      expect(call[3]).toMatchObject({ requiresStreaming: false });
      expect(call[3]?.interactionMode).not.toBe("background");
    }
  });

  it("keeps chat's omitted streaming default", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(result("Which source should I read?") as never);
    await runAgenticLoop({ ...params, interactionMode: "chat" });
    expect(vi.mocked(routeAndCall).mock.calls[0][3]?.requiresStreaming).toBeUndefined();
  });
});
