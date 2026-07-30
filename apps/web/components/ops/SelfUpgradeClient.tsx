"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rollbackSelfUpgrade, repairPromoterImage } from "@/lib/actions/promotions";
import { LocalTime } from "@/components/ui/LocalTime";
import UpgradeImpactPanel from "@/components/ops/UpgradeImpactPanel";
import type { SummaryResult, RunImpactDigest } from "@/lib/self-upgrade/impact/types";
import { UpgradeScopeRibbon } from "@/components/ops/UpgradeScopeRibbon";
import { StatusBadge } from "@/components/ui/report-kit";
import { describeSkipReason } from "@/lib/self-upgrade/skip-reason";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isExpectedDuringSwap } from "@/lib/self-upgrade/is-expected-during-swap";
import { SelfUpgradeReadiness } from "@/components/ops/SelfUpgradeReadiness";
import { BuildStamps } from "@/components/ops/BuildStamps";
import type { LatestRun, QuiescenceActivity } from "@/lib/self-upgrade/run-types";
import { RECOVERY_ACTION_CLASS, RECOVERY_CONFIRMATION_CLASS } from "@/components/ops/self-upgrade-recovery-control-styles";
type RecoveryPointSummary = {
  status: string;
  members: Array<{ target: string; runId: string | null; status: string }>;
  rollbackStatus: string | null;
};

type ImageVersionSource = "git-sha" | "content-hash" | "unknown";

type AdmissionSnapshot = {
  lane: { enabled: boolean; limit: number | null; key: string };
  buildHolders: number;
  totalHolders: number;
  summary: string;
};

type Props = {
  enabled: boolean;
  inMaintenanceWindow: boolean;
  windowConfigured?: boolean;
  /**
   * Which model produced the upgrade window. "auto-overnight" = 24/7 store, auto-
   * picked overnight slot; "needs-timezone" = 24/7 store with no known timezone,
   * so the panel asks for one instead of guessing. (BI-A6382FB9)
   */
  windowSource?: "explicit" | "operating-hours" | "auto-overnight" | "needs-timezone";
  /** Friendly window-time range (e.g. "2:00 AM-4:00 AM") for the auto-overnight note. */
  autoWindowSummary?: string | null;
  /** End of an active operator blackout pausing scheduled upgrades, or null (BI-59591B14). */
  blackoutUntil?: string | null;
  /** Name of the active blackout, for the paused-schedule note. */
  blackoutName?: string | null;
  /** IANA timezone the upgrade window is evaluated in (store operating hours). */
  windowTimezone?: string;
  nextWindowStart?: string | null;
  nextScheduledCheckAt?: string | null;
  deployedSha: string | null;
  deployedShaSource?: ImageVersionSource;
  targetSha: string | null;
  isFresh: boolean;
  /** Release-batch tally: routine upgrades wait for a batch of merged updates. */
  releaseBatch?: {
    applicable: boolean;
    eligible: boolean;
    reason: string;
    pendingCount: number | null;
    minPendingPrs: number;
    maxWaitHours: number;
    oldestPendingAt: string | null;
    summary: string;
  } | null;
  latestRun: LatestRun | null;
  /** Human-readable scope of what the latest run carried (null when unrecorded). */
  latestRunImpact?: RunImpactDigest | null;
  quiescence?: QuiescenceActivity | null;
  admission?: AdmissionSnapshot | null;
  cooldownUntil?: string | null;
  history?: LatestRun[];
  historyNextCursor?: string | null;
  initialImpactSummary?: SummaryResult | null;
  platformVersion: {
    version: string;
    publishedAt: string;
    gitSha: string | null;
    imageVersion?: { raw: string; source: ImageVersionSource } | null;
    buildDate?: string | null;
    note: string | null;
  };
  /**
   * BI-5B1FDA09: the last merged PR each end of the comparison contains. DPF
   * ships from `main` with no release tags, so this is the only build identity
   * with meaning to an operator. Either end can be null (shallow clone,
   * unfetched commit, direct push with no `(#N)`), in which case the technical
   * SHA line below carries the identity on its own.
   */
  mergePoints?: {
    running: { sha: string; prNumber: number | null; description: string | null; label: string } | null;
    available: { sha: string; prNumber: number | null; description: string | null; label: string } | null;
  } | null;
};

function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function statusLabel(value: string): string {
  return value.replace(/[_-]/g, " ");
}

