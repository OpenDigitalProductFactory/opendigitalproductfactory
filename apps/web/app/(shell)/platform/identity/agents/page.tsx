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
      where: { aliasType: { in: ["agent", "gaid"] }, issuer: "" },
      orderBy: { aliasValue: "asc" },
    }),
  ]);

  const principalIdByAgentId = new Map(
    aliases
      .filter((alias) => alias.aliasType === "agent")
      .map((alias) => [alias.aliasValue, alias.principalId]),
  );
  const gaidByPrincipalId = new Map(
    aliases
      .filter((alias) => alias.aliasType === "gaid")
      .map((alias) => [alias.principalId, alias.aliasValue]),
  );

  return (
    <AgentIdentityPanel
      agents={agents.map((agent) => {
        const linkedPrincipalId = principalIdByAgentId.get(agent.agentId) ?? null;

        return {
          ...agent,
          linkedPrincipalId,
          gaid: linkedPrincipalId ? gaidByPrincipalId.get(linkedPrincipalId) ?? null : null,
        };
      })}
    />
  );
}
