import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: vi.fn() },
    agent: { findMany: vi.fn() },
    taskRun: { findMany: vi.fn(), aggregate: vi.fn() },
    toolExecution: { findMany: vi.fn(), aggregate: vi.fn() },
    toolExecutionReceipt: { findMany: vi.fn() },
    backlogItemActivity: { findMany: vi.fn() },
    externalEvidenceRecord: { findMany: vi.fn() },
    routeDecisionLog: { findMany: vi.fn(), aggregate: vi.fn() },
    routeOutcome: { findMany: vi.fn(), aggregate: vi.fn() },
    adapterRunTelemetry: { findMany: vi.fn() },
    providerCapacityStatus: { findMany: vi.fn() },
    agentMessage: { findMany: vi.fn() },
    modelProvider: { findMany: vi.fn() },
    modelProfile: { findMany: vi.fn() },
    tokenUsage: { findMany: vi.fn(), aggregate: vi.fn() },
    scheduledAgentTask: { findMany: vi.fn() },
    scheduledJob: { findMany: vi.fn() },
    delegationChain: { findMany: vi.fn() },
    phaseHandoff: { findMany: vi.fn() },
    deliberationRun: { findMany: vi.fn() },
    agentActionProposal: { findMany: vi.fn() },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/inference/phase-model-resolution", () => ({
  resolveModelSelectionByPhase: vi.fn().mockResolvedValue({
    generatedAt: "2026-06-28T20:00:00.000Z",
    phases: [],
  }),
}));

import { prisma } from "@dpf/db";

describe("AI operations map page", () => {
  it("renders the selected map with coworkers, tool pulses, and drill-down links", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-db-1",
        agentId: "build-specialist",
        slugId: "build-specialist",
        name: "Build Specialist",
        tier: 2,
        type: "specialist",
        description: "Implements scoped platform changes.",
        status: "active",
        valueStream: null,
        it4itSections: [],
        sensitivity: "internal",
        lifecycleStage: "production",
        _count: { skills: 3, toolGrants: 5 },
      },
    ] as never);

    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([
      {
        id: "tool-1",
        threadId: "thread-1",
        agentId: "build-specialist",
        userId: "user-1",
        toolName: "write_sandbox_file",
        success: false,
        executionMode: "immediate",
        routeContext: "build",
        durationMs: 120,
        createdAt: new Date("2026-05-10T12:00:00.000Z"),
        auditClass: "ledger",
        capabilityId: "platform:write_sandbox_file",
        summary: "Write blocked by policy",
      },
    ] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeDecisionLog.findMany).mockResolvedValue([
      {
        id: "decision-1",
        agentMessageId: "build-specialist",
        selectedEndpointId: "anthropic:claude-sonnet",
        taskType: "codegen",
        sensitivity: "confidential",
        reason: "Best fit for code review",
        fitnessScore: 0.91,
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
        createdAt: new Date("2026-05-10T12:01:00.000Z"),
        selectedModelId: "claude-sonnet",
      },
    ] as never);
    vi.mocked(prisma.agentMessage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([
      {
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
      },
    ] as never);
    vi.mocked(prisma.modelProfile.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tokenUsage.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.routeOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.adapterRunTelemetry.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledAgentTask.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduledJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.delegationChain.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.phaseHandoff.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.deliberationRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    const emptyCreatedBounds = { _min: { createdAt: null }, _max: { createdAt: null } };
    vi.mocked(prisma.routeDecisionLog.aggregate).mockResolvedValue(emptyCreatedBounds as never);
    vi.mocked(prisma.tokenUsage.aggregate).mockResolvedValue(emptyCreatedBounds as never);
    vi.mocked(prisma.routeOutcome.aggregate).mockResolvedValue(emptyCreatedBounds as never);
    vi.mocked(prisma.toolExecution.aggregate).mockResolvedValue(emptyCreatedBounds as never);
    vi.mocked(prisma.taskRun.aggregate).mockResolvedValue({ _min: { startedAt: null }, _max: { startedAt: null } } as never);

    const { default: OperationsMapPage } = await import("./page");
    const element = await OperationsMapPage({
      searchParams: Promise.resolve({
        mode: "compare",
        focus: "data-policy-gateway",
      }),
    });
    // The page now renders the live-refresh shell (BI-44D3203D); the loaded
    // snapshot arrives as its initialData prop.
    const props = element.props.initialData;

    expect(props.template.label).toBe("Generic Value Chain");
    expect(props.template.stations.map((station: { label: string }) => station.label)).toContain("Demand");
    expect(props.agents.map((agent: { name: string }) => agent.name)).toContain("Build Specialist");
    expect(props.projections.map((projection: { label: string }) => projection.label)).toContain("write_sandbox_file");
    expect(props.projections.map((projection: { summary: string }) => projection.summary)).toContain("Write blocked by policy");
    expect(props.projections[0].links.authorityHref).toBe("/platform/audit/ledger?toolExecutionId=tool-1");
    expect(props.projections[0].links.coworkerHref).toBe("/platform/ai/agent/build-specialist");
    expect(props.routingTopology.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ coworkerId: "build-specialist", providerId: "anthropic", state: "active" }),
      ]),
    );
    expect(props.recentWindowLabel).toBe("Last 40 records per evidence source");
    expect(element.props.initialArchitectureMode).toBe("compare");
    expect(element.props.initialFocusStageId).toBe("data-policy-gateway");
  });
});
