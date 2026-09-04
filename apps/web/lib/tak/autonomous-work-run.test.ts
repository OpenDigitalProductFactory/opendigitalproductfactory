import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  const createMessage = vi.fn();
  const findFirst = vi.fn();
  const prisma = { taskRun: { create, findFirst }, taskMessage: { create: createMessage } };
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
// BI-CAP-F2D39F8F — the attachment budget's environment probes, mocked so the
// budget path is deterministic in tests.
vi.mock("@/lib/tak/agent-grants", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentToolGrantsAsync: vi.fn(async () => []),
}));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({
  resolveLocalServingPosture: vi.fn(async () => ({
    servedContextTokens: 24_576,
    presence: "present" as const,
  })),
}));
vi.mock("@/lib/routing/local-tool-fidelity", () => ({
  resolveLocalToolFidelityCeiling: vi.fn(async () => null),
}));

describe("resolveAutonomousWorkTools — attachment budget (BI-CAP-F2D39F8F)", () => {
  const fakeTool = (name: string) => ({
    name,
    description: `${name} does ${name.replace(/_/g, " ")}`,
    inputSchema: { type: "object", properties: {} },
    requiredCapability: null,
    sideEffect: false,
    executionMode: "immediate",
  });
  const userContext = { userId: "user-1", platformRole: "admin", isSuperuser: true };

  beforeEach(async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockReset();
    vi.mocked(tools.toolsToOpenAIFormat).mockImplementation((ts: unknown[]) => ts as never);
  });

  it("caps a 115-tool surface to the local selection cliff and defers the rest behind load_tools", async () => {
    const tools = await import("@/lib/mcp-tools");
    const surface = Array.from({ length: 115 }, (_, i) => fakeTool(`tool_${i}`));
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "storefront-advisor",
      mode: "act",
      routeContext: "/storefront",
      intentQuery: "Review today's storefront orders and propose restocking.",
    });

    // 24,576-token cliff-prone local window → 15-tool cap TOTAL, load_tools
    // included — the same threshold as the routing layer's local-fallback gate.
    expect(result.tools.length).toBeLessThanOrEqual(15);
    expect(result.tools.some((t) => t.name === "load_tools")).toBe(true);
    expect(result.deferredTools.length).toBe(115 - (result.tools.length - 1));
    expect(result.toolsForProvider.length).toBe(result.tools.length);
  });

  it("keeps the cliff cap when the local probe could not read a window (BI-A8BFEFCE)", async () => {
    // The reported incident, at the level it actually happened: AGT-WS-REVIEW
    // budgeted `authorized=86 attached=48 cap=48` because the DMR probe failed
    // and the null window read as a cloud-only turn. 48 is precisely the surface
    // callWithFallbackChain refuses to run locally, so with codex rate-limited
    // the review turn executed zero tools and produced no approval evidence.
    const ctx = await import("@/lib/inference/local-model-context-reconcile");
    vi.mocked(ctx.resolveLocalServingPosture).mockResolvedValueOnce({
      servedContextTokens: null,
      presence: "unknown",
    });

    const tools = await import("@/lib/mcp-tools");
    const surface = Array.from({ length: 86 }, (_, i) => fakeTool(`tool_${i}`));
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "storefront-advisor",
      mode: "act",
    });

    // Stays inside what the routing gate will actually run locally.
    expect(result.tools.length).toBeLessThanOrEqual(15);
    expect(result.tools.length).toBeLessThan(48);
    expect(result.tools.some((t) => t.name === "load_tools")).toBe(true);
    // Authority is untouched — the long tail is deferred, not revoked.
    expect(result.deferredTools.length).toBe(86 - (result.tools.length - 1));
  });

  it("attaches everything (no load_tools) when the surface already fits", async () => {
    const tools = await import("@/lib/mcp-tools");
    const surface = Array.from({ length: 8 }, (_, i) => fakeTool(`tool_${i}`));
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "storefront-advisor",
      mode: "act",
    });

    expect(result.tools.length).toBe(8);
    expect(result.tools.some((t) => t.name === "load_tools")).toBe(false);
    expect(result.deferredTools).toHaveLength(0);
  });

  it("fails open to the full surface when a budget probe throws", async () => {
    const tools = await import("@/lib/mcp-tools");
    const surface = Array.from({ length: 40 }, (_, i) => fakeTool(`tool_${i}`));
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);
    const ctx = await import("@/lib/inference/local-model-context-reconcile");
    vi.mocked(ctx.resolveLocalServingPosture).mockRejectedValueOnce(new Error("probe down"));

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "storefront-advisor",
      mode: "act",
    });

    expect(result.tools).toHaveLength(40);
    expect(result.deferredTools).toHaveLength(0);
  });

  it("force-attaches authorized tools named by an exact external workflow packet", async () => {
    const tools = await import("@/lib/mcp-tools");
    const surface = [
      ...Array.from({ length: 18 }, (_, i) => fakeTool(`filler_${i}`)),
      fakeTool("search_tool_marketplace"),
      fakeTool("read_source_at_version"),
      { ...fakeTool("record_initiative_evidence"), sideEffect: true },
    ];
    vi.mocked(tools.getAvailableTools).mockResolvedValue(surface as never);

    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    const result = await resolveAutonomousWorkTools({
      userContext,
      agentId: "AGT-WS-BUILD",
      mode: "act",
      routeContext: "/build/work/WC-7FF8A505",
      requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
    });

    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "read_source_at_version",
      "record_initiative_evidence",
    ]));
    expect(result.deferredTools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      "read_source_at_version",
      "record_initiative_evidence",
    ]));
  });
});

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

  it("uses a server-derived public identity for idempotent external work", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_external",
      taskRunId: "TR-MCP-A1B2C3D4E5F6",
      contextId: "thread-external",
    } as never);
    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "external-mcp",
      taskRunId: "TR-MCP-A1B2C3D4E5F6",
      userId: "user-1",
      agentId: "AGT-WS-REVIEW",
      routeContext: "/platform/build",
      title: "Independent review",
      objective: "Review immutable design.",
      prompt: "Review immutable design.",
      threadId: "thread-external",
    });

    expect(vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0]?.data).toMatchObject({
      taskRunId: "TR-MCP-A1B2C3D4E5F6",
      initiatingAgentId: "AGT-WS-REVIEW",
    });
  });

  it("commits a deferred external submission and its first message atomically", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_deferred", taskRunId: "TR-MCP-DEFERRED", contextId: "thread-deferred",
    } as never);
    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "external-mcp",
      taskRunId: "TR-MCP-DEFERRED",
      userId: "user-1",
      agentId: "AGT-WS-REVIEW",
      routeContext: "/research",
      title: "Deferred inference",
      objective: "Produce one durable answer.",
      prompt: "Produce one durable answer.",
      threadId: "thread-deferred",
      deferredSubmission: {
        content: "Produce one durable answer.",
        metadata: { source: "mcp.tasks/submit" },
      },
    });

    expect(prisma.taskRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "submitted" }),
    }));
    expect(prisma.taskMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskRunId: "tr_internal_deferred",
        contextId: "thread-deferred",
        role: "user",
        parts: [{ type: "message", text: "Produce one durable answer." }],
      }),
    }));
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

    expect(resolved).toEqual({
      tools: toolList,
      toolsForProvider: [{ type: "function" }],
      deferredTools: [],
    });
    expect(mcpTools.getAvailableTools).toHaveBeenCalledWith(
      { userId: "user-1", platformRole: null, isSuperuser: true },
      {
        mode: "act",
        agentId: "inventory-specialist",
        externalAccessEnabled: undefined,
        unifiedMode: undefined,
        additionalGrants: ["coworker_screen_read", "coworker_screen_drive"],
      },
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

  it("forwards a terminal tool policy into the agentic loop unchanged", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Done.", executedTools: [] } as never);
    const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");
    const terminalToolPolicy = {
      writerToolName: "record_initiative_evidence",
      readerToolNames: ["read_source_at_version", "search_source_at_version"],
      minimumSuccessfulReaderCalls: 1,
      maximumReaderCalls: 6,
    } as const;

    await executeAutonomousAgenticLoop({
      systemPrompt: "Review the immutable artifact.",
      chatHistory: [{ role: "user", content: "Review it." }],
      sensitivity: "internal",
      tools: [],
      toolsForProvider: [],
      userId: "user-1",
      routeContext: "/build/work/WC-1",
      agentId: "AGT-WS-BUILD",
      threadId: "thread-1",
      terminalToolPolicy,
    });

    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ terminalToolPolicy }),
    );
  });

  it("preserves development as a routing sensitivity through the unified loop", async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "Done.", executedTools: [] } as never);

    const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");

    await executeAutonomousAgenticLoop({
      systemPrompt: "You are helpful.",
      chatHistory: [{ role: "user", content: "Implement the change." }],
      sensitivity: "development",
      tools: [],
      toolsForProvider: [],
      userId: "user-1",
      routeContext: "/build",
      agentId: "build-specialist",
      threadId: "thread-1",
    });

    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivity: "development" }),
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
      tokenScope: "write",
    });

    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-MCP-ABCDEF12",
        apiTokenId: "tok_remote",
        tokenScope: "write",
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
