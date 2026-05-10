import { prisma } from "@dpf/db";
import { AiOperationsMap } from "@/components/platform/AiOperationsMap";
import { SOFTWARE_PLATFORM_MAP_TEMPLATE } from "@/lib/ai-operations-map/templates";
import { projectAgentsToStations, projectToolExecution } from "@/lib/ai-operations-map/project-events";
import type { OperationsMapAgent, OperationsMapToolExecution } from "@/lib/ai-operations-map/types";

const RECENT_TOOL_LIMIT = 40;

export default async function OperationsMapPage() {
  const [agents, toolExecutions] = await Promise.all([
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

  const projectedAgents = projectAgentsToStations(mapAgents, SOFTWARE_PLATFORM_MAP_TEMPLATE);
  const projections = toolExecutions.map((row) =>
    projectToolExecution(row as OperationsMapToolExecution),
  );

  return (
    <AiOperationsMap
      template={SOFTWARE_PLATFORM_MAP_TEMPLATE}
      agents={projectedAgents}
      projections={projections}
      recentWindowLabel={`Last ${RECENT_TOOL_LIMIT} tool executions`}
    />
  );
}
