// apps/web/app/(shell)/ea/agents/page.tsx
import { prisma } from "@dpf/db";
import { AgentGovernanceCard } from "@/components/ea/AgentGovernanceCard";
import { EaTabNav } from "@/components/ea/EaTabNav";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 - Orchestrators",
  2: "Tier 2 - Specialists",
  3: "Tier 3 - Cross-cutting",
};

export default async function EaAgentsPage() {
  const now = new Date();
  const agents = await prisma.agent.findMany({
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    select: {
      id: true,
      agentId: true,
      name: true,
      tier: true,
      description: true,
      portfolio: { select: { slug: true, name: true } },
      ownerships: {
        where: { responsibility: "owning_team" },
        select: { team: { select: { name: true } } },
        take: 1,
      },
      governanceProfile: {
        select: {
          autonomyLevel: true,
          capabilityClass: { select: { name: true } },
        },
      },
      delegationGrants: {
        where: {
          status: "active",
          expiresAt: { gt: now },
        },
        select: { id: true },
      },
    },
  });

  const tiers = [1, 2, 3] as const;
  const byTier = new Map(tiers.map((t) => [t, agents.filter((a) => a.tier === t)]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Enterprise Architecture</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </p>
      </div>

      <EaTabNav />

      {tiers.map((t) => {
        const tierAgents = byTier.get(t) ?? [];
        if (tierAgents.length === 0) return null;
        const tierLabel = TIER_LABELS[t] ?? `Tier ${t}`;

        return (
          <section key={t} className="mb-8">
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              {tierLabel}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tierAgents.map((a) => (
                <AgentGovernanceCard
                  key={a.id}
                  agent={{
                    id: a.id,
                    agentId: a.agentId,
                    name: a.name,
                    description: a.description,
                    tier: a.tier,
                    portfolioName: a.portfolio?.name ?? null,
                    portfolioSlug: a.portfolio?.slug ?? null,
                    capabilityClassName: a.governanceProfile?.capabilityClass.name ?? null,
                    autonomyLevel: a.governanceProfile?.autonomyLevel ?? null,
                    owningTeamName: a.ownerships[0]?.team.name ?? null,
                    activeGrantCount: a.delegationGrants.length,
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}

      {agents.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No agents registered yet.</p>
      )}
    </div>
  );
}
