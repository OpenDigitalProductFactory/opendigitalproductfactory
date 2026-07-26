import { cookies } from "next/headers";
import { getSelfUpgradeStatus, listSelfUpgradeRuns } from "@/lib/actions/promotions";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";
import { loadPersistedImpactSummary } from "@/lib/self-upgrade/impact";
import { buildOwnerReleaseSummary } from "@/lib/self-upgrade/owner-summary";
import SelfUpgradeClient from "@/components/ops/SelfUpgradeClient";
import SelfUpgradeTriggerControl from "@/components/ops/SelfUpgradeTriggerControl";
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
  const [status, runsResult, devConfig, localChanges] = await Promise.all([
    getSelfUpgradeStatus().catch(() => null),
    listSelfUpgradeRuns().catch(() => ({ runs: [], nextCursor: null })),
    getPlatformDevConfig().catch(() => null),
    getLocalChangesLedger().catch(() => ({ available: false, note: "Local changes ledger temporarily unavailable.", changes: [] })),
  ]);

  const runs = runsResult?.runs ?? [];
  const nextCursor = runsResult?.nextCursor ?? null;

  const initialImpactSummary = status?.targetSha
    ? await loadPersistedImpactSummary(status.targetSha).catch(() => null)
    : null;

  const fallbackStatus = {
    enabled: false,
    channel: "stable",
    inMaintenanceWindow: false,
    windowConfigured: false,
    windowSource: "operating-hours" as const,
    autoWindowSummary: null,
    blackoutUntil: null,
    blackoutName: null,
    storeOpen: true,
    windowTimezone: "UTC",
    nextWindowStart: null,
    nextScheduledCheckAt: null,
    deployedSha: null,
    deployedShaSource: "unknown",
    targetSha: null,
    isFresh: true,
    releaseBatch: {
      applicable: false,
      eligible: false,
      reason: "Status unavailable",
      pendingCount: 0,
      minPendingPrs: 1,
      maxWaitHours: 24,
      oldestPendingAt: null,
      summary: "Status unavailable",
    },
    latestRun: null,
    latestRunImpact: null,
    quiescence: { blockers: [] },
    admission: { mode: "uncapped" as const, limit: null, blockedBy: [] },
    cooldownUntil: null,
    jobEngine: { healthy: false },
    platformVersion: {
      version: "unknown",
      publishedAt: new Date().toISOString(),
      gitSha: "unknown",
      imageVersion: undefined,
      buildDate: undefined,
      note: undefined,
    },
  };

  const effectiveStatus = status ?? fallbackStatus;

  const clientProps = JSON.parse(
    JSON.stringify({
      ...effectiveStatus,
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
      enabled: effectiveStatus.enabled,
      isFresh: effectiveStatus.isFresh,
      targetSha: effectiveStatus.targetSha,
      deployedSha: effectiveStatus.deployedSha,
      nextWindowStart: effectiveStatus.nextWindowStart,
      blackoutUntil: effectiveStatus.blackoutUntil,
      blackoutName: effectiveStatus.blackoutName,
      platformVersion: {
        version: effectiveStatus.platformVersion.version,
        gitSha: effectiveStatus.platformVersion.gitSha,
      },
      rollbackAvailable: hasGovernedRecoveryPoint(effectiveStatus.latestRun?.completionEvidence ?? null),
      latestRun: effectiveStatus.latestRun
        ? {
            status: effectiveStatus.latestRun.status,
            reason: effectiveStatus.latestRun.reason,
            targetSha: effectiveStatus.latestRun.targetSha,
          }
        : null,
      latestRunImpact: effectiveStatus.latestRunImpact,
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
        <OwnerReleaseCard
          summary={ownerSummary}
          primaryAction={
            <SelfUpgradeTriggerControl
              enabled={clientProps.enabled}
              channel={clientProps.channel}
              latestRun={clientProps.latestRun}
              quiescence={clientProps.quiescence}
              jobEngine={clientProps.jobEngine}
            />
          }
        />
      </div>

      {/* Run history, runtime/security ledgers and logs. BI-D77BF495: the
          primary "Upgrade now" trigger now lives above, co-located with the
          release status in OwnerReleaseCard — it is reachable on arrival in
          BOTH nav modes regardless of whether this section is expanded. That
          lets this section go back to collapsing by default in Simple (worker)
          nav mode: it holds only detail (history/ledgers/logs), not the
          primary action, so hiding it there is the correct progressive
          disclosure the owner-first redesign (BI-8D87084D) intended. */}
      <details
        className="mt-6 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        open={!simple}
      >
        <summary
          data-component="self-upgrade-advanced-toggle"
          className="cursor-pointer select-none rounded-xl px-4 py-3 text-sm font-medium text-[var(--dpf-text)] marker:text-[var(--dpf-muted)]"
        >
          Deploy controls &amp; history
          <span className="ml-2 text-xs font-normal text-[var(--dpf-muted)]">
            Run logs, runtime and security checks
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
