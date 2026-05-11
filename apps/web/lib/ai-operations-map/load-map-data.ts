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
import type {
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
  recentWindowLabel: string;
};

export async function loadOperationsMapData(): Promise<OperationsMapData> {
  const [storefrontConfig, agents, taskRuns, toolExecutions, toolReceipts, backlogEvidence, externalEvidence] = await Promise.all([
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
  ]);

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

  return {
    template,
    agents: projectAgentsToStations(mapAgents, template),
    projections,
    recentWindowLabel: `Last ${RECENT_TOOL_LIMIT} records per evidence source`,
  };
}

function getActivationProfileType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileType = (value as { profileType?: unknown }).profileType;
  return typeof profileType === "string" ? profileType : null;
}
