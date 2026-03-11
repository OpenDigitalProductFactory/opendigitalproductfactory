// apps/web/app/(shell)/ea/page.tsx
import { prisma } from "@dpf/db";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Orchestrators",
  2: "Tier 2 — Specialists",
  3: "Tier 3 — Cross-cutting",
};

export default async function EaPage() {
  const agents = await prisma.agent.findMany({
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    select: {
      id: true,
      agentId: true,
      name: true,
      tier: true,
      type: true,
      description: true,
      portfolio: { select: { slug: true, name: true } },
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
              {tierAgents.map((a) => {
                const colour = a.portfolio
                  ? (PORTFOLIO_COLOURS[a.portfolio.slug] ?? "#555566")
                  : "#555566";

                return (
                  <div
                    key={a.id}
                    className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
                    style={{ borderLeftColor: colour }}
                  >
                    <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                      {a.agentId}
                    </p>
                    <p className="text-sm font-semibold text-white leading-tight mb-1">
                      {a.name}
                    </p>
                    {a.description != null && (
                      <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-1.5">
                        {a.description}
                      </p>
                    )}
                    {a.portfolio != null ? (
                      <p
                        className="text-[10px] font-medium"
                        style={{ color: colour }}
                      >
                        {a.portfolio.name}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[var(--dpf-muted)]">
                        Cross-cutting
                      </p>
                    )}
                  </div>
                );
              })}
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
