import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import { loadPersistedImpactSummary, summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";
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

  // The at-a-glance scope one-liner (headline + counts ribbon) shown on the
  // "Update available" banner and fed to the panel below. When an update is
  // available we auto-generate it on load (operator decision: glance-level
  // characterization beats click-to-load) — summarizeUpgradeImpact is
  // cache-first and never throws, so the first view per (lineage, target) pair
  // pays the git-walk + LLM once and every later load reads the durable cache.
  // When the build is fresh (or self-upgrade disabled), stay read-only: no work
  // on a page that has nothing to summarize.
  const initialImpactSummary =
    status.enabled && !status.isFresh && status.targetSha
      ? await summarizeUpgradeImpact()
      : await loadPersistedImpactSummary(status.targetSha);

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
