import { prisma } from "@dpf/db";
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

export const dynamic = "force-dynamic";

export default async function DemandPage({
  searchParams,
}: {
  searchParams?: Promise<{
    organizationId?: string;
    productLineId?: string;
    businessProductId?: string;
    digitalProductId?: string;
  }>;
}) {
  const scope = (await searchParams) ?? {};
  const [items, networkItems, shareContext, founderPortfolio, workSyncLinks, policyConfig] = await Promise.all([
    getDemandItems(scope),
    getNetworkDemandItems(),
    getDemandShareContext(),
    getFounderSharedPortfolio(),
    getWorkSyncLinks(),
    prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { demandFramework: true, demandBucketTargets: true },
    }),
  ]);
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
    </div>
  );
}
