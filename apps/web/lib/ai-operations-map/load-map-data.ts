import { prisma } from "@dpf/db";
import { getMapTemplate } from "./templates";
import { projectAgentsToStations, projectToolExecution } from "./project-events";
import type {
  OperationsMapAgent,
  OperationsMapProjection,
  OperationsMapTemplate,
  OperationsMapToolExecution,
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
  const [storefrontConfig, agents, toolExecutions] = await Promise.all([
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

  return {
    template,
    agents: projectAgentsToStations(mapAgents, template),
    projections: toolExecutions.map((row) => projectToolExecution(row as OperationsMapToolExecution, template)),
    recentWindowLabel: `Last ${RECENT_TOOL_LIMIT} tool executions`,
  };
}

function getActivationProfileType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileType = (value as { profileType?: unknown }).profileType;
  return typeof profileType === "string" ? profileType : null;
}