function formatDuration(start: Date | string, end: Date | string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

// A one-line "why it failed" for the Run History, drawn from the persisted
// failureLog. The orchestrator stores a classified excerpt that LEADS with
// `[build-failure-class] <summary>` lines, so prefer the human summary line;
// otherwise fall back to the last non-empty line (usually the raw daemon/build
// error). The full log stays available on hover. Without this the history table
// showed a bare "failed" badge with no words — the gap this closes.
export function conciseFailureReason(log: string | null | undefined): string | null {
  if (!log) return null;
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const classLines = lines
    .filter((l) => l.startsWith("[build-failure-class]"))
    .map((l) => l.replace(/^\[build-failure-class\]\s*/, "").trim())
    .filter((l) => l && !l.startsWith("playbook:"));
  // classLines[0] is the class id (e.g. "docker-mount-denied"); [1] is the
  // human summary. Prefer the summary, else the id, else the last raw line.
  const chosen = classLines[1] ?? classLines[0] ?? lines[lines.length - 1];
  return chosen.length > 200 ? `${chosen.slice(0, 200)}…` : chosen;
}

/**
 * Median wall-clock duration (ms) of past *successful* upgrade runs — the basis
 * for estimating when an in-flight run will finish. Median, not mean, so one
 * pathologically long run doesn't drag the estimate out. Returns null when no
 * completed run exists to learn from (first-ever upgrade shows no estimate).
 */
function estimateRunDurationMs(history: LatestRun[] | undefined): number | null {
  if (!history || history.length === 0) return null;
  const durations = history
    .filter((r) => r.status === "succeeded" && r.startedAt && r.completedAt)
    .map(
      (r) =>
        new Date(r.completedAt as string | Date).getTime() -
        new Date(r.startedAt as string | Date).getTime(),
    )
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 0
    ? Math.round((durations[mid - 1] + durations[mid]) / 2)
    : durations[mid];
}

function approxWait(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  if (!Number.isFinite(ms)) return "indefinite";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 90) return `~${totalSeconds}s`;
  return `~${Math.round(totalSeconds / 60)}m`;
}

// Friendly label for a deferSurface key (mirrors describeBlockerSurface on the
// server so the panel reads the same whether it's a blocker line or the
// primary defer reason).
function surfaceLabel(surface: string | null): string | null {
  if (!surface) return null;
  if (surface === "coworker.reasoning-loop") return "AI coworker working";
  if (surface === "request.recent-tool-execution") return "Recent portal / MCP activity";
  if (surface === "build-studio.phase.ship") return "Build Studio — ship phase";
  if (surface.startsWith("build-studio.phase.")) {
    return `Build Studio — ${surface.slice("build-studio.phase.".length)} phase`;
  }
  return surface;
}

