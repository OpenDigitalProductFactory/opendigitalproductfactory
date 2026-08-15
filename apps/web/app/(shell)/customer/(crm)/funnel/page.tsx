// apps/web/app/(shell)/customer/funnel/page.tsx
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  OPEN_OPPORTUNITY_STAGES,
  type CrmTone,
} from "@/lib/crm/presentation";
import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";
import { OwnerFirstSummaryBand } from "@/components/owner-first/OwnerFirstSummary";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildWorkspaceStorefrontSummary } from "@/lib/owner-first/domain-summary";
import { isSimpleNavMode, NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";

function getFunnelWidthClass(width: number) {
  if (width >= 90) return "w-full";
  if (width >= 75) return "w-4/5";
  if (width >= 60) return "w-3/5";
  if (width >= 40) return "w-2/5";
  if (width >= 25) return "w-1/3";
  return "w-1/4";
}

export default async function FunnelPage() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [config, orgSettings] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: { archetype: { select: { name: true, ctaType: true, category: true } } },
    }),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);
  const baseCurrency = orgSettings?.baseCurrency ?? "USD";

  // Storefront interaction counts (top of funnel)
  const [bookings, inquiries, orders, donations] = await Promise.all([
    prisma.storefrontBooking.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontInquiry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontOrder.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontDonation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  // CRM pipeline stages
  const [engagements, opportunities, accountsByStatus] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true, _sum: { expectedValue: true } }),
    prisma.customerAccount.groupBy({ by: ["status"], _count: true, where: EXCLUDE_TOMBSTONED }),
  ]);

  const totalInteractions = bookings + inquiries + orders + donations;
  // Direct + reseller leads: accounts in the early relationship lifecycle (prospect/qualified).
  // These feed the top of funnel when there is no published storefront, so a direct- or
  // reseller-sourced pipeline is represented instead of a storefront we don't have (BI-9078F4EE).
  const accountCount = (status: string) =>
    accountsByStatus.find((a) => a.status === status)?._count ?? 0;
  const directLeads = accountCount("prospect") + accountCount("qualified");
  const hasStorefrontActivity = totalInteractions > 0;
  // Top of funnel is storefront interactions when a storefront is active, else direct/reseller leads.
  const topOfFunnel = hasStorefrontActivity ? totalInteractions : directLeads;
  const totalEngagements = engagements.reduce((s, e) => s + e._count, 0);
  const openOpps = opportunities.filter((o) =>
    OPEN_OPPORTUNITY_STAGES.includes(o.stage as (typeof OPEN_OPPORTUNITY_STAGES)[number]),
  );
  const totalOpenOpps = openOpps.reduce((s, o) => s + o._count, 0);
  const closedWon = opportunities.find((o) => o.stage === "closed_won")?._count ?? 0;
  const closedLost = opportunities.find((o) => o.stage === "closed_lost")?._count ?? 0;
  const wonValue = Number(opportunities.find((o) => o.stage === "closed_won")?._sum?.expectedValue ?? 0);

  // Conversion rates
  const convToEngagement = topOfFunnel > 0
    ? ((totalEngagements / topOfFunnel) * 100).toFixed(0)
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
  const topWidthBase = Math.max(topOfFunnel, 1);
  const funnelStages = [
    hasStorefrontActivity
      ? {
          label: "Storefront Interactions",
          count: totalInteractions,
          detail: `${ctaLabel}: ${primaryCount}`,
          convLabel: null as string | null,
          tone: "accent" as CrmTone,
          width: 100,
        }
      : {
          label: "Direct & Reseller Leads",
          count: directLeads,
          detail: `Prospects: ${accountCount("prospect")}, Qualified: ${accountCount("qualified")}`,
          convLabel: null as string | null,
          tone: "accent" as CrmTone,
          width: 100,
        },
    {
      label: "Engagements",
      count: totalEngagements,
      detail: engagements.map((e) => `${e.status}: ${e._count}`).join(", ") || "none",
      convLabel: convToEngagement ? `${convToEngagement}% conversion` : null,
      tone: "attention" as CrmTone,
      width: topOfFunnel > 0 ? Math.max(15, (totalEngagements / topOfFunnel) * 100) : 15,
    },
    {
      label: "Opportunities",
      count: totalOpenOpps + closedWon + closedLost,
      detail: openOpps.map((o) => `${o.stage}: ${o._count}`).join(", ") || "none",
      convLabel: convToOpp ? `${convToOpp}% conversion` : null,
      tone: "info" as CrmTone,
      width: topOfFunnel > 0 ? Math.max(10, ((totalOpenOpps + closedWon + closedLost) / topWidthBase) * 100) : 10,
    },
    {
      label: "Closed Won",
      count: closedWon,
      detail: wonValue > 0 ? `Value: ${formatRevenueAmount(wonValue, baseCurrency)}` : "no revenue yet",
      convLabel: winRate ? `${winRate}% win rate` : null,
      tone: "success" as CrmTone,
      width: topOfFunnel > 0 ? Math.max(5, (closedWon / topWidthBase) * 100) : 5,
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

  // Owner-first: turn the top-of-funnel storefront counts into concrete guest
  // follow-up work before the conversion-analysis view (BI-3BCAF95F). The funnel
  // 30-day counts stay below; these are the items still awaiting a response.
  const simple = isSimpleNavMode(
    resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
  );
  const [{ vocab }, pendingReservations, newInquiriesPending, pendingOrders] = await Promise.all([
    loadOwnerFirstContext(),
    prisma.storefrontBooking.count({ where: { status: "pending" } }),
    prisma.storefrontInquiry.count({ where: { status: "new" } }),
    prisma.storefrontOrder.count({ where: { status: "pending" } }),
  ]);
  const ownerSummary = buildWorkspaceStorefrontSummary(
    { pendingReservations, newInquiries: newInquiriesPending, pendingOrders },
    vocab,
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Conversion Funnel</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {config?.archetype?.name ?? "Unknown business"} — last 30 days
        </p>
      </div>

      {/* Owner-first: guest work waiting on a response, before the analysis. */}
      <OwnerFirstSummaryBand summary={ownerSummary} density={simple ? "simple" : "full"} />

      {/* Funnel visualisation */}
      <div className="space-y-3 mb-6">
        {funnelStages.map((stage) => {
          const toneClasses = CRM_TONE_CLASSES[stage.tone];
          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[var(--dpf-text)]">{stage.label}</span>
                {stage.convLabel && (
                  <span className="text-[10px] text-[var(--dpf-muted)]">{stage.convLabel}</span>
                )}
              </div>
              <div className="relative">
                <div
                  className={[
                    "flex h-10 min-w-[120px] items-center rounded-md border-l-4 px-3 transition-all",
                    getFunnelWidthClass(stage.width),
                    toneClasses.border,
                    toneClasses.surface,
                  ].join(" ")}
                >
                  <span className="text-sm font-bold text-[var(--dpf-text)] mr-2">{stage.count}</span>
                  <span className="text-[10px] text-[var(--dpf-muted)] truncate">{stage.detail}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weakest point callout */}
      {weakest && Number(weakest.rate) < 50 && (
        <div className="p-3 rounded-lg border-l-2 border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-6">
          <p className="text-xs font-medium text-[var(--dpf-text)]">
            Weakest conversion point
          </p>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {weakest.stage} at {weakest.rate}% — this is where the biggest drop-off occurs
          </p>
        </div>
      )}

      {/* Pipeline + inbox breakdown — the analyst detail. Simple mode drops it to
          reduce body content (BI-3BCAF95F). */}
      {!simple && (
        <>
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Pipeline by Stage</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {opportunities.map((o) => {
            const meta = getOpportunityStageMeta(o.stage);
            const toneClasses = CRM_TONE_CLASSES[meta.tone];
            const value = Number(o._sum?.expectedValue ?? 0);
            return (
              <div
                key={o.stage}
                className={[
                  "p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-2",
                  toneClasses.border,
                ].join(" ")}
              >
                <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                  {meta.label}
                </p>
                <p className="text-lg font-bold text-[var(--dpf-text)]">{o._count}</p>
                {value > 0 && (
                  <p className={["text-[10px]", toneClasses.text].join(" ")}>
                    {formatRevenueAmount(value, baseCurrency)}
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
            { label: "Bookings", count: bookings, tone: "accent" as CrmTone },
            { label: "Inquiries", count: inquiries, tone: "attention" as CrmTone },
            { label: "Orders", count: orders, tone: "success" as CrmTone },
            { label: "Donations", count: donations, tone: "info" as CrmTone },
          ].map((item) => {
            const toneClasses = CRM_TONE_CLASSES[item.tone];
            return (
              <div
                key={item.label}
                className={[
                  "p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-2",
                  toneClasses.border,
                ].join(" ")}
              >
                <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                  {item.label}
                </p>
                <p className="text-lg font-bold text-[var(--dpf-text)]">{item.count}</p>
              </div>
            );
          })}
        </div>
      </div>
        </>
      )}

      {topOfFunnel === 0 && totalOpenOpps + closedWon + closedLost === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] mt-4">
          No pipeline yet. Add an account or publish a storefront to begin.
        </p>
      )}
      {topOfFunnel > 0 && !hasStorefrontActivity && (
        <p className="text-xs text-[var(--dpf-muted)] mt-4">
          Top of funnel: direct &amp; reseller leads (accounts in early lifecycle stages).
        </p>
      )}
    </div>
  );
}
