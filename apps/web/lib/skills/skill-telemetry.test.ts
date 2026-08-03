import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgenticLoop } from "@/lib/tak/agentic-loop";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";

vi.mock("@/lib/routed-inference", () => ({
  routeAndCall: vi.fn(),
  NoEligibleEndpointsError: class extends Error {},
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

vi.mock("@/lib/skills/usage-events", () => ({
  recordSkillUsageEvents: vi.fn(),
}));

vi.mock("@/lib/skills/runtime", () => ({
  getSkillsForAgent: vi.fn(),
}));

describe("Skill Telemetry (BI-901A567C)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("records invoked exactly once, and completed at the end of a successful run", async () => {
    const { recordSkillUsageEvents } = await import("@/lib/skills/usage-events");
    const { getSkillsForAgent } = await import("@/lib/skills/runtime");

    vi.mocked(getSkillsForAgent).mockResolvedValue([
      { skillId: "sk-123", allowedTools: ["test_tool"], label: "", description: "", capability: null, prompt: "", category: "", tags: [], riskBand: "", taskType: "", triggerPattern: null, userInvocable: true, agentInvocable: true }
    ]);

    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, text: "ok", content: [], name: "test_tool" } as any);

    // routeAndCall returns already-normalized toolCalls: { id, name, arguments }
    // (not the raw OpenAI function/name envelope).
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call_1", name: "test_tool", arguments: {} }],
        providerId: "test",
        modelId: "test",
        downgraded: false,
        downgradeMessage: null,
        downgradeReason: null,
        toolsStripped: false,
        inputTokens: 0,
        outputTokens: 0,
        routeDecision: {},
      } as any)
      // 2nd iteration: text response — ends the loop
      .mockResolvedValueOnce({
        content: "Done",
        toolCalls: [],
        providerId: "test",
        modelId: "test",
        downgraded: false,
        downgradeMessage: null,
        downgradeReason: null,
        toolsStripped: false,
        inputTokens: 0,
        outputTokens: 0,
        routeDecision: {},
      } as any);

    const result = await runAgenticLoop({
      chatHistory: [],
      systemPrompt: "",
      sensitivity: "internal",
      tools: [{ name: "test_tool", description: "", inputSchema: {}, requiredCapability: null }],
      toolsForProvider: [],
      userId: "u1",
      routeContext: "/test",
      agentId: "agent1",
      threadId: "thread1",
    });

    expect(result.content).toBe("Done");

    expect(recordSkillUsageEvents).toHaveBeenCalledTimes(2);
    expect(recordSkillUsageEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({
      phase: "invoked",
      skillIds: ["sk-123"],
    }));
    expect(recordSkillUsageEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
      phase: "completed",
      skillIds: ["sk-123"],
    }));
  });
});
