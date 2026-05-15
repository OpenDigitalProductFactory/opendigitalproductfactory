import { prisma } from "@dpf/db";
import { getMapTemplate } from "./templates";
import {
  projectAgentsToStations,
  projectBacklogEvidence,
  projectExternalEvidence,
  projectTaskRun,
  projectToolExecution,
  projectToolExecutionReceipt,
} from "./project-events";
import { projectRoutingTopology } from "./project-routing-topology";
import type {
  OperationsMapRoutingTopology,
  OperationsMapAgent,
  OperationsMapBacklogEvidence,
  OperationsMapExternalEvidence,
  OperationsMapProjection,
  OperationsMapTaskRun,
  OperationsMapTemplate,
  OperationsMapToolExecution,
  OperationsMapToolExecutionReceipt,
  StationedOperationsMapAgent,
} from "./types";

export const RECENT_TOOL_LIMIT = 40;

export type OperationsMapData = {
  template: OperationsMapTemplate;
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  routingTopology: OperationsMapRoutingTopology;
  recentWindowLabel: string;
};

export async function loadOperationsMapData(): Promise<OperationsMapData> {
  const [
    storefrontConfig,
    agents,
    taskRuns,
    toolExecutions,
    toolReceipts,
    backlogEvidence,
    externalEvidence,
    routeDecisions,
    providers,
    modelProfiles,
    tokenUsage,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
  ] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: {
          select: {
            archetypeId: true,
            activationProfile: true,
          },
        },
      },
    }),
    prisma.agent.findMany({
      where: { archived: false },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      select: {
        id: true,
        agentId: true,
        slugId: true,
        name: true,
        tier: true,
        type: true,
        description: true,
        status: true,
        valueStream: true,
        it4itSections: true,
        sensitivity: true,
        lifecycleStage: true,
        _count: {
          select: {
            skills: true,
            toolGrants: true,
          },
        },
      },
    }),
    prisma.taskRun.findMany({
      where: {
        archivedAt: null,
        source: "proactive",
      },
      orderBy: { startedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
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
      },
    }),
    prisma.toolExecution.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
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
    }),
    prisma.toolExecutionReceipt.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
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
    }),
    prisma.backlogItemActivity.findMany({
      where: { kind: "evidence" },
      orderBy: { recordedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
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
    }),
    prisma.externalEvidenceRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
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
    }),
    prisma.routeDecisionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentMessageId: true,
        actorKind: true,
        actorId: true,
        agentId: true,
        selectedEndpointId: true,
        taskType: true,
        sensitivity: true,
        reason: true,
        fitnessScore: true,
        candidateTrace: true,
        excludedTrace: true,
        policyRulesApplied: true,
        fallbackChain: true,
        fallbacksUsed: true,
        shadowMode: true,
        createdAt: true,
        selectedModelId: true,
      },
    }),
    prisma.modelProvider.findMany({
      orderBy: { name: "asc" },
      select: {
        providerId: true,
        name: true,
        status: true,
        category: true,
        baseUrl: true,
        endpointType: true,
        serviceKind: true,
        mcpTransport: true,
        cliEngine: true,
        recentFailureRate: true,
      },
    }),
    prisma.modelProfile.findMany({
      select: {
        id: true,
        providerId: true,
        modelId: true,
        friendlyName: true,
        modelStatus: true,
      },
    }),
    prisma.tokenUsage.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentId: true,
        providerId: true,
        contextKey: true,
        inputTokens: true,
        outputTokens: true,
        inferenceMs: true,
        costUsd: true,
        createdAt: true,
      },
    }),
    prisma.routeOutcome.findMany({
      where: {
        OR: [
          { providerErrorCode: { not: null } },
          { fallbackOccurred: true },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentId: true,
        providerId: true,
        modelId: true,
        taskType: true,
        fallbackOccurred: true,
        providerErrorCode: true,
        createdAt: true,
      },
    }),
    prisma.scheduledAgentTask.findMany({
      where: { isActive: true },
      orderBy: { nextRunAt: "asc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        taskId: true,
        agentId: true,
        title: true,
        routeContext: true,
        isActive: true,
        nextRunAt: true,
        lastStatus: true,
      },
    }),
    prisma.scheduledJob.findMany({
      orderBy: { nextRunAt: "asc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        jobId: true,
        name: true,
        nextRunAt: true,
        lastStatus: true,
      },
    }),
  ]);

  const routeDecisionAgentMessageIds = [
    ...new Set(routeDecisions.map((decision) => decision.agentMessageId).filter((id): id is string => Boolean(id))),
  ];
  const routeDecisionAgentMessages = routeDecisionAgentMessageIds.length > 0
    ? await prisma.agentMessage.findMany({
      where: { id: { in: routeDecisionAgentMessageIds } },
      select: {
        id: true,
        agentId: true,
      },
    })
    : [];
  const routeDecisionAgentIdByMessageId = new Map(
    routeDecisionAgentMessages.map((message) => [message.id, message.agentId]),
  );

  const template = getMapTemplate({
    archetypeId: storefrontConfig?.archetype?.archetypeId ?? null,
    activationProfileType: getActivationProfileType(storefrontConfig?.archetype?.activationProfile),
  });

  const mapAgents: OperationsMapAgent[] = agents.map((agent) => ({
    id: agent.id,
    agentId: agent.agentId,
    slugId: agent.slugId,
    name: agent.name,
    tier: agent.tier,
    type: agent.type,
    description: agent.description,
    status: agent.status,
    valueStream: agent.valueStream,
    it4itSections: agent.it4itSections,
    sensitivity: agent.sensitivity,
    lifecycleStage: agent.lifecycleStage,
    counts: {
      skills: agent._count.skills,
      toolGrants: agent._count.toolGrants,
    },
  }));

  const projections = [
    ...taskRuns.map((row) => projectTaskRun(row as OperationsMapTaskRun, template)),
    ...toolExecutions.map((row) => projectToolExecution(row as OperationsMapToolExecution, template)),
    ...toolReceipts.map((row) => projectToolExecutionReceipt(row as OperationsMapToolExecutionReceipt, template)),
    ...backlogEvidence.map((row) => projectBacklogEvidence(row as OperationsMapBacklogEvidence, template)),
    ...externalEvidence.map((row) => projectExternalEvidence(row as OperationsMapExternalEvidence, template)),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));

  const stationedAgents = projectAgentsToStations(mapAgents, template);
  const routingTopology = projectRoutingTopology({
    agents: stationedAgents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      stationLabel: agent.stationLabel,
    })),
    providers,
    endpointProfiles: modelProfiles.map((profile) => ({
      endpointId: profile.id,
      providerId: profile.providerId,
      modelId: profile.modelId,
      friendlyName: profile.friendlyName,
      modelStatus: profile.modelStatus,
    })),
    routeDecisions: routeDecisions.map((decision) => ({
      ...decision,
      agentId: decision.agentId ?? (decision.agentMessageId ? routeDecisionAgentIdByMessageId.get(decision.agentMessageId) ?? null : null),
    })),
    tokenUsage,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
  });

  return {
    template,
    agents: stationedAgents,
    projections,
    routingTopology,
    recentWindowLabel: `Last ${RECENT_TOOL_LIMIT} records per evidence source`,
  };
}

function getActivationProfileType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileType = (value as { profileType?: unknown }).profileType;
  return typeof profileType === "string" ? profileType : null;
}
