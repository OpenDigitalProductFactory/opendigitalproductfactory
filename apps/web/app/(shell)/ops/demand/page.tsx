import { prisma } from "@dpf/db";
import { getDemandItems } from "@/lib/demand/demand-data";
import { resolveDemandPolicy } from "@/lib/demand/policy";
import { DemandBoard } from "@/components/ops/DemandBoard";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  const [items, policyConfig] = await Promise.all([
    getDemandItems(),
    prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { demandFramework: true, demandBucketTargets: true },
    }),
  ]);
  const policy = resolveDemandPolicy(policyConfig);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Demand</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          What&apos;s being asked for, how valuable, and how big — ranked so the highest value-per-effort
          work is drawn first.
        </p>
      </div>
      <OpsTabNav />
      <DemandBoard
        items={JSON.parse(JSON.stringify(items))}
        bucketTargets={policy.bucketTargets}
        activeFramework={policy.framework}
      />
    </div>
  );
}
