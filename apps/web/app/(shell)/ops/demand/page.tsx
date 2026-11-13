import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getDemandItems } from "@/lib/demand/demand-data";
import { resolveDemandPolicy } from "@/lib/demand/policy";
import { DemandBoard } from "@/components/ops/DemandBoard";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { NetworkDemandPanel } from "@/components/ops/NetworkDemandPanel";
import { WorkSyncPanel } from "@/components/ops/WorkSyncPanel";
import { getWorkSyncLinks } from "@/lib/federation/work-sync-read-model";
import { getDemandShareContext, getNetworkDemandItems } from "@/lib/federation/demand-read-model";
import { FounderSharedPortfolioPanel } from "@/components/ops/FounderSharedPortfolioPanel";
import { getFounderSharedPortfolio } from "@/lib/federation/founder-portfolio";
import { PortfolioTieOutPanel } from "@/components/ops/PortfolioTieOutPanel";
import { loadPortfolioTieOutPanel } from "@/lib/portfolio/tie-out-panel-data";
import { PortfolioOwnership } from "@/components/portfolio/PortfolioOwnership";
import { loadPortfolioOwnership } from "@/lib/portfolio/accountable-owner-view";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { InvestmentBalance } from "@/components/ops/InvestmentBalance";
import { loadOwnerInvestmentPage } from "@/lib/portfolio/investment-balance-server";

export const dynamic = "force-dynamic";

export default async function DemandPage({
  searchParams,
}: {
  searchParams?: Promise<{
    organizationId?: string;
    productLineId?: string;
    businessProductId?: string;
    digitalProductId?: string;
    investment?: string;
    investmentAfter?: string;
  }>;
}) {
  const { investment, investmentAfter, ...scope } = (await searchParams) ?? {};
  const [items, networkItems, shareContext, founderPortfolio, workSyncLinks, policyConfig, tieOutPanel, locale] = await Promise.all([
    getDemandItems(scope),
    getNetworkDemandItems(),
    getDemandShareContext(),
    getFounderSharedPortfolio(),
    getWorkSyncLinks(),
    prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { demandFramework: true, demandBucketTargets: true },
    }),
    loadPortfolioTieOutPanel(),
    getLocaleContext(),
  ]);
  // Who answers for each portfolio sits beside its budget (BI-67B27832).
  const [ownership, session] = await Promise.all([loadPortfolioOwnership(prisma as never), auth()]);
  const canManageOwners = Boolean(
    session?.user && can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform"),
  );
  const canManageAllocation = Boolean(session?.user && can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_backlog"));
  const investmentPage = session?.user?.id ? await loadOwnerInvestmentPage(prisma, session.user.id, investmentAfter) : { views: [], nextCursor: null };
  const investmentHref = (cursor?: string) => {
    const params = new URLSearchParams(Object.entries(scope).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    params.set("investment", "1");
    if (cursor) params.set("investmentAfter", cursor);
    return `/ops/demand?${params.toString()}#investment-balance`;
  };
  const policy = resolveDemandPolicy(policyConfig);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Delivery Flow</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          One flow from investment to execution: what&apos;s asked for, how valuable and how big, funded at
          the bet, then built. The Flow lens shows the whole river; Funnel, Value × effort and Balance zoom
          into the invest half.
        </p>
      </div>
      <OpsTabNav />
      {Object.values(scope).some(Boolean) ? (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-muted)]">
          Showing demand for the selected product context. This remains the
          canonical Delivery Flow; clear the URL filters to review all demand.
        </div>
      ) : null}
      {founderPortfolio.enabled ? (
        <FounderSharedPortfolioPanel
          inbox={JSON.parse(JSON.stringify(founderPortfolio.inbox))}
          clusters={JSON.parse(JSON.stringify(founderPortfolio.clusters))}
        />
      ) : null}
      <WorkSyncPanel links={JSON.parse(JSON.stringify(workSyncLinks))} />
      <NetworkDemandPanel
        items={JSON.parse(JSON.stringify(networkItems))}
        shareContext={JSON.parse(JSON.stringify(shareContext))}
      />
      <DemandBoard
        items={JSON.parse(JSON.stringify(items))}
        bucketTargets={policy.bucketTargets}
        activeFramework={policy.framework}
      />
      <MessagesProvider locale={locale.language} messages={{ portfolio: namespaceMessages(locale.language, "portfolio") }}>
        <PortfolioTieOutPanel {...JSON.parse(JSON.stringify(tieOutPanel))} formatLocale={locale.formatLocale} initiallyOpen={investment === "1"}>
          <PortfolioOwnership view={ownership} canManage={canManageOwners} />
          <InvestmentBalance views={investmentPage.views} canManage={canManageAllocation} formatLocale={locale.formatLocale} nextHref={investmentPage.nextCursor ? investmentHref(investmentPage.nextCursor) : undefined} firstHref={investmentAfter ? investmentHref() : undefined} />
        </PortfolioTieOutPanel>
      </MessagesProvider>
    </div>
  );
}