const QUIESCENCE_LEVEL_STYLES: Record<string, string> = {
  draining: "bg-[var(--dpf-warning)]/20 text-[var(--dpf-warning)] border-[var(--dpf-warning)]/30",
  swapping: "bg-[var(--dpf-info)]/20 text-[var(--dpf-info)] border-[var(--dpf-info)]/30",
  normal: "bg-[var(--dpf-muted)]/20 text-[var(--dpf-muted)] border-[var(--dpf-muted)]/30",
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recoveryPointSummary(run: LatestRun | null): RecoveryPointSummary | null {
  const evidence = record(run?.completionEvidence);
  const point = record(evidence?.recoveryPoint);
  if (!point || !Array.isArray(point.members)) return null;
  const rollback = record(evidence?.rollback);
  return {
    status: String(point.status ?? "unknown"),
    members: point.members.map((member) => {
      const m = record(member);
      return {
        target: String(m?.target ?? "unknown"),
        runId: typeof m?.runId === "string" ? m.runId : null,
        status: String(m?.status ?? "unknown"),
      };
    }),
    rollbackStatus: typeof rollback?.status === "string" ? rollback.status : null,
  };
}

// Operator-facing label for a recovery-point member. The derived stores
// (neo4j, qdrant) are INTENTIONALLY not backed up — they re-derive from
// postgres + source — so a "skipped" member must read as a deliberate choice,
// not as a "missing" backup (which looks like a failure sitting next to a
// "Recovery point: ok" header). And a successful backup's internal runId/cuid
// means nothing to an operator — "backed up" is what they need to see.
function recoveryMemberLabel(member: { target: string; status: string }): string {
  switch (member.status) {
    case "skipped":
      return `${member.target}: skipped (re-derived)`;
    case "failed":
      return `${member.target}: failed`;
    default:
      return `${member.target}: backed up`;
  }
}

const DEFAULT_STATUS_STYLE =
  "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border-[var(--dpf-border)]";

export default function SelfUpgradeClient({
  enabled,
  inMaintenanceWindow,
  windowConfigured,
  windowSource,
  autoWindowSummary,
  blackoutUntil,
  blackoutName,
  windowTimezone,
  nextWindowStart,
  nextScheduledCheckAt,
  deployedSha,
  deployedShaSource,
  targetSha,
  isFresh,
  releaseBatch,
  latestRun,
  latestRunImpact,
  quiescence,
  admission,
  cooldownUntil,
  history,
  historyNextCursor,
  initialImpactSummary,
  platformVersion,
  mergePoints,
}: Props) {
  const router = useRouter();
  const [isRollbackPending, startRollbackTransition] = useTransition();
  // A recovery-point restore can swap this portal out from under the
  // operator's own request (same class of disconnect as a forced upgrade —
  // see isExpectedDuringSwap). `restarting` holds a calm reconnect banner
  // (and keeps the status poll alive) instead of painting the global crash
  // screen. `restartBaselineRef` snapshots the server signature at swap time
  // so we know when the new container has answered. The trigger/force/abort
  // actions have their OWN instance of this same pattern in
  // SelfUpgradeTriggerControl (BI-D77BF495) — this one is scoped to rollback.
  const [restarting, setRestarting] = useState(false);
  const restartBaselineRef = useRef<string | null>(null);
  const [isRepairPending, startRepairTransition] = useTransition();
  const [repairResult, setRepairResult] = useState<{
    status: "ok" | "error";
    message: string;
  } | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState("");
  const [rollbackResult, setRollbackResult] = useState<{
    status: "idle" | "ok" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const latestRecoveryPoint = recoveryPointSummary(latestRun);
  const canRollbackLatest =
    latestRun &&
    latestRun.status !== "running" &&
    latestRecoveryPoint?.status === "ok" &&
    latestRecoveryPoint.rollbackStatus !== "ok";

  // Live upgrade activity: is the portal draining for a swap right now, is it
  // backing off after a defer/fail, and what work is/was holding the drain?
  const draining = !!quiescence && quiescence.level !== "normal";
  const cooldownActive =
    !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();
  const deferredRun = quiescence?.run?.status === "deferred";
  const showActivity =
    draining || cooldownActive || (!!deferredRun && (quiescence?.blockers.length ?? 0) > 0);

  // True once the worker has actually picked the upgrade up — the run is running
  // or the portal is draining/swapping for the swap.
  const queuedRun = latestRun?.status === "queued" || latestRun?.status === "pending";
  const upgradeInFlight = queuedRun || latestRun?.status === "running" || draining;

  // Once a run is actually running, project when it should finish from the
  // median duration of past successful runs, anchored to this run's start. Null
  // until there's history to learn from or until the run is running with a
  // start time. Rendered on the "Started:" line as the estimated finish clock.
  const estimatedDurationMs = estimateRunDurationMs(history);
  const estimatedCompletionAt =
    latestRun?.status === "running" && latestRun.startedAt && estimatedDurationMs != null
      ? new Date(latestRun.startedAt).getTime() + estimatedDurationMs
      : null;

  // Keep the read-only detail panel (Latest Run, run history, activity) in
  // sync while an upgrade is in flight or a rollback swap is reconnecting —
  // both are derived server state, not local trigger state, so this poll
  // needs no dependency on SelfUpgradeTriggerControl's own justQueued.
  useEffect(() => {
    if (!upgradeInFlight && !restarting) return;
    const interval = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(interval);
  }, [upgradeInFlight, restarting, router]);

  // Drop the reconnect banner once the swapped-in portal actually answers with
  // fresh data. We snapshot the server-derived signature at the moment the swap
  // severs the request (enterRestarting), then clear as soon as any of those
  // fields change — the deployed SHA flips, the run reaches a terminal state, or
  // the drain returns to normal — which only happens after a poll gets through to
  // the new container. Keying off "the data changed" (not the instantaneous
  // in-flight flag, which is already false on an idle force) avoids both a
  // premature flash and a banner that lingers long after the portal is back.
  useEffect(() => {
    if (!restarting || restartBaselineRef.current === null) return;
    if (serverSignature() !== restartBaselineRef.current) {
      restartBaselineRef.current = null;
      setRestarting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    restarting,
    latestRun?.runId,
    latestRun?.status,
    deployedSha,
    isFresh,
    quiescence?.level,
  ]);

  // Safety net: never let the reconnect banner wedge if the portal stays
  // unreachable (e.g. a swap that genuinely failed). The run-status surfaces
  // below still tell the operator what happened.
  useEffect(() => {
    if (!restarting) return;
    const timeout = setTimeout(() => {
      restartBaselineRef.current = null;
      setRestarting(false);
    }, 120_000);
    return () => clearTimeout(timeout);
  }, [restarting]);

  // A compact fingerprint of the server-derived state. When it changes after a
  // swap-induced disconnect, the new container has answered and the reconnect
  // banner can clear. Scoped to the rollback restore here — the trigger/force/
  // abort actions have their own instance in SelfUpgradeTriggerControl.
  function serverSignature(): string {
    return [
      latestRun?.runId ?? "",
      latestRun?.status ?? "",
      deployedSha ?? "",
      isFresh ? "1" : "0",
      quiescence?.level ?? "",
    ].join("|");
  }

  // Enter the calm "applying / reconnecting" state after the swap severed this
  // page's own request. Snapshot the current signature so the clear effect can
  // detect when the swapped-in portal returns fresh data, and keep the status
  // poll alive so the page reconnects on its own.
  function enterRestarting() {
    restartBaselineRef.current = serverSignature();
    setRestarting(true);
    router.refresh();
  }

  // BI-F2C53237: build the promoter engine image in place when self-upgrade
  // skipped with promoter-unavailable, so the operator resolves "Upgrade engine
  // not ready" with one click instead of a docker command.
  function handleRepairPromoter() {
    setRepairResult(null);
    startRepairTransition(async () => {
      try {
        const r = await repairPromoterImage();
        setRepairResult({ status: r.ok ? "ok" : "error", message: r.message });
        if (r.ok) router.refresh();
      } catch (err) {
        setRepairResult({
          status: "error",
          message: getErrorMessage(err) || "Could not build the promoter engine image.",
        });
      }
    });
  }

  function handleRollback(runId: string) {
    setRollbackResult({ status: "idle", message: "" });
    startRollbackTransition(async () => {
      try {
        const result = await rollbackSelfUpgrade(runId, rollbackConfirmation);
        if (result.ok) {
          setRollbackResult({
            status: "ok",
            message: "Recovery point restored.",
          });
        } else {
          setRollbackResult({
            status: "error",
            message: result.error ?? "Recovery point restore failed.",
          });
        }
        router.refresh();
      } catch (err) {
        // A restore can restart services; if it severs this request, treat it
        // as "applying" rather than crashing the page to the error boundary.
        if (isExpectedDuringSwap(err)) {
          enterRestarting();
        } else {
          setRollbackResult({
            status: "error",
            message: err instanceof Error ? err.message : "Recovery point restore failed.",
          });
        }
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Rollback's own reconnect banner — the trigger/force/abort actions
          have their own instance of this same "applying the upgrade, portal
          is restarting" state inside SelfUpgradeTriggerControl (co-located
          with the release status, BI-D77BF495), which is what fires for a
          normal upgrade. This one only fires for a recovery-point restore. */}
      {restarting && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-info)]/10 border border-[var(--dpf-info)]/30 text-sm text-[var(--dpf-text)]"
          role="status"
          aria-live="polite"
          data-upgrade-restarting="true"
        >
          <span className="font-medium">Applying the restore…</span> the portal is
          restarting to finish the swap. This page reconnects automatically — no
          need to refresh.
        </div>
      )}

      {enabled && inMaintenanceWindow && (
        <div className="p-3 rounded-lg bg-[var(--dpf-success)]/10 border border-[var(--dpf-success)]/30 text-sm text-[var(--dpf-text)]">
          Currently in maintenance window — next scheduled check: {" "}
          {nextScheduledCheckAt ? (
            <>
              <LocalTime className="font-mono" value={nextScheduledCheckAt} />
              <span>. If an update is still available, it can start then.</span>
            </>
          ) : (
            <>
              <span className="font-mono">pending scheduler tick</span>
              <span>. If an update is still available, it can start then.</span>
            </>
          )}
        </div>
      )}

      {enabled && showActivity && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-2"
          data-quiescence-level={quiescence?.level ?? "normal"}
          data-upgrade-activity="true"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--dpf-text)]">
              Upgrade activity
            </span>
            {quiescence && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs border ${
                  QUIESCENCE_LEVEL_STYLES[quiescence.level] ?? DEFAULT_STATUS_STYLE
                }`}
              >
                {quiescence.level === "draining"
                  ? "draining"
                  : quiescence.level === "swapping"
                    ? "swapping"
                    : "idle"}
              </span>
            )}
          </div>

          {draining && (
            <p className="text-xs text-[var(--dpf-muted)]">
              Preparing a platform upgrade — new actions are paused while
              in-flight work finishes. They resume automatically once the swap
              completes or the drain defers.
            </p>
          )}

          {quiescence?.run?.targetBundleHash && (
            <div className="text-xs text-[var(--dpf-muted)]">
              Target build:{" "}
              <span className="font-mono">
                {shortSha(quiescence.run.targetBundleHash)}
              </span>
            </div>
          )}

          {admission && (
            <div className="text-xs text-[var(--dpf-muted)]" data-admission-summary>
              <span className="font-medium text-[var(--dpf-text)]">Instance admission:</span>{" "}
              {admission.summary}
            </div>
          )}

          {quiescence?.verdict && (
            <div
              className="p-2.5 rounded-lg bg-[var(--dpf-warning)]/15 border border-[var(--dpf-warning)]/40 text-xs space-y-0.5"
              role="status"
              aria-live="polite"
              data-blocker-verdict={quiescence.verdict.kind}
            >
              <div className="font-medium text-[var(--dpf-warning)]">
                Stuck loop, not live work
              </div>
              <div className="text-[var(--dpf-muted)]">{quiescence.verdict.message}</div>
            </div>
          )}

          {quiescence && quiescence.blockers.length > 0 && (
            <div className="text-xs">
              <div className="text-[var(--dpf-muted)] mb-1">
                {draining ? "Waiting on:" : "Was waiting on:"}
              </div>
              <ul className="space-y-1">
                {quiescence.blockers.map((b) => (
                  <li
                    key={b.surface}
                    className="flex flex-col gap-0.5"
                    data-blocker-surface={b.surface}
                    data-blocker-stale={b.stale ? "true" : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          b.kind === "hard"
                            ? "bg-[var(--dpf-warning)]"
                            : "bg-[var(--dpf-muted)]"
                        }`}
                      />
                      <span className="text-[var(--dpf-text)]">{b.label}</span>
                      {b.count > 1 && (
                        <span className="text-[var(--dpf-muted)]">×{b.count}</span>
                      )}
                      {approxWait(b.estimatedWaitMs) && (
                        <span className="text-[var(--dpf-muted)]">
                          · {approxWait(b.estimatedWaitMs)}
                        </span>
                      )}
                    </div>
                    {(b.sampleTitle || b.sampleAgent || b.oldestSignalAt) && (
                      <div className="pl-3.5 text-[var(--dpf-muted)] flex flex-wrap items-center gap-x-1.5">
                        {(b.sampleAgent || b.sampleTitle) && (
                          <span className="text-[var(--dpf-text)]">
                            {[b.sampleAgent, b.sampleTitle].filter(Boolean).join(" · ")}
                            {b.count > 1 && (
                              <span className="text-[var(--dpf-muted)]">
                                {" "}
                                +{b.count - 1} more
                              </span>
                            )}
                          </span>
                        )}
                        {b.oldestSignalAt && (
                          <span>
                            · last active{" "}
                            <LocalTime className="font-mono" value={b.oldestSignalAt} />
                          </span>
                        )}
                        {b.stale && (
                          <span
                            className="text-[var(--dpf-warning)]"
                            data-blocker-stale-badge="true"
                          >
                            · unresponsive — clears automatically
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deferredRun && !draining && (
            <p className="text-xs text-[var(--dpf-muted)]">
              Last upgrade attempt deferred
              {surfaceLabel(quiescence?.run?.deferSurface ?? null) ? (
                <> — {surfaceLabel(quiescence?.run?.deferSurface ?? null)} was active</>
              ) : null}
              . Your work was never interrupted.
            </p>
          )}

          {cooldownActive && (
            <div className="text-xs text-[var(--dpf-muted)]" data-cooldown="active">
              Automatic upgrades paused until{" "}
              <LocalTime className="font-mono" value={cooldownUntil ?? ""} /> after
              a deferred or failed attempt. Use Emergency override to run now.
            </div>
          )}
        </div>
      )}

      <div
        className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-1"
        data-platform-version={platformVersion.version}
      >
        {/* BI-5B1FDA09: lead with the last merged PR each build contains. DPF
            ships from `main` with no release tags, so `v<short-sha>` was never
            a version an operator could act on — and comparing a local merge
            commit to an upstream commit meant the two ids never matched even
            when current. PR identity is stable across that divergence, so the
            SHAs move behind the disclosure below and the old "the two SHAs
            differ by design" apology is no longer needed at all. */}
        <div className="text-xs text-[var(--dpf-muted)]">
          <span className="font-medium text-[var(--dpf-text)]">Running:</span>{" "}
          <span className="font-mono text-[var(--dpf-text)]" data-running-merge-point={mergePoints?.running?.prNumber ?? ""}>
            {/* `||`, not `??`: shortSha returns "" (not null) for a missing
                stamp, so a nullish check would render an empty cell. */}
            {mergePoints?.running?.label
              || shortSha(platformVersion.gitSha ?? platformVersion.imageVersion?.raw ?? null)
              || `v${platformVersion.version}`}
          </span>
          {mergePoints?.running?.description && (
            <span className="ml-1">— {mergePoints.running.description}</span>
          )}
        </div>
        {enabled && (
          <>
            {!isFresh && (
              <div className="text-xs text-[var(--dpf-muted)]">
                <span className="font-medium text-[var(--dpf-text)]">Available:</span>{" "}
                <span className="font-mono text-[var(--dpf-text)]" data-available-merge-point={mergePoints?.available?.prNumber ?? ""}>
                  {mergePoints?.available?.label || shortSha(targetSha) || "unknown"}
                </span>
                {mergePoints?.available?.description && (
                  <span className="ml-1">— {mergePoints.available.description}</span>
                )}
              </div>
            )}
            {/* "How far behind" comes from the commit walk (release-batch.ts),
                never from PR-number arithmetic: merge order is a race, so a
                higher PR number does not imply newer. */}
            {!isFresh && typeof releaseBatch?.pendingCount === "number" && releaseBatch.pendingCount > 0 && (
              <div className="text-xs text-[var(--dpf-muted)]">
                <span className="font-medium text-[var(--dpf-text)]">Behind by:</span>{" "}
                {releaseBatch.pendingCount} merged{" "}
                {releaseBatch.pendingCount === 1 ? "PR" : "PRs"}
              </div>
            )}
            {isFresh && (
              <div className="text-xs text-[var(--dpf-success)]" data-up-to-date="true">
                Up to date
              </div>
            )}
            {!isFresh && targetSha && deployedShaSource === "content-hash" && (
              <div className="text-xs text-[var(--dpf-warning)]">
                This image wasn&apos;t stamped with a git commit, so it
                can&apos;t be compared to the upgrade target. Published releases
                are stamped automatically by CI; for a local build, rebuild with{" "}
                <span className="font-mono">scripts/build-images.sh</span>{" "}
                (<span className="font-mono">build-images.ps1</span> on Windows).
              </div>
            )}
            {!isFresh && targetSha && deployedShaSource !== "content-hash" && (
              <div className="text-xs text-[var(--dpf-warning)]">Update available</div>
            )}
            {/* At-a-glance scope of the available update, so "how big / what
                kind" is answered on the banner without opening the elaborate
                "What's in this update?" panel below. Auto-generated on load
                (page.tsx) and cached; renders only when the summary resolved. */}
            {!isFresh &&
              targetSha &&
              deployedShaSource !== "content-hash" &&
              initialImpactSummary?.ok && (
                <div className="mt-1 space-y-1" data-update-glance="true">
                  <UpgradeScopeRibbon
                    surface="available"
                    counts={initialImpactSummary.summary.counts}
                    headline={initialImpactSummary.summary.phrased?.headline ?? null}
                  />
                </div>
              )}
            {!isFresh &&
              targetSha &&
              releaseBatch?.applicable &&
              !releaseBatch.eligible && (
                <div className="text-xs text-[var(--dpf-muted)]" data-release-batch="waiting">
                  Batching updates:{" "}
                  {releaseBatch.pendingCount ?? "?"} of {releaseBatch.minPendingPrs} merged
                  updates accumulated. Routine upgrades deploy in batches so the portal
                  isn&apos;t paused for every change; &quot;Upgrade now&quot; deploys them
                  immediately.
                </div>
              )}
          </>
        )}
        <BuildStamps
          enabled={enabled}
          deployedSha={deployedSha}
          deployedShaSource={deployedShaSource}
          targetSha={targetSha}
          lineageSha={mergePoints?.running?.sha ?? null}
          platformVersion={platformVersion}
        />
      </div>

      {enabled && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-xs"
          data-window-configured={windowConfigured ? "true" : "false"}
        >
          <span className="font-medium text-[var(--dpf-text)]">Schedule:</span>{" "}
          {blackoutUntil ? (
            <span className="text-[var(--dpf-warning)]" data-blackout="true">
              Scheduled upgrades paused
              {blackoutName ? (
                <>
                  {" "}— blackout{" "}
                  <span className="font-medium text-[var(--dpf-text)]">{blackoutName}</span>
                </>
              ) : null}{" "}
              until <LocalTime className="font-mono" value={blackoutUntil} />. They resume
              automatically; use Emergency override to run now.
            </span>
          ) : windowSource === "needs-timezone" ? (
            <span className="text-[var(--dpf-warning)]" data-window-source="needs-timezone">
              Your business runs 24/7. Set your timezone in{" "}
              <a className="underline" href="/storefront/settings/operations">
                Settings → Operating Hours
              </a>{" "}
              so upgrades can run automatically overnight, or choose a maintenance window.
            </span>
          ) : !windowConfigured ? (
            <span className="text-[var(--dpf-warning)]">
              No maintenance window configured — scheduled upgrades will not run
              on their own. Use Emergency override to run now.
            </span>
          ) : inMaintenanceWindow ? (
            <span className="text-[var(--dpf-success)]">
              In maintenance window now — next scheduled check: {" "}
              {nextScheduledCheckAt ? (
                <>
                  <LocalTime className="font-mono" value={nextScheduledCheckAt} />
                  <span>.</span>
                </>
              ) : (
                <>
                  <span className="font-mono">pending scheduler tick</span>
                  <span>.</span>
                </>
              )}
            </span>
          ) : nextWindowStart ? (
            <span className="text-[var(--dpf-muted)]">
              Next maintenance window:{" "}
              <LocalTime className="font-mono" value={nextWindowStart} /> —
              {nextScheduledCheckAt ? (
                <>
                  {" "}next scheduled check: {" "}
                  <LocalTime className="font-mono" value={nextScheduledCheckAt} />.
                </>
              ) : (
                " upgrades are evaluated hourly."
              )}
            </span>
          ) : (
            <span className="text-[var(--dpf-muted)]">
              Maintenance window configured.
            </span>
          )}
          {windowSource === "auto-overnight" && autoWindowSummary && (
            <div className="mt-1 text-[var(--dpf-muted)]" data-window-source="auto-overnight">
              Your business runs 24/7, so upgrades run overnight (around{" "}
              <span className="font-medium text-[var(--dpf-text)]">{autoWindowSummary}</span>
              {windowTimezone ? ` ${windowTimezone}` : ""}).
            </div>
          )}
          {windowTimezone && (
            <div className="mt-1 text-[var(--dpf-muted)]" data-window-timezone={windowTimezone}>
              Times shown in <span className="font-medium text-[var(--dpf-text)]">{windowTimezone}</span> — your
              operating-hours timezone. Change it in{" "}
              <a className="underline" href="/storefront/settings/operations">
                Settings → Operating Hours
              </a>
              .
            </div>
          )}
        </div>
      )}

      <UpgradeImpactPanel enabled={enabled} initialSummary={initialImpactSummary} />

      {enabled && !latestRun && (
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
          No runs yet.
        </div>
      )}

      {latestRun && (
        <div
          id="self-upgrade-latest-run" className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-2"
          data-run-status={latestRun.status}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--dpf-text)]">Latest Run</span>
            <StatusBadge
              domain="selfUpgradeRun"
              status={latestRun.status}
              label={statusLabel(latestRun.status)}
              variant="soft"
            />
            <span className="text-xs font-mono text-[var(--dpf-muted)]">{latestRun.runId}</span>
          </div>

          {queuedRun && (
            <div className="text-xs text-[var(--dpf-muted)]" data-upgrade-queued="true">
              Upgrade queued — waiting for the worker to accept this run.
            </div>
          )}

          {/* Scope of the upgrade in human terms. The raw 40-char SHA pair told
              an operator nothing about how big or risky a run is; lead with the
              plain-language headline + counts ribbon (breaking/new/fix) drawn
              from the impact summary this run recorded, and keep the shortened
              SHAs as the precise-but-secondary identity line. */}
          {latestRunImpact && (
            <UpgradeScopeRibbon
              surface="run"
              counts={latestRunImpact.counts}
              headline={latestRunImpact.headline}
            />
          )}

          {latestRun.currentSha && latestRun.targetSha && (
            <div className="text-xs text-[var(--dpf-muted)]" data-run-sha-range>
              <span className="text-[var(--dpf-muted)]">Change: </span>
              <span className="font-mono" title={latestRun.currentSha}>
                {shortSha(latestRun.currentSha)}
              </span>
              {" → "}
              <span className="font-mono" title={latestRun.targetSha}>
                {shortSha(latestRun.targetSha)}
              </span>
            </div>
          )}

          {latestRun.trigger && (
            <div className="text-xs text-[var(--dpf-muted)]">
              Triggered by: {latestRun.trigger}
            </div>
          )}

          {latestRun.startedAt ? (
            <div className="text-xs text-[var(--dpf-muted)]">
              Started:{" "}
              <LocalTime className="font-mono" value={latestRun.startedAt} />
              {latestRun.completedAt ? (
                <> · {formatDuration(latestRun.startedAt, latestRun.completedAt)}</>
              ) : (
                estimatedCompletionAt != null && (
                  <>
                    {" · est. done "}
                    <LocalTime
                      className="font-mono"
                      value={estimatedCompletionAt}
                      mode="time"
                    />
                  </>
                )
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--dpf-muted)]">
              Created:{" "}
              <LocalTime className="font-mono" value={latestRun.createdAt} />
            </div>
          )}

          {latestRun.completedAt && (
            <div className="text-xs text-[var(--dpf-muted)]">
              {latestRun.status === "failed" ? "Failed" : "Completed"}:{" "}
              <LocalTime className="font-mono" value={latestRun.completedAt} />
            </div>
          )}

          {latestRun.failureLog && (
            <details className="text-xs" data-dpf-purpose-correction-signal-key="failure-reason-visible">
              <summary className="cursor-pointer text-[var(--dpf-destructive)]">
                Error details
              </summary>
              <div className="mt-1 p-2 rounded bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)]">
                {latestRun.failureLog}
              </div>
            </details>
          )}
          <SelfUpgradeReadiness completionEvidence={latestRun.completionEvidence} />
          {/* A skipped run persists WHY on `reason`. Without surfacing it, the
              operator sees only a "skipped" badge with no words — the silent
              no-op an operator should never be left guessing about. */}
          {latestRun.status === "skipped" &&
            (() => {
              const explanation = describeSkipReason(latestRun.reason);
              if (!explanation) return null;
              return (
                <div
                  className="mt-1 p-2 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs space-y-1"
                  data-skip-reason={latestRun.reason ?? ""}
                >
                  <div className="font-medium text-[var(--dpf-text)]">
                    {explanation.title} — upgrade did not run
                  </div>
                  <div className="text-[var(--dpf-muted)]">{explanation.detail}</div>
                  {explanation.remedy && (
                    <div className="text-[var(--dpf-muted)]">{explanation.remedy}</div>
                  )}
                  {(latestRun.reason ?? "").startsWith("promoter-unavailable") && (
                    <div className="pt-1 space-y-1">
                      <button
                        type="button"
                        onClick={handleRepairPromoter}
                        disabled={isRepairPending}
                        className="min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-60"
                        data-testid="repair-promoter-button"
                      >
                        {isRepairPending ? "Building engine…" : "Build engine now"}
                      </button>
                      {repairResult && (
                        <div
                          className={
                            repairResult.status === "ok"
                              ? "text-[var(--dpf-success)]"
                              : "text-[var(--dpf-destructive)]"
                          }
                          data-repair-status={repairResult.status}
                        >
                          {repairResult.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

          {latestRecoveryPoint && (
            <div
              className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs"
              data-recovery-point-status={latestRecoveryPoint.status}
            >
              <div className="font-medium text-[var(--dpf-text)]">
                Recovery point: {latestRecoveryPoint.status}
              </div>
              <div className="mt-1 text-[var(--dpf-muted)]">
                {latestRecoveryPoint.members
                  .map((member) => recoveryMemberLabel(member))
                  .join(" · ")}
              </div>
              {latestRecoveryPoint.rollbackStatus && (
                <div
                  className="mt-1 text-[var(--dpf-muted)]"
                  data-rollback-status={latestRecoveryPoint.rollbackStatus}
                >
                  Rollback: {latestRecoveryPoint.rollbackStatus}
                </div>
              )}
              {canRollbackLatest && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={rollbackConfirmation}
                    onChange={(event) => setRollbackConfirmation(event.target.value)}
                    aria-label="Rollback confirmation"
                    placeholder="Type ROLLBACK"
                    className={RECOVERY_CONFIRMATION_CLASS}
                  />
                  <button
                    type="button"
                    onClick={() => handleRollback(latestRun.runId)}
                    disabled={
                      isRollbackPending ||
                      rollbackConfirmation !== "ROLLBACK"
                    }
                    aria-busy={isRollbackPending}
                    className={RECOVERY_ACTION_CLASS}
                  >
                    {isRollbackPending ? "Restoring..." : "Restore recovery point"}
                  </button>
                </div>
              )}
              {rollbackResult.status !== "idle" && (
                <div
                  className={`mt-2 rounded-md border px-2 py-1 ${
                    rollbackResult.status === "ok"
                      ? "border-[var(--dpf-success)]/30 bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]"
                      : "border-[var(--dpf-destructive)]/30 bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)]"
                  }`}
                >
                  {rollbackResult.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <span className="text-xs font-medium text-[var(--dpf-text)]">Run History</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--dpf-muted)] text-left">
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Run</th>
                <th className="px-3 py-1.5 font-medium">Change</th>
                <th className="px-3 py-1.5 font-medium text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                // Surface WHY a run didn't install — the reason is persisted but
                // was never shown per row (skipped/failed rows were a bare badge).
                // Skips carry a structured reason; failures carry a classified log.
                const skip =
                  run.status === "skipped" ? describeSkipReason(run.reason) : null;
                const failReason =
                  run.status === "failed" ? conciseFailureReason(run.failureLog) : null;
                const reasonText = skip ? `${skip.title} — ${skip.detail}` : failReason;
                return (
                  <Fragment key={run.runId}>
                    <tr
                      className="border-t border-[var(--dpf-border)]"
                      data-run-id={run.runId}
                    >
                      <td className="px-3 py-2 w-24 shrink-0">
                        <StatusBadge
                          domain="selfUpgradeRun"
                          status={run.status}
                          label={statusLabel(run.status)}
                          variant="soft"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--dpf-muted)]">{run.runId}</td>
                      <td className="px-3 py-2 text-[var(--dpf-muted)]">
                        {run.currentSha && run.targetSha ? (
                          <>
                            <span className="font-mono" title={run.currentSha}>
                              {shortSha(run.currentSha)}
                            </span>
                            {" → "}
                            <span className="font-mono" title={run.targetSha}>
                              {shortSha(run.targetSha)}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--dpf-muted)] whitespace-nowrap align-top">
                        <LocalTime value={run.startedAt ?? run.createdAt} />
                        {run.startedAt && run.completedAt && (
                          <span className="ml-1 opacity-70">
                            · {formatDuration(run.startedAt, run.completedAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {reasonText && (
                      <tr data-run-reason-for={run.runId}>
                        <td />
                        <td
                          colSpan={3}
                          className="px-3 pb-2 pt-0 text-[11px] text-[var(--dpf-muted)] align-top"
                        >
                          <span
                            className="opacity-80"
                            title={run.failureLog ?? run.reason ?? undefined}
                          >
                            {reasonText}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {historyNextCursor != null && (
            <div className="px-3 py-2 border-t border-[var(--dpf-border)]">
              <button
                type="button"
                className="text-xs text-[var(--dpf-accent)] hover:underline"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
