import { cookies } from "next/headers";
import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import { loadPersistedImpactSummary } from "@/lib/self-upgrade/impact";
import { buildOwnerReleaseSummary } from "@/lib/self-upgrade/owner-summary";
import SelfUpgradeClient from "@/components/ops/SelfUpgradeClient";
import { OwnerReleaseCard } from "@/components/ops/OwnerReleaseCard";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { PlatformUpdateApplyPanel } from "@/components/admin/PlatformUpdateApplyPanel";
import { LocalChangesLedger } from "@/components/ops/LocalChangesLedger";
import { getLocalChangesLedger } from "@/lib/self-upgrade/local-changes-ledger";
import { hasGovernedRecoveryPoint } from "@/lib/self-upgrade/rollback";
import { NAV_MODE_COOKIE, resolveNavModeFromCookie, isSimpleNavMode } from "@/lib/navigation/nav-mode";

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

  // BI-8D87084D: front the runtime ledger with a plain-language release status
  // card that answers is-there-an-update / is-it-safe / can-I-keep-working /
  // can-I-undo / what-if-I-do-nothing. The technical controls, SUR run history,
  // runtime/security ledgers, and logs move behind an Advanced disclosure that
  // Simple (worker) nav-mode keeps collapsed by default.
  const ownerSummary = buildOwnerReleaseSummary(
    {
      enabled: status.enabled,
      isFresh: status.isFresh,
      targetSha: status.targetSha,
      deployedSha: status.deployedSha,
      nextWindowStart: status.nextWindowStart,
      blackoutUntil: status.blackoutUntil,
      blackoutName: status.blackoutName,
      platformVersion: {
        version: status.platformVersion.version,
        gitSha: status.platformVersion.gitSha,
      },
      rollbackAvailable: hasGovernedRecoveryPoint(status.latestRun?.completionEvidence ?? null),
      latestRun: status.latestRun
        ? {
            status: status.latestRun.status,
            reason: status.latestRun.reason,
            targetSha: status.latestRun.targetSha,
          }
        : null,
      latestRunImpact: status.latestRunImpact,
    },
    localChanges,
  );
  const navMode = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  const simple = isSimpleNavMode(navMode);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Self-Upgrade</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Keep your platform up to date. Here&apos;s the plain-language status; technical
          controls and history are under Advanced.
        </p>
      </div>

      <OpsTabNav />

      <div className="mt-4">
        <OwnerReleaseCard summary={ownerSummary} />
      </div>

      {/* Deploy controls + run history, runtime/security ledgers and logs.
          BI-D77BF495: this section holds the primary "Upgrade now" trigger, so it
          defaults OPEN in BOTH nav modes — collapsing it in Simple mode hid the one
          control this high-frequency operator page exists for, and the word budgets
          could not see that regression because hiding the trigger REDUCES the counts.
          The owner-first status card still leads; the section stays collapsible for
          anyone who wants to tuck the detail away, but the action is reachable on
          arrival. (Fuller fix — a prominent trigger co-located in the card with only
          logs/history collapsible — tracked in BI-D77BF495; it needs the trigger
          extraction plus live upgrade-flow verification.) */}
      <details className="mt-6 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]" open>
        <summary
          data-component="self-upgrade-advanced-toggle"
          className="cursor-pointer select-none rounded-xl px-4 py-3 text-sm font-medium text-[var(--dpf-text)] marker:text-[var(--dpf-muted)]"
        >
          Deploy controls &amp; history
          <span className="ml-2 text-xs font-normal text-[var(--dpf-muted)]">
            Upgrade trigger, run logs, runtime and security checks
          </span>
        </summary>

        <div className="space-y-6 border-t border-[var(--dpf-border)] p-4">
          <SelfUpgradeClient {...clientProps} />

          <PlatformUpdateApplyPanel
            updatePending={devConfig?.updatePending ?? false}
            pendingVersion={devConfig?.pendingVersion ?? null}
          />

          <LocalChangesLedger result={localChanges} />
        </div>
      </details>
    </div>
  );
}
