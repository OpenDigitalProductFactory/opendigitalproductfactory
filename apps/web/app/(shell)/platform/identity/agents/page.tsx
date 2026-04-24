import { prisma } from "@dpf/db";
import { AgentIdentityPanel } from "@/components/platform/identity/AgentIdentityPanel";

export default async function PlatformIdentityAgentsPage() {
  const [agents, aliases] = await Promise.all([
    prisma.agent.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        agentId: true,
        name: true,
        status: true,
        lifecycleStage: true,
        humanSupervisorId: true,
      },
    }),
    prisma.principalAlias.findMany({
      where: { aliasType: "agent", issuer: "" },
      orderBy: { aliasValue: "asc" },
    }),
  ]);

  const principalIdByAgentId = new Map(
    aliases.map((alias) => [alias.aliasValue, alias.principalId]),
  );

  return (
    <AgentIdentityPanel
      agents={agents.map((agent) => ({
        ...agent,
        linkedPrincipalId: principalIdByAgentId.get(agent.agentId) ?? null,
      }))}
    />
  );
}
