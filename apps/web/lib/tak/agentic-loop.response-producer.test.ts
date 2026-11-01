import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResponseProducer } from "../routing/response-producer";
vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, toolExecution: { create: vi.fn() }, user: { findUnique: vi.fn() },
  platformIssueReport: { create: vi.fn() }, coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: vi.fn(), PLATFORM_TOOLS: [] }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";
const content = "The requested analysis is complete and the three affected modules are ready for review.";
function response(attemptId: string, answer: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [], local = false) {
  const providerId = local ? "local" : "openai", modelId = local ? "docker.io/ai/qwen3.6:latest" : "actual";
  return { content: answer, providerId, modelId, downgraded: false, downgradeMessage: null, downgradeReason: null,
    toolsStripped: false, inputTokens: 10, outputTokens: 10, toolCalls, routeDecision: {} as never,
    responseProducer: createResponseProducer({ attemptId, providerId, modelId, content: answer }) };
}
const input = { systemPrompt: "You are helpful.", chatHistory: [{ role: "user" as const, content: "search for agent code" }], sensitivity: "internal" as const,
  tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
  toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
  userId: "user-1", routeContext: "/build", agentId: "build-specialist", threadId: "thread-1", agentMessageId: "assistant-id" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true, groups: [] } as never);
  vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
  vi.mocked(prisma.coworkerTurnMetric.upsert).mockResolvedValue({} as never);
  vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "ok", data: {} } as never);
});
describe("agentic response producer propagation", () => {
  it("retains the visible answer's exact attempt and assistant association", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(response("final-attempt", content));
    const result = await runAgenticLoop({ ...input, tools: [], toolsForProvider: [], interactionMode: "chat" });
    expect(result.responseProducer?.attemptId).toBe("final-attempt");
    expect(routeAndCall).toHaveBeenCalledWith(expect.any(Array), "You are helpful.", "internal", expect.objectContaining({ agentMessageId: "assistant-id", threadId: "thread-1" }));
  });
  it("attributes a recovered earlier draft to its own call rather than the final tool call", async () => {
    const preserved = "I have reviewed the design in full and mapped out the complete implementation approach across the affected modules, including the rollout order and the risks. Should I proceed with applying the fix now?";
    let call = 0;
    vi.mocked(routeAndCall).mockImplementation(async () => {
      call++;
      if (call === 2) return response("earlier-draft", preserved, [], true);
      return response("tool-call-" + call, "Still working.", [{ id: "tool-" + call, name: "search_project_files", arguments: { query: "query-" + call } }], true);
    });
    const result = await runAgenticLoop(input);
    expect(result.content).toBe(preserved);
    expect(result.responseProducer?.attemptId).toBe("earlier-draft");
    expect(vi.mocked(routeAndCall).mock.calls.length).toBeGreaterThan(2);
  });
  it("keeps actual provider metadata while leaving a synthetic exhausted answer unbound", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(response("tool-only", "", [{ id: "tool", name: "search_project_files", arguments: { query: "one" } }]));
    const result = await runAgenticLoop({ ...input, effortWarrant: { level: "minimal", reasoningDepth: "minimal", maxIterations: 1, maxDurationMs: 60000, contextTier: "basic", toolBudgetTarget: 1, signals: ["test"] } });
    expect(result.providerId).toBe("openai");expect(result.modelId).toBe("actual");
    expect(result.responseProducer).toBeUndefined();
  });
  it("leaves a synthetic local diagnostic unbound", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(response("narration", "I can check that for you.", [], true));
    const result = await runAgenticLoop(input);
    expect(result.content).toMatch(/Platform > AI > Providers/);
    expect(result.responseProducer).toBeUndefined();
  });
});
