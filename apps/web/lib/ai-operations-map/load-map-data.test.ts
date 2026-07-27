import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveModelSelectionByPhase } = vi.hoisted(() => ({
  mockResolveModelSelectionByPhase: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    agent: {
      findMany: vi.fn(),
    },
    toolExecution: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    toolExecutionReceipt: {
      findMany: vi.fn(),
    },
    taskRun: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    backlogItemActivity: {
      findMany: vi.fn(),
    },
    externalEvidenceRecord: {
      findMany: vi.fn(),
    },
    routeDecisionLog: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    agentMessage: {
      findMany: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    modelProfile: {
      findMany: vi.fn(),
    },
    tokenUsage: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    routeOutcome: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    adapterRunTelemetry: { findMany: vi.fn() },
    providerCapacityStatus: { findMany: vi.fn() },
    scheduledAgentTask: {
      findMany: vi.fn(),
    },
    scheduledJob: {
      findMany: vi.fn(),
    },
    delegationChain: {
      findMany: vi.fn(),
    },
    phaseHandoff: {
      findMany: vi.fn(),
    },
    deliberationRun: {
      findMany: vi.fn(),
    },
    agentActionProposal: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/inference/phase-model-resolution", () => ({
  resolveModelSelectionByPhase: () => mockResolveModelSelectionByPhase(),
}));

import { prisma } from "@dpf/db";
import {
  RECENT_TOOL_LIMIT,
  WINDOWED_SOURCE_LIMIT,
  loadOperationsMapData,
  resolveEvidenceRange,
} from "./load-map-data";

describe("loadOperationsMapData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.agentMessage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProfile.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.adapterRunTelemetry.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.aggregate).mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } } as never);
    vi.mocked(prisma.tokenUsage.aggregate).mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } } as never);
    vi.mocked(prisma.routeOutcome.aggregate).mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } } as never);
    vi.mocked(prisma.toolExecution.aggregate).mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } } as never);
    vi.mocked(prisma.taskRun.aggregate).mockResolvedValue({ _min: { startedAt: null }, _max: { startedAt: null } } as never);
    mockResolveModelSelectionByPhase.mockResolvedValue({
      generatedAt: "2026-06-28T20:00:00.000Z",
      phases: [],
    });
    vi.mocked(prisma.delegationChain.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.phaseHandoff.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.deliberationRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
  });

  it("selects the map template from StorefrontConfig archetype truth", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      archetype: {
        archetypeId: "it-managed-services",
        activationProfile: {
          profileType: "managed-service-provider",
          modules: ["customer-estate", "service-agreements", "billing-readiness", "service-operations"],
        },
      },
    } as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([makeToolExecutionRow()] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    mockResolveModelSelectionByPhase.mockResolvedValue({
      generatedAt: "2026-06-28T20:00:00.000Z",
      phases: [],
    });

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("managed-service-provider");
    expect(data.agents[0].stationId).toBe("service-operations");
    expect(data.projections[0].location.stationId).toBe("service-operations");
    expect(data.recentWindowLabel).toBe("Last 40 records per evidence source");
    expect(prisma.storefrontConfig.findFirst).toHaveBeenCalledWith({
      include: {
        archetype: {
          select: {
            archetypeId: true,
            activationProfile: true,
          },
        },
      },
    });
  });

  it("falls back to the generic value-chain map when no storefront archetype is configured", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("generic-value-chain");
    expect(data.agents).toEqual([]);
    expect(data.projections).toEqual([]);
  });

  it("loads and chronologically merges receipts, backlog evidence, and external evidence", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([makeTaskRunRow()] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([makeToolExecutionRow()] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([makeReceiptRow()] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([makeBacklogEvidenceRow()] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([makeExternalEvidenceRow()] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.projections.map((projection) => projection.source)).toEqual([
      "evidence-external",
      "evidence-backlog",
      "tool-receipt",
      "task-run",
      "tool-execution",
    ]);
    expect(prisma.taskRun.findMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        source: "proactive",
      },
      orderBy: { startedAt: "desc" },
      take: 40,
      select: {
        id: true,
        taskRunId: true,
        status: true,
        source: true,
        currentAgentId: true,
        routeContext: true,
        title: true,
        startedAt: true,
        completedAt: true,
        a2aMetadata: true,
        repeatedPatternKey: true,
      },
    });
    expect(prisma.toolExecutionReceipt.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        toolExecutionId: true,
        buildId: true,
        receiptKind: true,
        receiptStatus: true,
        executionStatus: true,
        expiresAt: true,
        createdAt: true,
        toolExecution: {
          select: {
            id: true,
            threadId: true,
            agentId: true,
            userId: true,
            toolName: true,
            success: true,
            executionMode: true,
            routeContext: true,
            durationMs: true,
            createdAt: true,
            auditClass: true,
            capabilityId: true,
            summary: true,
          },
        },
      },
    });
    expect(prisma.backlogItemActivity.findMany).toHaveBeenCalledWith({
      where: { kind: "evidence" },
      orderBy: { recordedAt: "desc" },
      take: 40,
      select: {
        id: true,
        backlogItemId: true,
        kind: true,
        summary: true,
        payload: true,
        recordedAt: true,
        recordedById: true,
        recordedByAgentId: true,
        toolExecutionId: true,
        backlogItem: {
          select: {
            itemId: true,
          },
        },
      },
    });
    expect(prisma.externalEvidenceRecord.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        actorUserId: true,
        routeContext: true,
        operationType: true,
        target: true,
        provider: true,
        resultSummary: true,
        createdAt: true,
      },
    });
  });

  it("loads provider routing topology from decisions, spend, and future schedules", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([makeRouteDecisionRow()] as never);
    vi.mocked(prisma.agentMessage.findMany).mockResolvedValue([
      { id: "message-1", agentId: "support-specialist" },
    ] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([makeModelProviderRow()] as never);
    vi.mocked(prisma.modelProfile.findMany).mockResolvedValue([makeModelProfileRow()] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([makeTokenUsageRow()] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([makeRouteOutcomeRow()] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([makeScheduledAgentTaskRow()] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([makeScheduledJobRow()] as never);

    const data = await loadOperationsMapData();

    expect(data.routingTopology.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "anthropic", state: "active" }),
      ]),
    );
    expect(data.routingTopology.routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "scheduled" }),
      ]),
    );
    expect(data.routingTopology.providers.find((provider) => provider.providerId === "anthropic")).toEqual(
      expect.objectContaining({
        label: "Claude",
        costUsd: 1.5,
      }),
    );
    expect(data.routingTopology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "decision" }),
        expect.objectContaining({
          type: "scheduled",
          label: "Scheduled invocation",
          coworkerId: "support-specialist",
          providerId: null,
        }),
      ]),
    );
    expect(prisma.routeDecisionLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: expect.objectContaining({
        actorKind: true,
        actorId: true,
      }),
    }));
    expect(prisma.modelProvider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { name: "asc" },
    }));
    expect(prisma.modelProfile.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        providerId: true,
        modelId: true,
        friendlyName: true,
        modelStatus: true,
      },
    });
    expect(prisma.agentMessage.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["message-1"] } },
      select: {
        id: true,
        agentId: true,
      },
    });
    expect(prisma.tokenUsage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      take: 40,
    }));
    expect(prisma.routeOutcome.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 40,
    }));
    expect(prisma.scheduledAgentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true },
      orderBy: { nextRunAt: "asc" },
      take: 40,
    }));
    expect(prisma.scheduledJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { nextRunAt: "asc" },
      take: 40,
    }));
  });

  it("uses direct route decision agent attribution before message-id inference", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([
      makeRouteDecisionRow({ agentId: "support-specialist", agentMessageId: null }),
    ] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([makeModelProviderRow()] as never);
    vi.mocked(prisma.modelProfile.findMany).mockResolvedValue([makeModelProfileRow()] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.routingTopology.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coworkerId: "support-specialist",
          providerId: "anthropic",
          state: "active",
        }),
      ]),
    );
    expect(prisma.agentMessage.findMany).not.toHaveBeenCalled();
  });

  it("loads route outcome failures into provider routing topology", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([makeModelProviderRow({
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      status: "disabled",
    })] as never);
    vi.mocked(prisma.modelProfile.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([makeRouteOutcomeRow()] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.routingTopology.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "marker:outcome:outcome-claude-auth:error",
          type: "error",
          label: "Provider error",
          providerId: "anthropic-sub",
          summary: expect.stringContaining("auth"),
        }),
      ]),
    );
  });

  it("projects coworker-to-coworker A2A interactions from delegation and phase-handoff substrate", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      makeAgentRow(),
      { ...makeAgentRow(), id: "agent-db-2", agentId: "brand-analyst", slugId: "brand-analyst", name: "Brand Analyst" },
    ] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.delegationChain.findMany).mockResolvedValue([
      {
        id: "del-1",
        chainId: "chain-1",
        depth: 0,
        fromAgentId: "support-specialist",
        toAgentId: "brand-analyst",
        skillId: "brand-extract",
        authorityScope: ["brand:read"],
        status: "completed",
        reason: "Delegated brand extraction",
        startedAt: new Date("2026-06-04T10:00:00.000Z"),
        completedAt: new Date("2026-06-04T10:05:00.000Z"),
      },
    ] as never);
    vi.mocked(prisma.phaseHandoff.findMany).mockResolvedValue([
      {
        id: "ph-1",
        buildId: "FB-1",
        fromPhase: "plan",
        toPhase: "build",
        fromAgentId: "support-specialist",
        toAgentId: "brand-analyst",
        summary: "Plan approved.",
        gateResult: { passed: true, status: "advanced" },
        tokenBudgetUsed: 4200,
        createdAt: new Date("2026-06-04T11:00:00.000Z"),
      },
    ] as never);

    const data = await loadOperationsMapData();

    expect(data.routingTopology.a2aEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeKind: "a2a-delegation",
          fromCoworkerId: "support-specialist",
          toCoworkerId: "brand-analyst",
          state: "completed",
        }),
        expect.objectContaining({
          edgeKind: "a2a-handoff",
          fromCoworkerId: "support-specialist",
          toCoworkerId: "brand-analyst",
          state: "completed",
          buildId: "FB-1",
        }),
      ]),
    );
    expect(data.routingTopology.a2aLegend.map((item) => item.edgeKind)).toContain("a2a-delegation");
    // Brand Analyst appears as a coworker node even though it only received work.
    expect(data.routingTopology.coworkers.map((c) => c.agentId)).toContain("brand-analyst");
    expect(prisma.delegationChain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" }, take: 40 }),
    );
    expect(prisma.phaseHandoff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, take: 40 }),
    );
  });

  it("projects the deliberation lens with coordinator + branch model/provider from routeDecision", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.deliberationRun.findMany).mockResolvedValue([
      {
        id: "delib-1",
        diversityMode: "multi-provider-heterogeneous",
        consensusState: "partial-consensus",
        startedAt: new Date("2026-06-05T10:00:00.000Z"),
        taskRun: { currentAgentId: "support-specialist", initiatingAgentId: null },
        pattern: { name: "Diversity review" },
        branchNodes: [
          {
            id: "n1",
            workerRole: "reviewer",
            status: "completed",
            routeDecision: { selectedModelId: "claude-sonnet", selectedEndpoint: "anthropic:claude-sonnet" },
          },
          {
            id: "n2",
            workerRole: "skeptical_reviewer",
            status: "completed",
            routeDecision: { selectedModelId: "gpt-5", providerId: "openai" },
          },
        ],
      },
    ] as never);

    const data = await loadOperationsMapData();

    expect(data.routingTopology.deliberations).toEqual([
      expect.objectContaining({
        id: "delib-1",
        coordinatorCoworkerId: "support-specialist",
        coordinatorLabel: "Support Specialist",
        pattern: "Diversity review",
        diversityMode: "multi-provider-heterogeneous",
        consensusState: "partial-consensus",
      }),
    ]);
    expect(data.routingTopology.deliberations[0].branches).toEqual([
      { nodeId: "n1", role: "reviewer", modelId: "claude-sonnet", providerId: "anthropic", status: "completed" },
      { nodeId: "n2", role: "skeptical_reviewer", modelId: "gpt-5", providerId: "openai", status: "completed" },
    ]);
    expect(prisma.deliberationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" }, take: 40 }),
    );
    });

  it("windows every evidence source and raises the per-source cap when a window is provided (BI-40EFC7DE)", async () => {
    mockEmptySources();
    const window = {
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-06-15T00:00:00.000Z"),
    };

    const data = await loadOperationsMapData({ window });

    const createdAtWindow = { createdAt: { gte: window.start, lte: window.end } };
    expect(prisma.toolExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: createdAtWindow, take: WINDOWED_SOURCE_LIMIT }),
    );
    expect(prisma.routeDecisionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: createdAtWindow, take: WINDOWED_SOURCE_LIMIT }),
    );
    expect(prisma.tokenUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: createdAtWindow, take: WINDOWED_SOURCE_LIMIT }),
    );
    expect(prisma.routeOutcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(createdAtWindow),
        take: WINDOWED_SOURCE_LIMIT,
      }),
    );
    expect(prisma.taskRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: "proactive",
          startedAt: { gte: window.start, lte: window.end },
        }),
        take: WINDOWED_SOURCE_LIMIT,
      }),
    );
    expect(prisma.taskRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: null, status: "stalled" },
      }),
    );
    expect(data.queriedWindow).toEqual({
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-15T00:00:00.000Z",
    });
    expect(data.recentWindowLabel).toBe(
      `Up to ${WINDOWED_SOURCE_LIMIT} records per evidence source in the selected window`,
    );
  });

  it("keeps the newest-N default without a window and reports global evidence bounds", async () => {
    mockEmptySources();
    vi.mocked(prisma.routeDecisionLog.aggregate).mockResolvedValue({
      _min: { createdAt: new Date("2026-06-08T00:00:00.000Z") },
      _max: { createdAt: new Date("2026-07-01T00:00:00.000Z") },
    } as never);
    vi.mocked(prisma.toolExecution.aggregate).mockResolvedValue({
      _min: { createdAt: new Date("2026-06-10T00:00:00.000Z") },
      _max: { createdAt: new Date("2026-07-09T06:00:00.000Z") },
    } as never);

    const data = await loadOperationsMapData();

    expect(prisma.toolExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: RECENT_TOOL_LIMIT }),
    );
    expect(data.evidenceRange).toEqual({
      earliest: "2026-06-08T00:00:00.000Z",
      latest: "2026-07-09T06:00:00.000Z",
    });
    expect(data.queriedWindow).toBeNull();
    expect(data.recentWindowLabel).toBe("Last 40 records per evidence source");
  });
  });

