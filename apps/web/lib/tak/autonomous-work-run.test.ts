import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  const findFirst = vi.fn();
  return {
    prisma: {
      taskRun: { create, findFirst },
    },
  };
});

vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: vi.fn(),
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
}));
vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));
vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: vi.fn(),
  resolveAgentByIdWithPrompts: vi.fn(),
}));

describe("createAutonomousWorkRun", () => {
  beforeEach(async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockReset();
    vi.mocked(prisma.taskRun.findFirst).mockReset();

    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockReset();

    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.executeTool).mockReset();
    vi.mocked(tools.getAvailableTools).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockReset();

    const governed = await import("@/lib/mcp-governed-execute");
    vi.mocked(governed.governedExecuteTool).mockReset();

    const routing = await import("@/lib/tak/agent-routing-server");
    vi.mocked(routing.resolveAgentForRouteWithPrompts).mockReset();
    vi.mocked(routing.resolveAgentByIdWithPrompts).mockReset();
  });

  it("creates a scheduled TaskRun through the shared autonomous work seam", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    } as never);

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    const ref = await createAutonomousWorkRun({
      trigger: "scheduled",
      userId: "user-1",
      agentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      objective: "Triage taxonomy gaps from discovery.",
      prompt: "Triage taxonomy gaps from discovery.",
      threadId: "thread-1",
      sourceRef: {
        kind: "scheduled-task",
        id: "discovery-taxonomy-gap-triage-daily",
      },
    });

    expect(ref).toEqual({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    });

    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: "user-1",
      threadId: "thread-1",
      contextId: "thread-1",
      initiatingAgentId: "inventory-specialist",
      currentAgentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      objective: "Triage taxonomy gaps from discovery.",
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: {
        trigger: "scheduled",
        sourceRef: {
          kind: "scheduled-task",
          id: "discovery-taxonomy-gap-triage-daily",
        },
      },
    });
    expect(String(arg?.data?.taskRunId)).toMatch(/^TR-SCHED-/);
  });

  it("creates capacity-continuity TaskRuns with capacity metadata and no tool execution", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_capacity",
      taskRunId: "TR-CAP-ABCDE",
      contextId: "thread-capacity",
    } as never);

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "capacity-continuity",
      userId: "principal-1",
      agentId: "platform-engineer",
      routeContext: "/platform/ai/capacity-continuity",
      title: "Review stale specs",
      objective: "Review stale specs and produce evidence-backed follow-up notes.",
      prompt: "Review stale specs and produce evidence-backed follow-up notes.",
      threadId: "thread-capacity",
      sourceRef: {
        kind: "standing-order",
        id: "standing-order-1",
      },
      metadata: {
        cognitiveLoad: {
          capacityState: "away",
          standingOrderId: "standing-order-1",
          dedupeKey: "spec-drift:2026-05-12",
          fundingFitHint: {
            providerClassHint: "fixed-cost",
            modelTierHint: "standard",
          },
        },
      },
    });

    expect(prisma.taskRun.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: "principal-1",
      source: "proactive",
      status: "working",
      a2aMetadata: {
        trigger: "capacity-continuity",
        sourceRef: {
          kind: "standing-order",
          id: "standing-order-1",
        },
        cognitiveLoad: {
          capacityState: "away",
          standingOrderId: "standing-order-1",
          dedupeKey: "spec-drift:2026-05-12",
          fundingFitHint: {
            providerClassHint: "fixed-cost",
            modelTierHint: "standard",
          },
        },
      },
    });
    expect(String(arg?.data?.taskRunId)).toMatch(/^TR-CAP-/);
  });

  it("finds the newest unarchived TaskRun for an interactive thread", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.findFirst).mockResolvedValue({ taskRunId: "TR-CHAT-123" } as never);

    const { findCurrentAutonomousWorkRun } = await import("./autonomous-work-run");

    await expect(findCurrentAutonomousWorkRun({
      userId: "user-1",
      threadId: "thread-1",
    })).resolves.toEqual({ taskRunId: "TR-CHAT-123" });

    expect(prisma.taskRun.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        threadId: "thread-1",
        archivedAt: null,
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      select: { taskRunId: true },
    });
  });

  it("resolves the task agent when the route persona differs", async () => {
    const routing = await import("@/lib/tak/agent-routing-server");
    vi.mocked(routing.resolveAgentForRouteWithPrompts).mockResolvedValue({
      agentId: "platform-engineer",
      systemPrompt: "route prompt",
    } as never);
    vi.mocked(routing.resolveAgentByIdWithPrompts).mockResolvedValue({
      agentId: "external-catalog-scout",
      systemPrompt: "task prompt",
    } as never);

    const { resolveAutonomousWorkAgent } = await import("./autonomous-work-run");

    const agent = await resolveAutonomousWorkAgent({
      agentId: "external-catalog-scout",
      routeContext: "/platform/ai/operations",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
    });

    expect(agent).toMatchObject({ agentId: "external-catalog-scout", systemPrompt: "task prompt" });
    expect(routing.resolveAgentByIdWithPrompts).toHaveBeenCalledWith(
      "external-catalog-scout",
      { userId: "user-1", platformRole: null, isSuperuser: true },
    );
  });

  it("resolves tools and provider tool schemas through one runtime helper", async () => {
    const mcpTools = await import("@/lib/mcp-tools");
    const toolList = [{ name: "run_discovery_triage", sideEffect: true }];
    vi.mocked(mcpTools.getAvailableTools).mockResolvedValue(toolList as never);
    vi.mocked(mcpTools.toolsToOpenAIFormat).mockReturnValue([{ type: "function" }]);

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");

    const resolved = await resolveAutonomousWorkTools({
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
      agentId: "inventory-specialist",
      mode: "act",
    });

    expect(resolved).toEqual({ tools: toolList, toolsForProvider: [{ type: "function" }] });
    expect(mcpTools.getAvailableTools).toHaveBeenCalledWith(
      { userId: "user-1", platformRole: null, isSuperuser: true },
      { mode: "act", agentId: "inventory-specialist" },
    );
  });

  it("forwards TaskRun identity into the agentic loop", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Done.", executedTools: [] } as never);

    const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");

    await executeAutonomousAgenticLoop({
      systemPrompt: "You are helpful.",
      chatHistory: [{ role: "user", content: "Run it." }],
      sensitivity: "internal",
      tools: [],
      toolsForProvider: [],
      userId: "user-1",
      routeContext: "/platform/tools/discovery",
      agentId: "inventory-specialist",
      threadId: "thread-1",
      taskRunId: "TR-SCHED-ABCDEF12",
    });

    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-SCHED-ABCDEF12",
        agentId: "inventory-specialist",
        threadId: "thread-1",
      }),
    );
  });

  it("executes a single governed tool with TaskRun attribution", async () => {
    const governed = await import("@/lib/mcp-governed-execute");
    vi.mocked(governed.governedExecuteTool).mockResolvedValue({ success: true, message: "ok" } as never);

    const { executeAutonomousWorkTool } = await import("./autonomous-work-run");

    await executeAutonomousWorkTool({
      toolName: "run_discovery_triage",
      args: { trigger: "cadence" },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
      routeContext: "/platform/tools/discovery",
      agentId: "inventory-specialist",
      threadId: "thread-1",
      taskRunId: "TR-SCHED-ABCDEF12",
    });

    expect(governed.governedExecuteTool).toHaveBeenCalledWith({
      toolName: "run_discovery_triage",
      rawParams: { trigger: "cadence" },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
      source: "agentic-loop",
      context: {
        routeContext: "/platform/tools/discovery",
        agentId: "inventory-specialist",
        threadId: "thread-1",
        taskRunId: "TR-SCHED-ABCDEF12",
      },
    });
  });
});
