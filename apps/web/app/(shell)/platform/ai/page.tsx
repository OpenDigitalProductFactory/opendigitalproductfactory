// apps/web/app/(shell)/platform/ai/page.tsx — AI Workforce (default landing)
import { prisma } from "@dpf/db";
import { AgentGovernanceCard } from "@/components/ea/AgentGovernanceCard";
import { AgentProviderSelect } from "@/components/platform/AgentProviderSelect";
import { AiTabNav } from "@/components/platform/AiTabNav";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 - Orchestrators",
  2: "Tier 2 - Specialists",
  3: "Tier 3 - Cross-cutting",
};

export default async function PlatformAiPage() {
  const now = new Date();
  const [agents, providers] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      select: {
        id: true,
        agentId: true,
        name: true,
        tier: true,
        description: true,
        preferredProviderId: true,
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
    }),
    prisma.modelProvider.findMany({
      where: { status: { in: ["active", "inactive"] } },
      orderBy: { name: "asc" },
      select: { providerId: true, name: true, status: true },
    }),
  ]);

  const tiers = [1, 2, 3] as const;
  const byTier = new Map(tiers.map((tier) => [tier, agents.filter((agent) => agent.tier === tier)]));

  // Build provider status lookup for agent health indicators
  const providerStatusMap = new Map(providers.map((p) => [p.providerId, p.status]));
  const agentsWithBrokenProviders = agents.filter((a) => {
    if (!a.preferredProviderId) return false;
    const status = providerStatusMap.get(a.preferredProviderId);
    return status === "inactive" || status === undefined;
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>
          AI Workforce
        </h1>
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""} registered
        </p>
      </div>

      <AiTabNav />

      {agentsWithBrokenProviders.length > 0 && (
        <div style={{
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>&#9888;</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24" }}>
              {agentsWithBrokenProviders.length} agent{agentsWithBrokenProviders.length !== 1 ? "s have" : " has"} an inactive provider
            </div>
            <div style={{ fontSize: 11, color: "#b0b0c8", marginTop: 2 }}>
              {agentsWithBrokenProviders.map((a) => a.name).join(", ")} — these agents will fall back to auto-routing which may use a less suitable model.
            </div>
          </div>
        </div>
      )}

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
                <div key={agent.id}>
                  <AgentGovernanceCard
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AgentProviderSelect
                      agentId={agent.agentId}
                      currentProviderId={agent.preferredProviderId}
                      providers={providers}
                    />
                    {agent.preferredProviderId && providerStatusMap.get(agent.preferredProviderId) === "inactive" && (
                      <span style={{
                        fontSize: 10,
                        color: "#fbbf24",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(251,191,36,0.1)",
                        border: "1px solid rgba(251,191,36,0.3)",
                        whiteSpace: "nowrap",
                      }}>
                        provider inactive
                      </span>
                    )}
                  </div>
                </div>
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
