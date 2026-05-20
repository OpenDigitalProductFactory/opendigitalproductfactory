import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { SelfUpgradePanel } from "@/components/ops/SelfUpgradePanel";
import { getSelfUpgradeDashboardAction } from "@/lib/actions/self-upgrade";

export const dynamic = "force-dynamic";

export default async function SelfUpgradePage() {
  const dashboard = await getSelfUpgradeDashboardAction();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Portal Self-Upgrade</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Track and queue production-path upgrades from merged main.
        </p>
      </div>
      <OpsTabNav />
      <SelfUpgradePanel dashboard={dashboard} />
    </div>
  );
}
