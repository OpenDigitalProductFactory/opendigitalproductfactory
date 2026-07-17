import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import { loadPersistedImpactSummary } from "@/lib/self-upgrade/impact";
import SelfUpgradeClient from "@/components/ops/SelfUpgradeClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { PlatformUpdateApplyPanel } from "@/components/admin/PlatformUpdateApplyPanel";
import { LocalChangesLedger } from "@/components/ops/LocalChangesLedger";
import { getLocalChangesLedger } from "@/lib/self-upgrade/local-changes-ledger";

export default async function SelfUpgradePage() {
  // BI-D43EB266: Self-Upgrade is the single operator entry point for "update
  // the portal". The image/SHA deploy controls (SelfUpgradeClient) are the
  // primary path; the source-merge sub-step (PlatformUpdateApplyPanel) is
  // folded in below and surfaces only when the install customises source
  // (updatePending). getPlatformDevConfig can be null on a fresh install.
  const [status, { runs, nextCursor }, devConfig, localChanges] = await Promise.all([
    getSelfUpgradeStatus(),
    listSelfUpgradeRuns(),
    getPlatformDevConfig(),
    getLocalChangesLedger(),
  ]);

  // Read the DURABLE CACHE only — never generate synchronously in the render.
  // Generating (summarizeUpgradeImpact = git-walk merge + LLM) here blocked the
  // whole page for 30-60s on the first view after each upgrade: the target SHA
  // changes on every upgrade, so the per-(lineage,target) cache misses every
  // time and each first click paid the full cost before a byte was returned
  // ("eventually comes up"). The glance summary is now auto-generated CLIENT-side
  // after paint (UpgradeImpactPanel), so the page renders promptly and the
  // summary fills in with a loading affordance. BI-4A400DE4.
  const initialImpactSummary = await loadPersistedImpactSummary(status.targetSha);

  const clientProps = JSON.parse(
    JSON.stringify({
      ...status,
      history: runs,
      historyNextCursor: nextCursor,
      initialImpactSummary,
    }),
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

      <div className="mt-6">
        <LocalChangesLedger result={localChanges} />
      </div>
    </div>
  );
}
