// apps/web/app/(shell)/customer/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";
import { OwnerFirstSummaryBand } from "@/components/owner-first/OwnerFirstSummary";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildCustomerOwnerSummary } from "@/lib/owner-first/domain-summary";
import { resolveCustomerSurface } from "@/lib/owner-first/archetype-surface";
import { isSimpleNavMode, NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { NewCustomerButton } from "@/components/customer/NewCustomerButton";
import { DuplicateAccountsPanel } from "@/components/customer/DuplicateAccountsPanel";
import { RevenueCockpit } from "@/components/customer/RevenueCockpit";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { buildRevenueCockpitSummary } from "@/lib/crm/revenue-cockpit";
import { getWorkspaceRetainMetrics } from "@/lib/crm/retain-data";
import {
  CRM_TONE_CLASSES,
  getAccountStatusMeta,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import {
  classifyAccountAttention,
  sortAccountsByAttention,
} from "@/lib/crm/account-attention";
import {
  PlatformGridSection,
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/components/workbooks/PlatformGridSection";

export default async function CustomerPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; dataScope?: string }>;
}) {
  const sp = await searchParams;
  const view = parseSurfaceView(sp?.view);
  const dataScope = parseSurfaceDataScope(sp?.dataScope);
  // Kick off the retain rollup in parallel with the main batch (avoids a serial round-trip).
  const retainPromise = getWorkspaceRetainMetrics();
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
    orgSettings,
    renewalsDueSoonCount,
    overdueInvoiceCount,
  ] = await Promise.all([
    prisma.customerAccount.findMany({
      where: EXCLUDE_TOMBSTONED,
      orderBy: { name: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        status: true,
        industry: true,
        createdAt: true,
        _count: { select: { contacts: true, opportunities: true } },
        // Open opportunities carry the dormancy + expected-close signals.
        opportunities: {
          where: { stage: { in: [...OPEN_OPPORTUNITY_STAGES] } },
          select: { stage: true, isDormant: true, expectedClose: true },
        },
        // Sent + expired quotes carry the commitment/at-risk signals.
        quotes: {
          where: { status: { in: ["sent", "expired"] } },
          select: { status: true, validUntil: true },
        },
        // Unworked inbound engagements carry the follow-up signal.
        engagements: {
          where: { status: { in: ["new", "contacted"] } },
          select: { status: true },
        },
        // Most recent logged activity drives the stale signal.
        activities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
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
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
    prisma.subscription.count({
      where: {
        status: "active",
        renewalDate: { lte: new Date(Date.now() + 30 * 86400_000) },
      },
    }),
    prisma.invoice.count({
      where: {
        status: { in: ["sent", "viewed", "partially_paid"] },
        dueDate: { lt: new Date() },
      },
    }),
  ]);

  const retain = await retainPromise;
  const revenueSummary = buildRevenueCockpitSummary({
    mrr: retain.mrr,
    arr: retain.arr,
    atRiskAccountCount: retain.churnRiskOutreachCount,
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
    currency: orgSettings?.baseCurrency ?? "USD",
    staleOpportunityCount,
    renewalsDueSoonCount,
    overdueInvoiceCount,
    marketingWork: {
      campaignBriefsOpen,
      assetTasksOpen,
      automationCandidatesOpen,
    },
  });

  // Which customer needs the operator? Classify each account from existing CRM
  // data and lead the list with the accounts carrying an unmet signal.
  const now = new Date();
  const accountsWithAttention = sortAccountsByAttention(
    accounts.map((a) => ({
      ...a,
      attention: classifyAccountAttention({
        status: a.status,
        opportunities: a.opportunities,
        quotes: a.quotes,
        engagements: a.engagements,
        lastActivityAt: a.activities[0]?.createdAt ?? null,
        createdAt: a.createdAt,
        now,
      }),
    })),
    (a) => a.attention,
    (a) => a.name,
  );
  const attentionCount = accountsWithAttention.filter((a) => a.attention.signal).length;

  // Owner-first summary: guest follow-up leads, CRM structure moves behind
  // progressive disclosure (BI-3BCAF95F). Reuse the storefront queues so
  // reservations/orders/inquiries become concrete follow-up work.
  const simple = isSimpleNavMode(
    resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
  );
  const [{ vocab, archetypeId }, pendingReservations, newInquiries, pendingOrders] = await Promise.all([
    loadOwnerFirstContext(),
    prisma.storefrontBooking.count({ where: { status: "pending" } }),
    prisma.storefrontInquiry.count({ where: { status: "new" } }),
    prisma.storefrontOrder.count({ where: { status: "pending" } }),
  ]);
  const unworkedEngagements = engagementCounts
    .filter((e) => e.status === "new" || e.status === "contacted")
    .reduce((sum, e) => sum + e._count, 0);
  const ownerSummary = buildCustomerOwnerSummary(
    {
      pendingReservations,
      pendingOrders,
      newInquiries,
      unworkedEngagements,
      overdueInvoices: overdueInvoiceCount,
      renewalsDueSoon: renewalsDueSoonCount,
    },
    vocab,
  );
  const customerSurface = resolveCustomerSurface(archetypeId, []);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{customerSurface.title}</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {accounts.length} {customerSurface.accountCountLabel}
            {attentionCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-[var(--dpf-text)]">
                  {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
                </span>
              </>
            )}
          </p>
        </div>
        <NewCustomerButton copy={customerSurface.newEntry} />
      </div>

      {/* Owner-first: what guest work needs you today, before the CRM. */}
      <OwnerFirstSummaryBand summary={ownerSummary} density={simple ? "simple" : "full"} />

      {/* CRM structure — revenue, duplicates, pipeline grid, and the account list —
          is the professional detail behind the daily work. Full mode keeps it one
          click away; Simple mode drops it to reduce body content (BI-3BCAF95F). A
          grid/surface deep-link (`?view=`) still renders, opened, so the demotion
          never strands that navigation. */}
      {(!simple || view) && (
        <OwnerFirstDisclosure
          summary={customerSurface.detailSummary}
          hint={customerSurface.detailHint}
          defaultOpen={Boolean(view)}
        >
          <RevenueCockpit summary={revenueSummary} />

          <DuplicateAccountsPanel />

          <PlatformGridSection
            entityType="customer_account"
            view={view}
            dataScope={dataScope}
          />

          {!view && (
            <>
      {/* Account list — accounts needing the operator lead the list. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accountsWithAttention.map((a) => {
          const statusMeta = getAccountStatusMeta(a.status);
          const attention = a.attention;
          const borderClass = attention.signal
            ? CRM_TONE_CLASSES[attention.tone].border
            : "border-[var(--dpf-accent)]";
          return (
            <Link
              key={a.id}
              href={`/customer/${a.id}`}
              className={`rounded-lg border-l-4 ${borderClass} bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]`}
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
              {attention.signal && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <CustomerStatusBadge label={attention.label} tone={attention.tone} />
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {attention.reason}
                  </span>
                </div>
              )}
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
            </>
          )}
        </OwnerFirstDisclosure>
      )}
    </div>
  );
}
