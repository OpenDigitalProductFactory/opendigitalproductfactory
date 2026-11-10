import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgenticLoop } from "./agentic-loop";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn(async () => null) },
  toolExecution: { create: vi.fn(async () => ({})) },
  user: { findUnique: vi.fn(async () => ({ isSuperuser: true, groups: [{ platformRole: { roleId: "ceo" } }] })) },
  platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: vi.fn(), PLATFORM_TOOLS: [] }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

function mockResult(input: {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}) {
  return {
    ...input, toolCalls: input.toolCalls ?? [], providerId: "anthropic-sub", modelId: "test-model",
    downgraded: false, downgradeMessage: null, downgradeReason: null,
    toolsStripped: false, truncated: false, inputTokens: 100, outputTokens: 50,
    routeDecision: {} as never, responseId: undefined,
  };
}

const baseParams = {
  chatHistory: [{ role: "user" as const, content: "search for agent code" }],
  systemPrompt: "You are a helpful assistant.", sensitivity: "internal" as const,
  tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
  toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
  userId: "user-1", routeContext: "/build", agentId: "software-engineer", threadId: "thread-1",
};

describe("agentic-loop governed refusal handling", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("stops a refused batch without executing its remaining actions", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(mockResult({ content: "Checking.", toolCalls:
      Array.from({ length: 6 }, (_, index) => ({ id: `call-${index}`, name: "search_project_files", arguments: { query: `scope-${index}` } })),
    }));
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: false, error: "authority_denied", disposition: "refused" } as never);

    const result = await runAgenticLoop(baseParams);

    expect(routeAndCall).toHaveBeenCalledTimes(1);
    expect(governedExecuteTool).toHaveBeenCalledTimes(3);
    expect(result.executedTools).toHaveLength(3);
    expect(result.failure?.kind).toBe("policy-or-capability");
  });
  it.each(["forbidden_grant", "authority_denied", "forbidden_capability"])("breaks early with a blocked status when every tool call is %s", async (error) => {
    const mockRoute = vi.mocked(routeAndCall);

    // Model keeps emitting tool calls with VARYING args (as the real
    // grant-starved loop did) so the exact-args repetition detector never
    // fires — only the grant-starvation circuit breaker should stop it.
    let call = 0;
    mockRoute.mockImplementation(async () =>
      mockResult({
        content: "Let me use a tool.",
        toolCalls: [
          { id: `toolu_${call}`, name: "search_project_files", arguments: { query: `attempt-${call++}` } },
        ],
      }),
    );

    // Every governed execution is rejected for a missing grant.
    vi.mocked(governedExecuteTool).mockResolvedValue({
      success: false,
      error,
      message: "search_project_files rejected: the current authority does not admit this action",
    } as never);

    const result = await runAgenticLoop({ ...baseParams, agentId: "build-architect" });

    // Honest, actionable blocked message that names the agent + the tool.
    expect(result.content).toContain("Blocked");
    expect(result.content).toContain(error);
    expect(result.content).toContain("search_project_files");
    expect(result.content).toContain("build-architect");
    // Broke on the streak (3), did NOT burn toward MAX_ITERATIONS (200).
    expect(vi.mocked(governedExecuteTool)).toHaveBeenCalledTimes(3);
    expect(mockRoute).toHaveBeenCalledTimes(3);
    expect(result.failure?.kind).toBe("policy-or-capability");
  });

  it.each([
    { success: true, message: "Read available context" },
    { success: false, error: "approval_required", disposition: "awaiting-person" as const },
    { success: false, error: "authority_evidence_unavailable", disposition: "inconclusive" as const },
  ])("does not combine refusals across intervening progress or a non-verdict ($error)", async (middleResult) => {
    let attempt = 0;
    vi.mocked(routeAndCall).mockImplementation(async () => attempt < 5
      ? mockResult({ content: "Checking.", toolCalls: [{ id: `attempt-${attempt}`, name: "search_project_files", arguments: { query: `context-${attempt++}` } }] })
      : mockResult({ content: "These are investigation notes for the next step. The recorded outcomes need to be resolved before the affected work can continue." }));
    let execution = 0;
    vi.mocked(governedExecuteTool).mockImplementation(async () => ++execution === 3
      ? middleResult as never
      : { success: false, error: "authority_denied" } as never);

    const result = await runAgenticLoop({ ...baseParams, routeContext: "/workspace", interactionMode: "chat" });

    expect(routeAndCall).toHaveBeenCalledTimes(6);
    expect(governedExecuteTool).toHaveBeenCalledTimes(5);
    expect(result.failure).toBeUndefined();
    expect(result.content).not.toContain("Blocked");
  });

});