describe("resolveEvidenceRange", () => {
  it("folds per-table bounds into the global min/max", () => {
    expect(
      resolveEvidenceRange([
        { min: new Date("2026-06-10T00:00:00.000Z"), max: new Date("2026-07-01T00:00:00.000Z") },
        { min: new Date("2026-06-08T00:00:00.000Z"), max: new Date("2026-06-20T00:00:00.000Z") },
        { min: null, max: null },
      ]),
    ).toEqual({
      earliest: "2026-06-08T00:00:00.000Z",
      latest: "2026-07-01T00:00:00.000Z",
    });
  });

  it("returns nulls for a fully empty install", () => {
    expect(resolveEvidenceRange([{ min: null, max: null }])).toEqual({
      earliest: null,
      latest: null,
    });
  });
});

function mockEmptySources() {
  vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);
}

function makeAgentRow() {
  return {
    id: "agent-db-1",
    agentId: "support-specialist",
    slugId: "support-specialist",
    name: "Support Specialist",
    tier: 2,
    type: "specialist",
    description: "Handles service operations.",
    status: "active",
    valueStream: "operate",
    it4itSections: [],
    sensitivity: "internal",
    lifecycleStage: "production",
    _count: { skills: 2, toolGrants: 4 },
  };
}

function makeToolExecutionRow() {
  return {
    id: "tool-1",
    threadId: "thread-1",
    agentId: "support-specialist",
    userId: "user-1",
    toolName: "diagnose_customer_estate",
    success: true,
    executionMode: "immediate",
    routeContext: "service-operations",
    durationMs: 80,
    createdAt: new Date("2026-05-10T12:00:00.000Z"),
    auditClass: "journal",
    capabilityId: "platform:diagnose_customer_estate",
    summary: "Checked service health",
  };
}

function makeTaskRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tr-1",
    taskRunId: "TR-SCHED-ABCDE",
    status: "working",
    source: "proactive",
    currentAgentId: "support-specialist",
    routeContext: "service-operations",
    title: "Discovery Taxonomy Gap Triage",
    startedAt: new Date("2026-05-10T12:00:30.000Z"),
    completedAt: null,
    a2aMetadata: null,
    repeatedPatternKey: null,
    ...overrides,
  };
}

function makeReceiptRow() {
  return {
    id: "receipt-1",
    toolExecutionId: "tool-1",
    buildId: "build-1",
    receiptKind: "sandbox-output",
    receiptStatus: "valid",
    executionStatus: "completed",
    expiresAt: new Date("2026-05-11T12:00:00.000Z"),
    createdAt: new Date("2026-05-10T12:01:00.000Z"),
    toolExecution: makeToolExecutionRow(),
  };
}

function makeBacklogEvidenceRow() {
  return {
    id: "activity-1",
    backlogItemId: "BI-123",
    kind: "evidence",
    summary: "UX verification completed",
    payload: {},
    recordedAt: new Date("2026-05-10T12:02:00.000Z"),
    recordedById: "user-1",
    recordedByAgentId: "support-specialist",
    toolExecutionId: "tool-1",
    backlogItem: { itemId: "BI-123" },
  };
}

