import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import SelfUpgradeClient from "@/components/ops/SelfUpgradeClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function SelfUpgradePage() {
  const [status, { runs, nextCursor }] = await Promise.all([
    getSelfUpgradeStatus(),
    listSelfUpgradeRuns(),
  ]);

  const clientProps = JSON.parse(
    JSON.stringify({ ...status, history: runs, historyNextCursor: nextCursor }),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Self-Upgrade</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Automated portal self-upgrade status and controls.
        </p>
      </div>

      <OpsTabNav />

      <SelfUpgradeClient {...clientProps} />
    </div>
  );
}
