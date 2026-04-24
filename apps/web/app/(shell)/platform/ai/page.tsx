// apps/web/app/(shell)/platform/ai/page.tsx — AI Workforce (default landing)
import { prisma } from "@dpf/db";
import Link from "next/link";
import { AgentGovernanceCard } from "@/components/ea/AgentGovernanceCard";
import { AgentProviderSelect } from "@/components/platform/AgentProviderSelect";
import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 - Orchestrators",
  2: "Tier 2 - Specialists",
  3: "Tier 3 - Cross-cutting",
};

export default async function PlatformAiPage() {
  const now = new Date();
  const [agents, providers, modelConfigs] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      select: {
        id: true,
        agentId: true,
        slugId: true,
        name: true,
        tier: true,
        description: true,
        valueStream: true,
        sensitivity: true,
        lifecycleStage: true,
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
        _count: {
          select: {
            skills: true,
            toolGrants: true,
            performanceProfiles: true,
            degradationMappings: true,
          },
        },
      },
    }),
    prisma.modelProvider.findMany({
      where: { status: { in: ["active", "inactive"] } },
      orderBy: { name: "asc" },
      select: { providerId: true, name: true, status: true },
    }),
    // EP-AI-WORKFORCE-001: Read pinned providers from AgentModelConfig
    prisma.agentModelConfig.findMany({
      select: { agentId: true, pinnedProviderId: true },
    }),
  ]);

  // Build pinned provider lookup (keyed by slug/agentId)
  const pinnedProviderBySlug = new Map(modelConfigs.map((c) => [c.agentId, c.pinnedProviderId]));

  const grantSummaries = await getAgentGrantSummaries();
  const grantLookup = new Map(grantSummaries.map(g => [g.agentId, g]));
  const gaidByAgentId = await getAgentGaidMap(agents.map((agent) => agent.agentId));

  const tiers = [1, 2, 3] as const;
  const byTier = new Map(tiers.map((tier) => [tier, agents.filter((agent) => agent.tier === tier)]));

  // Build provider status lookup for agent health indicators
  const providerStatusMap = new Map(providers.map((p) => [p.providerId, p.status]));
  const agentsWithBrokenProviders = agents.filter((a) => {
    const pinnedId = pinnedProviderBySlug.get(a.slugId ?? a.agentId) ?? null;
    if (!pinnedId) return false;
    const status = providerStatusMap.get(pinnedId);
    return status === "inactive" || status === undefined;
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          AI Workforce
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""} registered
        </p>
      </div>

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
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
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
                  <Link
                    href={`/platform/ai/agent/${encodeURIComponent(agent.agentId)}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
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
                        grantCount: grantLookup.get(agent.agentId)?.grantCount ?? 0,
                        hitlTier: grantLookup.get(agent.agentId)?.hitlTier ?? null,
                        escalatesTo: grantLookup.get(agent.agentId)?.escalatesTo ?? null,
                      }}
                    />
                  </Link>
                  {/* EP-AI-WORKFORCE-001: Unified agent metadata badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {agent.valueStream && (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 4,
                        background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)",
                        color: "#60a5fa",
                      }}>
                        {agent.valueStream}
                      </span>
                    )}
                    {agent._count.skills > 0 && (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 4,
                        background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)",
                        color: "#34d399",
                      }}>
                        {agent._count.skills} skill{agent._count.skills !== 1 ? "s" : ""}
                      </span>
                    )}
                    {agent._count.toolGrants > 0 && (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 4,
                        background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
                        color: "#fbbf24",
                      }}>
                        {agent._count.toolGrants} grant{agent._count.toolGrants !== 1 ? "s" : ""}
                      </span>
                    )}
                    <AgentProviderSelect
                      agentId={agent.agentId}
                      currentProviderId={pinnedProviderBySlug.get(agent.slugId ?? agent.agentId) ?? null}
                      providers={providers}
                    />
                    {pinnedProviderBySlug.get(agent.slugId ?? agent.agentId) && providerStatusMap.get(pinnedProviderBySlug.get(agent.slugId ?? agent.agentId)!) === "inactive" && (
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
                  {gaidByAgentId.get(agent.agentId) ? (
                    <div
                      style={{
                        marginTop: 4,
                        color: "var(--dpf-muted)",
                        fontFamily: "monospace",
                        fontSize: 10,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {gaidByAgentId.get(agent.agentId)}
                    </div>
                  ) : null}
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
