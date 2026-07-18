import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  const findFirst = vi.fn();
  const prisma = { taskRun: { create, findFirst } };
  return {
    prisma: { ...prisma, $transaction: vi.fn(async (callback) => callback(prisma)) },
  };
});

vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/tak/pattern-observer-service", () => ({
  observeWorkPatternsAfterRun: vi.fn(),
}));
vi.mock("@/lib/tak/pattern-observer/observer", () => ({
  observeCoworkerPatterns: vi.fn(),
}));
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

    const observer = await import("@/lib/tak/pattern-observer-service");
    vi.mocked(observer.observeWorkPatternsAfterRun).mockReset();
    const systemicObserver = await import("@/lib/tak/pattern-observer/observer");
    vi.mocked(systemicObserver.observeCoworkerPatterns).mockReset();

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

  it("writes explicit proactivity metadata without letting generic metadata clobber it", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_proactivity",
      taskRunId: "TR-SCHED-PROACT",
      contextId: "thread-proactivity",
    } as never);

    const proactivity = {
      resolvedLevel: "assertive" as const,
      policyId: "proactivity:field-dispatch-appointment:assertive",
      attentionWindowMinutes: 20,
      followUpCadenceMinutes: [30, 60],
      maxAttempts: 3,
      spendClass: "elevated" as const,
      channelPolicy: "urgent-channel" as const,
      escalationTarget: "dispatcher" as const,
      actionBoundary: "propose" as const,
      explanation: "Customer appointment timing is at risk.",
      evidenceRefs: [{ kind: "activity-family", id: "field-dispatch-appointment" }],
    };

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "scheduled",
      userId: "dispatcher-1",
      agentId: "dispatch-coworker",
      routeContext: "/storefront/schedule",
      title: "Appointment delay watch",
      objective: "Watch appointment delay risk.",
      prompt: "Watch appointment delay risk.",
      threadId: "thread-proactivity",
      metadata: {
        proactivity: { resolvedLevel: "quiet" },
        context: "field-dispatch",
      },
      proactivity,
    });

    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data?.a2aMetadata).toMatchObject({
      trigger: "scheduled",
      context: "field-dispatch",
      proactivity,
    });
  });

  it("writes delegated posture metadata without letting generic metadata clobber it", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_delegate",
      taskRunId: "TR-CHAT-DELEG",
      contextId: "thread-child",
    } as never);

    const delegatedPosture = {
      executionAllowed: true as const,
      proactivity: {
        inheritedLevel: "assertive" as const,
        localLevel: "balanced" as const,
        effectiveLevel: "assertive" as const,
        source: "inherited-bias" as const,
        actionBoundary: "propose" as const,
        explanation: "Caller context increases persistence without changing authority.",
      },
      priority: {
        inherited: { preset: "fast" as const, qualityWeight: 0.1, costWeight: 0.1, timeWeight: 0.8 },
        local: { preset: "balanced" as const, qualityWeight: 1 / 3, costWeight: 1 / 3, timeWeight: 1 / 3 },
        effective: { preset: "fast" as const, qualityWeight: 0.1, costWeight: 0.1, timeWeight: 0.8 },
        source: "inherited-bias" as const,
        dominantAxis: "time" as const,
        explanation: "Caller priority is advisory context.",
      },
      metadata: {
        source: "delegated-coworker" as const,
        fromAgentId: "dispatch-coordinator",
        toAgentId: "parts-specialist",
        parentTaskRunId: "TR-PARENT",
      },
    };

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "interactive",
      userId: "user-1",
      agentId: "parts-specialist",
      routeContext: "/storefront/schedule",
      title: "Find replacement part",
      objective: "Find the replacement part for a delayed appointment.",
      prompt: "Find the replacement part for a delayed appointment.",
      threadId: "thread-child",
      parentTaskRunId: "TR-PARENT",
      metadata: {
        delegatedPosture: { executionAllowed: false },
        context: "field-dispatch",
      },
      delegatedPosture,
    });

    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data?.a2aMetadata).toMatchObject({
      trigger: "interactive",
      context: "field-dispatch",
      delegatedPosture,
    });
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

  it("fires the pattern observer after an agentic loop run", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Done.", executedTools: [] } as never);
    const observer = await import("@/lib/tak/pattern-observer-service");
    vi.mocked(observer.observeWorkPatternsAfterRun).mockResolvedValue({ processed: 0 } as never);
    const systemicObserver = await import("@/lib/tak/pattern-observer/observer");
    vi.mocked(systemicObserver.observeCoworkerPatterns).mockResolvedValue({
      processed: 0,
      submitted: false,
      skippedReason: "no-signals",
    } as never);

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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observer.observeWorkPatternsAfterRun).toHaveBeenCalledWith({
      taskRunId: "TR-SCHED-ABCDEF12",
      userId: "user-1",
      agentId: "inventory-specialist",
      threadId: "thread-1",
      routeContext: "/platform/tools/discovery",
      since: expect.any(Date),
    });
    expect(systemicObserver.observeCoworkerPatterns).toHaveBeenCalledWith({
      agentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      since: expect.any(Date),
      toolSurface: [],
    });
  });

  it("skips the systemic observer when the guarded observer reports a reflection loop", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Done.", executedTools: [] } as never);
    const observer = await import("@/lib/tak/pattern-observer-service");
    vi.mocked(observer.observeWorkPatternsAfterRun).mockResolvedValue({
      processed: 0,
      skippedReason: "reflection-loop-guard",
    } as never);
    const systemicObserver = await import("@/lib/tak/pattern-observer/observer");
    vi.mocked(systemicObserver.observeCoworkerPatterns).mockResolvedValue({
      processed: 0,
      submitted: false,
    } as never);

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
      taskRunId: "TR-RFL-ABCDEF12",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(systemicObserver.observeCoworkerPatterns).not.toHaveBeenCalled();
  });

  it("forwards MCP token identity into the agentic loop", async () => {
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
      taskRunId: "TR-MCP-ABCDEF12",
      apiTokenId: "tok_remote",
    });

    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-MCP-ABCDEF12",
        apiTokenId: "tok_remote",
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
