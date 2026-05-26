// apps/web/app/(shell)/customer/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { NewCustomerButton } from "@/components/customer/NewCustomerButton";
import { RevenueCockpit } from "@/components/customer/RevenueCockpit";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { buildRevenueCockpitSummary } from "@/lib/crm/revenue-cockpit";
import { getAccountStatusMeta } from "@/lib/crm/presentation";

export default async function CustomerPage() {
  const [
    accounts,
    engagementCounts,
    opportunityCounts,
    quoteCounts,
    orderCounts,
    staleOpportunityCount,
    campaignBriefsOpen,
    assetTasksOpen,
    automationCandidatesOpen,
  ] = await Promise.all([
    prisma.customerAccount.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        status: true,
        industry: true,
        _count: { select: { contacts: true, opportunities: true } },
      },
    }),
    prisma.engagement.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.opportunity.groupBy({
      by: ["stage"],
      _count: true,
      _sum: { expectedValue: true },
    }),
    prisma.quote.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.salesOrder.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.opportunity.count({
      where: {
        isDormant: true,
        stage: { in: ["qualification", "discovery", "proposal", "negotiation"] },
      },
    }),
    prisma.marketingCampaignBrief.count({
      where: { status: "draft" },
    }),
    prisma.marketingAssetTask.count({
      where: { status: "draft" },
    }),
    prisma.marketingAutomationCandidate.count({
      where: { status: "draft" },
    }),
  ]);

  const revenueSummary = buildRevenueCockpitSummary({
    engagementCounts: engagementCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    opportunityCounts: opportunityCounts.map((item) => ({
      stage: item.stage,
      count: item._count,
      expectedValue: Number(item._sum.expectedValue ?? 0),
    })),
    quoteCounts: quoteCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    orderCounts: orderCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    staleOpportunityCount,
    marketingWork: {
      campaignBriefsOpen,
      assetTasksOpen,
      automationCandidatesOpen,
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Customer</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <NewCustomerButton />
      </div>

      <RevenueCockpit summary={revenueSummary} />

      {/* Account list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accounts.map((a) => {
          const statusMeta = getAccountStatusMeta(a.status);
          return (
            <Link
              key={a.id}
              href={`/customer/${a.id}`}
              className="rounded-lg border-l-4 border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]"
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {a.accountId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight">
                  {a.name}
                </p>
                <CustomerStatusBadge
                  label={statusMeta.label}
                  tone={statusMeta.tone}
                />
              </div>
              <div className="flex gap-3 text-[9px] text-[var(--dpf-muted)]">
                <span>{a._count.contacts} contact{a._count.contacts !== 1 ? "s" : ""}</span>
                {a._count.opportunities > 0 && (
                  <span>{a._count.opportunities} opportunit{a._count.opportunities !== 1 ? "ies" : "y"}</span>
                )}
                {a.industry && <span>{a.industry}</span>}
              </div>
            </Link>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No accounts registered yet.</p>
      )}
    </div>
  );
}
