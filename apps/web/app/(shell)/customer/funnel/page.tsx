// apps/web/app/(shell)/customer/funnel/page.tsx
import { prisma } from "@dpf/db";

const STAGE_COLOURS: Record<string, string> = {
  qualification: "#fbbf24",
  discovery: "#fb923c",
  proposal: "#38bdf8",
  negotiation: "#a78bfa",
  closed_won: "#4ade80",
  closed_lost: "#ef4444",
};

export default async function FunnelPage() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Load archetype for CTA-aware labelling
  const config = await prisma.storefrontConfig.findFirst({
    include: { archetype: { select: { name: true, ctaType: true, category: true } } },
  });

  // Storefront interaction counts (top of funnel)
  const [bookings, inquiries, orders, donations] = await Promise.all([
    prisma.storefrontBooking.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontInquiry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontOrder.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontDonation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  // CRM pipeline stages
  const [engagements, opportunities] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true, _sum: { expectedValue: true } }),
  ]);

  const totalInteractions = bookings + inquiries + orders + donations;
  const totalEngagements = engagements.reduce((s, e) => s + e._count, 0);
  const openStages = ["qualification", "discovery", "proposal", "negotiation"];
  const openOpps = opportunities.filter((o) => openStages.includes(o.stage));
  const totalOpenOpps = openOpps.reduce((s, o) => s + o._count, 0);
  const closedWon = opportunities.find((o) => o.stage === "closed_won")?._count ?? 0;
  const closedLost = opportunities.find((o) => o.stage === "closed_lost")?._count ?? 0;
  const wonValue = Number(opportunities.find((o) => o.stage === "closed_won")?._sum?.expectedValue ?? 0);

  // Conversion rates
  const convToEngagement = totalInteractions > 0
    ? ((totalEngagements / totalInteractions) * 100).toFixed(0)
    : null;
  const convToOpp = totalEngagements > 0
    ? (((totalOpenOpps + closedWon + closedLost) / totalEngagements) * 100).toFixed(0)
    : null;
  const winRate = (totalOpenOpps + closedWon + closedLost) > 0
    ? ((closedWon / (totalOpenOpps + closedWon + closedLost)) * 100).toFixed(0)
    : null;

  const ctaType = config?.archetype?.ctaType ?? "inquiry";
  const ctaLabel = ctaType === "booking" ? "Bookings" : ctaType === "purchase" ? "Orders" : ctaType === "donation" ? "Donations" : "Inquiries";

  // Determine primary metric for this archetype
  const primaryCount = ctaType === "booking" ? bookings : ctaType === "purchase" ? orders : ctaType === "donation" ? donations : inquiries;

  // Funnel stages data
  const funnelStages = [
    {
      label: "Storefront Interactions",
      count: totalInteractions,
      detail: `${ctaLabel}: ${primaryCount}`,
      convLabel: null as string | null,
      color: "#f472b6",
      width: 100,
    },
    {
      label: "Engagements",
      count: totalEngagements,
      detail: engagements.map((e) => `${e.status}: ${e._count}`).join(", ") || "none",
      convLabel: convToEngagement ? `${convToEngagement}% conversion` : null,
      color: "#fb923c",
      width: totalInteractions > 0 ? Math.max(15, (totalEngagements / totalInteractions) * 100) : 15,
    },
    {
      label: "Opportunities",
      count: totalOpenOpps + closedWon + closedLost,
      detail: openOpps.map((o) => `${o.stage}: ${o._count}`).join(", ") || "none",
      convLabel: convToOpp ? `${convToOpp}% conversion` : null,
      color: "var(--dpf-accent)",
      width: totalInteractions > 0 ? Math.max(10, ((totalOpenOpps + closedWon + closedLost) / Math.max(totalInteractions, 1)) * 100) : 10,
    },
    {
      label: "Closed Won",
      count: closedWon,
      detail: wonValue > 0 ? `Value: $${wonValue.toLocaleString()}` : "no revenue yet",
      convLabel: winRate ? `${winRate}% win rate` : null,
      color: "#4ade80",
      width: totalInteractions > 0 ? Math.max(5, (closedWon / Math.max(totalInteractions, 1)) * 100) : 5,
    },
  ];

  // Find the weakest conversion point
  const convRates = [
    { stage: "Interactions to Engagements", rate: convToEngagement },
    { stage: "Engagements to Opportunities", rate: convToOpp },
    { stage: "Opportunities to Won", rate: winRate },
  ].filter((c) => c.rate !== null);

  const weakest = convRates.length > 0
    ? convRates.reduce((min, c) => (Number(c.rate) < Number(min.rate) ? c : min))
    : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Conversion Funnel</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {config?.archetype?.name ?? "Unknown business"} — last 30 days
        </p>
      </div>

      {/* Funnel visualisation */}
      <div className="space-y-3 mb-6">
        {funnelStages.map((stage) => (
          <div key={stage.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--dpf-text)]">{stage.label}</span>
              {stage.convLabel && (
                <span className="text-[10px] text-[var(--dpf-muted)]">{stage.convLabel}</span>
              )}
            </div>
            <div className="relative">
              <div
                className="h-10 rounded-md flex items-center px-3 transition-all"
                style={{
                  width: `${stage.width}%`,
                  background: `${stage.color}20`,
                  borderLeft: `3px solid ${stage.color}`,
                  minWidth: 120,
                }}
              >
                <span className="text-sm font-bold text-[var(--dpf-text)] mr-2">{stage.count}</span>
                <span className="text-[10px] text-[var(--dpf-muted)] truncate">{stage.detail}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Weakest point callout */}
      {weakest && Number(weakest.rate) < 50 && (
        <div
          className="p-3 rounded-lg border-l-2 mb-6"
          style={{
            background: "var(--dpf-surface-1)",
            borderLeftColor: "#ef4444",
          }}
        >
          <p className="text-xs font-medium text-[var(--dpf-text)]">
            Weakest conversion point
          </p>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {weakest.stage} at {weakest.rate}% — this is where the biggest drop-off occurs
          </p>
        </div>
      )}

      {/* Pipeline breakdown by stage */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Pipeline by Stage</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {opportunities.map((o) => {
            const colour = STAGE_COLOURS[o.stage] ?? "#8888a0";
            const value = Number(o._sum?.expectedValue ?? 0);
            return (
              <div
                key={o.stage}
                className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-2"
                style={{ borderLeftColor: colour }}
              >
                <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                  {o.stage.replace(/_/g, " ")}
                </p>
                <p className="text-lg font-bold text-[var(--dpf-text)]">{o._count}</p>
                {value > 0 && (
                  <p className="text-[10px]" style={{ color: colour }}>
                    ${value.toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inbox breakdown */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Storefront Inbox (30d)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Bookings", count: bookings, color: "#a78bfa" },
            { label: "Inquiries", count: inquiries, color: "#fb923c" },
            { label: "Orders", count: orders, color: "#4ade80" },
            { label: "Donations", count: donations, color: "#f472b6" },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-2"
              style={{ borderLeftColor: item.color }}
            >
              <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                {item.label}
              </p>
              <p className="text-lg font-bold text-[var(--dpf-text)]">{item.count}</p>
            </div>
          ))}
        </div>
      </div>

      {totalInteractions === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] mt-4">
          No storefront interactions in the last 30 days. Set up and publish your storefront to start receiving customer interactions.
        </p>
      )}
    </div>
  );
}
