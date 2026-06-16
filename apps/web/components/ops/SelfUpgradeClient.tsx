"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  rollbackSelfUpgrade,
  triggerSelfUpgrade,
  forceActiveRun,
  abortActiveRun,
} from "@/lib/actions/promotions";
import { LocalTime } from "@/components/ui/LocalTime";
import UpgradeImpactPanel from "@/components/ops/UpgradeImpactPanel";
import type { SummaryResult } from "@/lib/self-upgrade/impact/types";
import { StatusBadge } from "@/components/ui/report-kit";
import { describeSkipReason } from "@/lib/self-upgrade/skip-reason";

type LatestRun = {
  runId: string;
  status: string;
  trigger: string | null;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  completionEvidence?: unknown;
  failureLog: string | null;
  createdAt: Date | string;
};

type RecoveryPointSummary = {
  status: string;
  members: Array<{ target: string; runId: string | null; status: string }>;
  rollbackStatus: string | null;
};

type ImageVersionSource = "git-sha" | "content-hash" | "unknown";

type QuiescenceBlockerLine = {
  surface: string;
  label: string;
  kind: "hard" | "soft";
  count: number;
  estimatedWaitMs: number | null;
};

type QuiescenceActivity = {
  level: "normal" | "draining" | "swapping";
  runId: string | null;
  enteredAt: string;
  run: {
    runId: string;
    status: string;
    trigger: string;
    targetVersion: string | null;
    targetBundleHash: string | null;
    deferSurface: string | null;
    deferReason: string | null;
    budgetMs: number | null;
    drainStartedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  blockersCapturedAt: string | null;
  blockers: QuiescenceBlockerLine[];
};

// §4.5 admission observability projection (apps/web/lib/queue/admission-observability.ts).
type AdmissionSnapshot = {
  lane: { enabled: boolean; limit: number | null; key: string };
  buildHolders: number;
  totalHolders: number;
  summary: string;
};

type Props = {
  enabled: boolean;
  channel: string;
  inMaintenanceWindow: boolean;
  windowConfigured?: boolean;
  nextWindowStart?: string | null;
  nextScheduledCheckAt?: string | null;
  deployedSha: string | null;
  deployedShaSource?: ImageVersionSource;
  targetSha: string | null;
  isFresh: boolean;
  latestRun: LatestRun | null;
  quiescence?: QuiescenceActivity | null;
  admission?: AdmissionSnapshot | null;
  cooldownUntil?: string | null;
  jobEngine?: {
    status: "healthy" | "degraded" | "unknown";
    detail: string | null;
    checkedAt: string | null;
  };
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
};

function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function sourceLabel(source: ImageVersionSource | undefined): string {
  switch (source) {
    case "git-sha":
      return "commit";
    case "content-hash":
      return "image hash";
    default:
      return "image";
  }
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
  channel,
  inMaintenanceWindow,
  windowConfigured,
  nextWindowStart,
  nextScheduledCheckAt,
  deployedSha,
  deployedShaSource,
  targetSha,
  isFresh,
  latestRun,
  quiescence,
  admission,
  cooldownUntil,
  jobEngine,
  history,
  historyNextCursor,
  initialImpactSummary,
  platformVersion,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRollbackPending, startRollbackTransition] = useTransition();
  const [override, setOverride] = useState(false);
  const [justQueued, setJustQueued] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ queued: boolean; reason?: string } | null>(null);
  // BI-4F3B2FA9: mid-flight Force Now / Abort controls for a running drain.
  const [forceConfirm, setForceConfirm] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [inFlightError, setInFlightError] = useState<string | null>(null);
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

  // The manual trigger only *queues* an upgrade: the server action returns
  // `{ queued: true }` in well under a second, but the Inngest worker still has
  // to fetch + compare SHAs before the run flips to "running". Without a held
  // state the button would snap straight back to "Upgrade now" while nothing
  // visibly happened — which reads as "broken" and invites repeat clicks (each
  // one firing another upgrade event). We hold a "Starting…" state until the run
  // actually appears, poll so progress shows up on its own, and time out as a
  // safety net if the queued event never materialises (e.g. skipped for cooldown).
  useEffect(() => {
    if (justQueued && upgradeInFlight) setJustQueued(false);
  }, [justQueued, upgradeInFlight]);

  useEffect(() => {
    if (!justQueued) return;
    const timeout = setTimeout(() => setJustQueued(false), 45_000);
    return () => clearTimeout(timeout);
  }, [justQueued]);

  useEffect(() => {
    if (!justQueued && !upgradeInFlight) return;
    const interval = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(interval);
  }, [justQueued, upgradeInFlight, router]);

  const triggerBusy = isPending || justQueued;

  function handleTrigger() {
    setTriggerResult(null);
    const force = override;
    startTransition(async () => {
      const result = await triggerSelfUpgrade(force ? { force: true } : undefined);
      setTriggerResult(result);
      if (result.queued) setJustQueued(true);
      router.refresh();
    });
  }

  // BI-4F3B2FA9: escalate the active drain to forced — coordinator bypasses
  // all blockers on its next tick (~5s) and swaps, without restarting the run.
  function handleForceNow() {
    const runId = quiescence?.run?.runId;
    if (!runId) return;
    setInFlightError(null);
    startTransition(async () => {
      const r = await forceActiveRun(runId);
      setForceConfirm(false);
      if (!r.ok) setInFlightError(r.error ?? "Force failed");
      router.refresh();
    });
  }

  // BI-4F3B2FA9: abort the active drain — level returns to normal so the
  // operator can immediately start a fresh run.
  function handleAbortRun() {
    const runId = quiescence?.run?.runId;
    if (!runId) return;
    setInFlightError(null);
    startTransition(async () => {
      const r = await abortActiveRun(runId);
      setAbortConfirm(false);
      if (!r.ok) setInFlightError(r.error ?? "Abort failed");
      router.refresh();
    });
  }

  function handleRollback(runId: string) {
    setRollbackResult({ status: "idle", message: "" });
    startRollbackTransition(async () => {
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
    });
  }

  return (
    <div className="space-y-4">
      {jobEngine?.status === "degraded" && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-warning)]/15 border border-[var(--dpf-warning)]/40 text-sm"
          role="alert"
          data-job-engine-health="degraded"
        >
          <div className="font-medium text-[var(--dpf-warning)]">
            ⚠ Background job engine isn’t dispatching
          </div>
          <div className="mt-1 text-[var(--dpf-muted)]">
            The portal couldn’t register its jobs with Inngest, so background work
            — self-upgrade, evals, backups, watchdogs — won’t run until this is
            fixed.{jobEngine.detail ? ` (${jobEngine.detail})` : ""} Restart the
            portal or check the Inngest service.
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              enabled ? "bg-[var(--dpf-success)]" : "bg-[var(--dpf-muted)]"
            }`}
          />
          <span className="text-sm font-medium text-[var(--dpf-text)]">
            Self-Upgrade:{" "}
            <span data-upgrade-status={enabled ? "enabled" : "disabled"}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </span>
          <span className="text-xs text-[var(--dpf-muted)]">({channel})</span>
        </div>

        {enabled && (
          <div className="flex items-center gap-3">
            {upgradeInFlight ? (
              // BI-4F3B2FA9: a run is in flight. Never a dead-end disabled
              // button — when the portal is draining, surface Force Now / Abort
              // so the operator's emergency lever actually works mid-flight.
              draining && quiescence?.run?.runId ? (
                <div className="flex items-center gap-2" role="group" aria-label="In-flight upgrade controls">
                  {inFlightError && (
                    <span className="text-xs text-[var(--dpf-warning)]" role="status" aria-live="polite">
                      {inFlightError}
                    </span>
                  )}
                  {forceConfirm ? (
                    <div role="alertdialog" aria-describedby="force-now-warning" className="flex items-center gap-2">
                      <span id="force-now-warning" className="text-xs text-[var(--dpf-warning)]">
                        ⚠ Bypass all in-flight work and swap now?
                      </span>
                      <button
                        type="button"
                        onClick={handleForceNow}
                        disabled={isPending}
                        className="px-2 py-1 text-xs rounded-lg bg-[var(--dpf-warning)]/20 text-[var(--dpf-warning)] border border-[var(--dpf-warning)]/40 disabled:opacity-50"
                      >
                        Confirm force
                      </button>
                      <button
                        type="button"
                        onClick={() => setForceConfirm(false)}
                        className="px-2 py-1 text-xs rounded-lg border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : abortConfirm ? (
                    <div role="alertdialog" aria-describedby="abort-warning" className="flex items-center gap-2">
                      <span id="abort-warning" className="text-xs text-[var(--dpf-muted)]">
                        Abort this drain?
                      </span>
                      <button
                        type="button"
                        onClick={handleAbortRun}
                        disabled={isPending}
                        className="px-2 py-1 text-xs rounded-lg bg-[var(--dpf-warning)]/20 text-[var(--dpf-warning)] border border-[var(--dpf-warning)]/40 disabled:opacity-50"
                      >
                        Confirm abort
                      </button>
                      <button
                        type="button"
                        onClick={() => setAbortConfirm(false)}
                        className="px-2 py-1 text-xs rounded-lg border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { setAbortConfirm(false); setForceConfirm(true); }}
                        aria-label={`Force upgrade run ${quiescence.run.runId} now`}
                        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--dpf-warning)]/20 text-[var(--dpf-warning)] border border-[var(--dpf-warning)]/40 hover:bg-[var(--dpf-warning)]/30 transition-colors"
                      >
                        ⚡ Force now
                      </button>
                      <button
                        type="button"
                        onClick={() => { setForceConfirm(false); setAbortConfirm(true); }}
                        aria-label={`Abort upgrade run ${quiescence.run.runId}`}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] transition-colors"
                      >
                        Abort
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <span
                  className="text-xs text-[var(--dpf-muted)]"
                  aria-live="polite"
                  data-upgrade-inflight="true"
                >
                  {queuedRun
                    ? "Upgrade queued — waiting for the worker…"
                    : "Upgrade in progress…"}
                </span>
              )
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-xs text-[var(--dpf-muted)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                    aria-label="Emergency override: bypass the safety drain"
                    title="Bypass the quiescence safety drain. Only for emergencies — it can interrupt in-flight work."
                    className="accent-[var(--dpf-warning)]"
                  />
                  Emergency override
                </label>
                <button
                  type="button"
                  onClick={handleTrigger}
                  disabled={triggerBusy}
                  aria-busy={triggerBusy}
                  aria-label="Upgrade now"
                  data-override={override ? "true" : "false"}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border border-[var(--dpf-accent)]/40 hover:bg-[var(--dpf-accent)]/30 transition-colors disabled:opacity-50"
                >
                  {isPending
                    ? "Upgrading..."
                    : justQueued
                      ? "Starting…"
                      : override
                        ? "Force upgrade now"
                        : "Upgrade now"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {enabled && triggerBusy && latestRun?.status !== "running" && !queuedRun && (
        <div
          className="text-xs text-[var(--dpf-muted)]"
          data-upgrade-starting="true"
          aria-live="polite"
        >
          Upgrade starting — the worker is checking for a new build. This can take
          a few seconds; progress will appear below. No need to click again.
        </div>
      )}

      {!enabled && (
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-sm text-[var(--dpf-muted)]">
          Self-upgrade is disabled. Enable it in settings to allow automated upgrades.
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

          {quiescence && quiescence.blockers.length > 0 && (
            <div className="text-xs">
              <div className="text-[var(--dpf-muted)] mb-1">
                {draining ? "Waiting on:" : "Was waiting on:"}
              </div>
              <ul className="space-y-1">
                {quiescence.blockers.map((b) => (
                  <li
                    key={b.surface}
                    className="flex items-center gap-2"
                    data-blocker-surface={b.surface}
                  >
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
        <div className="text-xs text-[var(--dpf-muted)]">
          <span className="font-medium text-[var(--dpf-text)]">Platform version:</span>{" "}
          <span className="font-mono text-[var(--dpf-text)]">
            v{platformVersion.version}
          </span>
        </div>
        <div className="text-[11px] text-[var(--dpf-muted)]">
          build{" "}
          {platformVersion.gitSha || platformVersion.imageVersion?.raw ? (
            <span className="font-mono">
              {shortSha(platformVersion.gitSha ?? platformVersion.imageVersion?.raw ?? null)}
            </span>
          ) : (
            <span className="font-mono">dev (unbuilt)</span>
          )}
          {platformVersion.imageVersion?.source && (
            <span className="ml-1">
              ({sourceLabel(platformVersion.imageVersion.source)})
            </span>
          )}
          {platformVersion.buildDate && (
            <span className="ml-1">
              · built <LocalTime value={platformVersion.buildDate} />
            </span>
          )}
        </div>
        {enabled && (
          <>
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-medium text-[var(--dpf-text)]">Deployed:</span>{" "}
              {deployedSha ? (
                <>
                  <span className="font-mono">{deployedSha}</span>
                  {deployedShaSource && deployedShaSource !== "unknown" && (
                    <span className="ml-2 text-[var(--dpf-muted)]">
                      ({sourceLabel(deployedShaSource)})
                    </span>
                  )}
                </>
              ) : (
                <span className="font-mono">unknown</span>
              )}
            </div>
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-medium text-[var(--dpf-text)]">Target:</span>{" "}
              <span className="font-mono">{targetSha ?? "unknown"}</span>
            </div>
            {isFresh && (
              <div className="text-xs text-[var(--dpf-success)]">Up to date</div>
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
          </>
        )}
      </div>

      {enabled && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-xs"
          data-window-configured={windowConfigured ? "true" : "false"}
        >
          <span className="font-medium text-[var(--dpf-text)]">Schedule:</span>{" "}
          {!windowConfigured ? (
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
          className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-2"
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

          {latestRun.currentSha && latestRun.targetSha && (
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-mono">{latestRun.currentSha}</span>
              {" → "}
              <span className="font-mono">{latestRun.targetSha}</span>
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
              {latestRun.completedAt && (
                <> · {formatDuration(latestRun.startedAt, latestRun.completedAt)}</>
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
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--dpf-destructive)]">
                Error details
              </summary>
              <div className="mt-1 p-2 rounded bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)]">
                {latestRun.failureLog}
              </div>
            </details>
          )}

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
                    className="w-full sm:w-44 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
                  />
                  <button
                    type="button"
                    onClick={() => handleRollback(latestRun.runId)}
                    disabled={
                      isRollbackPending ||
                      rollbackConfirmation !== "ROLLBACK"
                    }
                    aria-busy={isRollbackPending}
                    className="rounded-md border border-[var(--dpf-destructive)]/40 bg-[var(--dpf-destructive)]/10 px-3 py-1 text-xs font-medium text-[var(--dpf-destructive)] transition-colors hover:bg-[var(--dpf-destructive)]/20 disabled:opacity-50"
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
              {history.map((run) => (
                <tr
                  key={run.runId}
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
                        <span className="font-mono">{run.currentSha}</span>
                        {" → "}
                        <span className="font-mono">{run.targetSha}</span>
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
              ))}
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

      {triggerResult && (
        <div
          className={`p-3 rounded-lg text-sm ${
            triggerResult.queued
              ? "bg-[var(--dpf-success)]/10 text-[var(--dpf-success)] border border-[var(--dpf-success)]/30"
              : "bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)] border border-[var(--dpf-destructive)]/30"
          }`}
        >
          {triggerResult.queued ? "Upgrade queued." : `Not queued: ${triggerResult.reason}`}
        </div>
      )}
    </div>
  );
}