function makeExternalEvidenceRow() {
  return {
    id: "external-1",
    actorUserId: "user-1",
    routeContext: "release",
    operationType: "ci-check",
    target: "pull-request",
    provider: "github",
    resultSummary: "CI checks passed",
    createdAt: new Date("2026-05-10T12:03:00.000Z"),
  };
}

function makeRouteDecisionRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeRouteDecisionRowBase(),
    ...overrides,
  };
}

function makeRouteDecisionRowBase() {
  return {
    id: "decision-1",
    agentMessageId: "message-1",
    agentId: null,
    actorKind: "legacy_unattributed",
    actorId: "legacy-route-decision-log",
    selectedEndpointId: "anthropic:claude-sonnet",
    taskType: "reasoning",
    sensitivity: "confidential",
    reason: "Best fit for reasoning",
    fitnessScore: 0.92,
    candidateTrace: [
      {
        endpointId: "anthropic:claude-sonnet",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        excluded: false,
      },
    ],
    excludedTrace: [],
    policyRulesApplied: [],
    fallbackChain: [],
    fallbacksUsed: null,
    shadowMode: false,
    createdAt: new Date("2026-05-10T12:04:00.000Z"),
    selectedModelId: "claude-sonnet",
  };
}

function makeModelProviderRow(overrides: Partial<ReturnType<typeof makeModelProviderRowBase>> = {}) {
  return {
    ...makeModelProviderRowBase(),
    ...overrides,
  };
}

