import Link from "next/link";
import { prisma } from "@dpf/db";
import { AgentGovernanceCard } from "@/components/ea/AgentGovernanceCard";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 - Orchestrators",
  2: "Tier 2 - Specialists",
  3: "Tier 3 - Cross-cutting",
};

export default async function AiAgentsPage() {
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
  const byTier = new Map(tiers.map((tier) => [tier, agents.filter((agent) => agent.tier === tier)]));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/platform/ai" style={{ color: "#b0b0c8", fontSize: 12 }}>
          &larr; AI Providers
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "6px 0 2px" }}>
          AI Workforce
        </h1>
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""} registered
        </p>
      </div>

      {tiers.map((tier) => {
        const tierAgents = byTier.get(tier) ?? [];
        if (tierAgents.length === 0) return null;

        return (
          <section key={tier} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              {TIER_LABELS[tier] ?? `Tier ${tier}`}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {tierAgents.map((agent) => (
                <AgentGovernanceCard
                  key={agent.id}
                  agent={{
                    id: agent.id,
                    agentId: agent.agentId,
                    name: agent.name,
                    description: agent.description,
                    tier: agent.tier,
                    portfolioName: agent.portfolio?.name ?? null,
                    portfolioSlug: agent.portfolio?.slug ?? null,
                    capabilityClassName: agent.governanceProfile?.capabilityClass.name ?? null,
                    autonomyLevel: agent.governanceProfile?.autonomyLevel ?? null,
                    owningTeamName: agent.ownerships[0]?.team.name ?? null,
                    activeGrantCount: agent.delegationGrants.length,
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
