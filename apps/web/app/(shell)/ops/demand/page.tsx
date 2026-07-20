import { prisma } from "@dpf/db";
import { getDemandItems } from "@/lib/demand/demand-data";
import { resolveDemandPolicy } from "@/lib/demand/policy";
import { DemandBoard } from "@/components/ops/DemandBoard";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { NetworkDemandPanel } from "@/components/ops/NetworkDemandPanel";
import { getDemandShareContext, getNetworkDemandItems } from "@/lib/federation/demand-read-model";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  const [items, networkItems, shareContext, policyConfig] = await Promise.all([
    getDemandItems(),
    getNetworkDemandItems(),
    getDemandShareContext(),
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