function makeModelProviderRowBase() {
  return {
    providerId: "anthropic",
    name: "Claude",
    status: "active",
    category: "external",
    baseUrl: "https://api.anthropic.com",
    endpointType: "llm",
    serviceKind: null,
    mcpTransport: null,
    cliEngine: "claude",
    recentFailureRate: 0,
  };
}

function makeRouteOutcomeRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeRouteOutcomeRowBase(),
    ...overrides,
  };
}

function makeRouteOutcomeRowBase() {
  return {
    id: "outcome-claude-auth",
    agentId: null,
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    taskType: "conversation",
    fallbackOccurred: false,
    providerErrorCode: "auth",
    createdAt: new Date("2026-05-14T23:40:03.698Z"),
  };
}

function makeModelProfileRow() {
  return {
    id: "anthropic:claude-sonnet",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    friendlyName: "Claude Sonnet",
    modelStatus: "active",
  };
}

function makeTokenUsageRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeTokenUsageRowBase(),
    ...overrides,
  };
}

function makeTokenUsageRowBase() {
  return {
    id: "usage-1",
    agentId: "support-specialist",
    providerId: "anthropic",
    contextKey: "thread-1",
    inputTokens: 1000,
    outputTokens: 500,
    inferenceMs: 1200,
    costUsd: 1.5,
    createdAt: new Date("2026-05-10T12:05:00.000Z"),
  };
}

function makeScheduledAgentTaskRow() {
  return {
    id: "schedule-1",
    taskId: "daily-triage",
    agentId: "support-specialist",
    title: "Daily provider routing triage",
    routeContext: "service-operations",
    isActive: true,
    nextRunAt: new Date("2026-05-10T15:00:00.000Z"),
    lastStatus: "ok",
  };
}

function makeScheduledJobRow() {
  return {
    id: "job-1",
    jobId: "provider-quota-reset",
    name: "Provider quota reset",
    nextRunAt: new Date("2026-05-10T16:00:00.000Z"),
    lastStatus: "ok",
  };
}
