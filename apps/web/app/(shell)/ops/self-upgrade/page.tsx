import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import SelfUpgradeClient from "@/components/ops/SelfUpgradeClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { PlatformUpdateApplyPanel } from "@/components/admin/PlatformUpdateApplyPanel";

export default async function SelfUpgradePage() {
  // BI-D43EB266: Self-Upgrade is the single operator entry point for "update
  // the portal". The image/SHA deploy controls (SelfUpgradeClient) are the
  // primary path; the source-merge sub-step (PlatformUpdateApplyPanel) is
  // folded in below and surfaces only when the install customises source
  // (updatePending). getPlatformDevConfig can be null on a fresh install.
  const [status, { runs, nextCursor }, devConfig] = await Promise.all([
    getSelfUpgradeStatus(),
    listSelfUpgradeRuns(),
    getPlatformDevConfig(),
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

      <PlatformUpdateApplyPanel
        updatePending={devConfig?.updatePending ?? false}
        pendingVersion={devConfig?.pendingVersion ?? null}
      />
    </div>
  );
}
