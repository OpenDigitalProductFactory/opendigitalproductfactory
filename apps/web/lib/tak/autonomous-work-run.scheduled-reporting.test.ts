import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@/lib/mcp-tool-types";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/tak/pattern-observer-service", () => ({ observeWorkPatternsAfterRun: vi.fn() }));
vi.mock("@/lib/tak/pattern-observer/observer", () => ({ observeCoworkerPatterns: vi.fn() }));
vi.mock("@/lib/tak/reflection-triggers", () => ({ processRuntimeIssueReflection: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ getAvailableTools: vi.fn(), toolsToOpenAIFormat: vi.fn() }));
vi.mock("@/lib/tak/agent-grants", async original => ({
  ...await original<Record<string, unknown>>(), getAgentToolGrantsAsync: async () => [],
}));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({
  resolveLocalServingPosture: vi.fn(async () => ({ servedContextTokens: 24576, presence: "present" })),
}));
vi.mock("@/lib/routing/local-tool-fidelity", () => ({ resolveLocalToolFidelityCeiling: async () => null }));

const read = (name: string): ToolDefinition => ({ name, description: name,
  inputSchema: { type: "object", properties: {} }, requiredCapability: null,
  sideEffect: false, executionMode: "immediate" });
const unsafe: ToolDefinition[] = [
  { ...read("record_execution_evidence"), sideEffect: true },
  { ...read("unknown_effect"), sideEffect: undefined },
  { ...read("outward_read"), consequence: "outward" },
  { ...read("authority_read"), consequence: "authority" },
  { ...read("proposal_read"), executionMode: "proposal" },
  { ...read("conditional_effect"), consequenceForCall: async () => ({ consequence: null, reason: "dynamic" }) },
];
const userContext = { userId: "owner", platformRole: "admin", isSuperuser: true };

describe("bounded scheduled reporting narrows the real autonomous surface", () => {
  beforeEach(async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockImplementation(value => value as never);
  });

  it("keeps a history-reporting run free of optional post-run proposal writers", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    const observer = await import("@/lib/tak/pattern-observer-service");
    const systemic = await import("@/lib/tak/pattern-observer/observer");
    const reflection = await import("@/lib/tak/reflection-triggers");
    vi.mocked(observer.observeWorkPatternsAfterRun).mockClear().mockResolvedValue({ processed: 0 } as never);
    vi.mocked(systemic.observeCoworkerPatterns).mockClear().mockResolvedValue({ processed: 0 } as never);
    vi.mocked(reflection.processRuntimeIssueReflection).mockClear();
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Bounded report", executedTools: [] } as never);
    const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");
    const request: Parameters<typeof executeAutonomousAgenticLoop>[0] = {
      systemPrompt: "Observe only", chatHistory: [{ role: "user", content: "Report observations" }], sensitivity: "internal",
      tools: [], toolsForProvider: [], userId: "user-1", routeContext: "/ops", agentId: "observer", threadId: "thread-1",
      taskRunId: "TR-REPORTING", scheduledReportingMode: "read-only-history",
    };
    expect(await executeAutonomousAgenticLoop(request)).toMatchObject({ content: "Bounded report" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(observer.observeWorkPatternsAfterRun).not.toHaveBeenCalled();
    expect(systemic.observeCoworkerPatterns).not.toHaveBeenCalled();
    expect(reflection.processRuntimeIssueReflection).not.toHaveBeenCalled();
  });

  it("excludes writers and ambiguous definitions from both attached and deferred tools", async () => {
    const tools = await import("@/lib/mcp-tools");
    const reads = Array.from({ length: 40 }, (_, i) => read(`read_${i}`));
    const defaultImmediate = { ...read("default_immediate"), executionMode: undefined };
    vi.mocked(tools.getAvailableTools).mockResolvedValue([...reads, defaultImmediate, ...unsafe]);
    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({ userContext, agentId: "platform-engineer", mode: "act",
      scheduledReportingMode: "read-only-history", requiredToolNames: ["record_execution_evidence"] });
    const admitted = [...result.tools, ...result.deferredTools];
    expect(admitted.map(tool => tool.name)).toEqual(expect.arrayContaining([...reads, defaultImmediate].map(tool => tool.name)));
    for (const tool of unsafe) expect(admitted.map(candidate => candidate.name)).not.toContain(tool.name);
    expect(result.toolsForProvider).toEqual(result.tools);
  });

  it("keeps the read boundary when budgeting fails instead of restoring writers", async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockResolvedValue([read("observe_health"), ...unsafe]);
    const posture = await import("@/lib/inference/local-model-context-reconcile");
    vi.mocked(posture.resolveLocalServingPosture).mockRejectedValueOnce(new Error("budget probe unavailable"));
    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({ userContext, agentId: "platform-engineer", mode: "act",
      scheduledReportingMode: "read-only-history" });
    expect(result.tools.map(tool => tool.name)).toEqual(["observe_health"]);
    expect(result.deferredTools).toEqual([]);
  });

  it("retains the normal authorized surface when the persisted reporting mode is absent", async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockResolvedValue([read("observe_health"), unsafe[0]!]);
    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({ userContext, agentId: "platform-engineer", mode: "act" });
    expect(result.tools.map(tool => tool.name)).toContain("record_execution_evidence");
  });
});
