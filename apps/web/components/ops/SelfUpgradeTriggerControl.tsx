"use client";

// apps/web/components/ops/SelfUpgradeTriggerControl.tsx
//
// BI-D77BF495: the single "Upgrade now" trigger, co-located with the
// OwnerReleaseCard release-status summary so it is visible on arrival in
// BOTH nav modes — not buried behind the "Deploy controls & history" Advanced
// disclosure (which PR #3457 forced open as a stopgap; now that the trigger
// lives here, that section can go back to collapsing by default in Simple
// mode without hiding the primary action).
//
// This is the ONLY place that owns trigger/force/abort state and calls
// triggerSelfUpgrade / forceActiveRun / abortActiveRun — SelfUpgradeClient's
// Advanced panel renders the read-only run/quiescence/history data derived
// from the SAME server props, but never re-triggers (no duplicated
// quiescence/queue/override semantics).

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { triggerSelfUpgrade, forceActiveRun, abortActiveRun } from "@/lib/actions/promotions";
import { isExpectedDuringSwap } from "@/lib/self-upgrade/is-expected-during-swap";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { LatestRun, QuiescenceActivity } from "@/lib/self-upgrade/run-types";
import type { SelfUpgradePurposeState } from "@/lib/self-upgrade/purpose-scenario";
import SelfUpgradeJobEngineHealthAlert, {
  shouldPollForJobEngineRecovery,
  type JobEngineHealth,
} from "@/components/ops/SelfUpgradeJobEngineHealthAlert";

export type SelfUpgradeControlActions = {
  trigger: typeof triggerSelfUpgrade;
  force: typeof forceActiveRun;
  abort: typeof abortActiveRun;
};

type Props = {
  enabled: boolean;
  channel: string;
  latestRun: LatestRun | null;
  quiescence?: QuiescenceActivity | null;
  jobEngine?: JobEngineHealth;
  purposeState?: SelfUpgradePurposeState;
  blockerReason?: string | null;
  recoveryHref?: string;
  recoveryLabel?: string;
  actions?: SelfUpgradeControlActions;
};

export default function SelfUpgradeTriggerControl({
  enabled,
  channel,
  latestRun,
  quiescence,
  jobEngine,
  purposeState = "update-available",
  blockerReason = null,
  recoveryHref = "/docs/operations/self-upgrade",
  recoveryLabel = "Open recovery guidance",
  actions = {
    trigger: triggerSelfUpgrade,
    force: forceActiveRun,
    abort: abortActiveRun,
  },
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [override, setOverride] = useState(false);
  const [justQueued, setJustQueued] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ queued: boolean; reason?: string } | null>(
    null,
  );
  const [forceConfirm, setForceConfirm] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [inFlightError, setInFlightError] = useState<string | null>(null);
  // A forced upgrade can swap this portal out from under the operator's own
  // request. `restarting` holds a calm reconnect banner (and keeps the status
  // poll alive) instead of letting the page paint the global crash screen.
  const [restarting, setRestarting] = useState(false);
  const restartBaselineRef = useRef<string | null>(null);
  const forceConfirmRef = useRef<HTMLButtonElement | null>(null);
  const abortConfirmRef = useRef<HTMLButtonElement | null>(null);

  const draining = !!quiescence && quiescence.level !== "normal";
  const queuedRun = latestRun?.status === "queued" || latestRun?.status === "pending";
  const upgradeInFlight = queuedRun || latestRun?.status === "running" || draining;
  const triggerBusy = isPending || justQueued;

  // The manual trigger only *queues* an upgrade: the server action returns
  // `{ queued: true }` in well under a second, but the worker still has to
  // fetch + compare SHAs before the run flips to "running". Hold a
  // "Starting…" state until the run actually appears, poll so progress shows
  // up on its own, and time out as a safety net if the queued event never
  // materialises (e.g. skipped for cooldown).
  useEffect(() => {
    if (justQueued && upgradeInFlight) setJustQueued(false);
  }, [justQueued, upgradeInFlight]);

  useEffect(() => {
    if (!justQueued) return;
    const timeout = setTimeout(() => setJustQueued(false), 45_000);
    return () => clearTimeout(timeout);
  }, [justQueued]);

  useEffect(() => {
    if (!justQueued && !upgradeInFlight && !restarting) return;
    const interval = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(interval);
  }, [justQueued, upgradeInFlight, restarting, router]);

  useEffect(() => {
    if (!shouldPollForJobEngineRecovery(jobEngine)) return;
    const interval = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(interval);
  }, [jobEngine, router]);

  // A compact fingerprint of the server-derived state. When it changes after
  // a swap-induced disconnect, the new container has answered and the
  // reconnect banner can clear.
  function serverSignature(): string {
    return [latestRun?.runId ?? "", latestRun?.status ?? "", quiescence?.level ?? ""].join("|");
  }

  useEffect(() => {
    if (!restarting || restartBaselineRef.current === null) return;
    if (serverSignature() !== restartBaselineRef.current) {
      restartBaselineRef.current = null;
      setRestarting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restarting, latestRun?.runId, latestRun?.status, quiescence?.level]);

  // Safety net: never let the reconnect banner wedge if the portal stays
  // unreachable (e.g. a swap that genuinely failed).
  useEffect(() => {
    if (!restarting) return;
    const timeout = setTimeout(() => {
      restartBaselineRef.current = null;
      setRestarting(false);
    }, 120_000);
    return () => clearTimeout(timeout);
  }, [restarting]);

  useEffect(() => {
    if (forceConfirm) forceConfirmRef.current?.focus();
  }, [forceConfirm]);

  useEffect(() => {
    if (abortConfirm) abortConfirmRef.current?.focus();
  }, [abortConfirm]);

  function enterRestarting() {
    restartBaselineRef.current = serverSignature();
    setRestarting(true);
    setJustQueued(true);
    router.refresh();
  }

  function handleTrigger() {
    setTriggerResult(null);
    setInFlightError(null);
    const force = override;
    startTransition(async () => {
      try {
        const result = await actions.trigger(force ? { force: true } : undefined);
        setTriggerResult(result);
        if (result.queued) setJustQueued(true);
        router.refresh();
      } catch (err) {
        if (isExpectedDuringSwap(err)) {
          enterRestarting();
        } else {
          setTriggerResult({ queued: false, reason: getErrorMessage(err) || "trigger failed" });
        }
      }
    });
  }

  // BI-4F3B2FA9: escalate the active drain to forced — coordinator bypasses
  // all blockers on its next tick (~5s) and swaps, without restarting the run.
  function handleForceNow() {
    const runId = quiescence?.run?.runId;
    if (!runId) return;
    setInFlightError(null);
    startTransition(async () => {
      try {
        const r = await actions.force(runId);
        setForceConfirm(false);
        if (!r.ok) setInFlightError(r.error ?? "Force failed");
        router.refresh();
      } catch (err) {
        setForceConfirm(false);
        if (isExpectedDuringSwap(err)) {
          enterRestarting();
        } else {
          setInFlightError(getErrorMessage(err) || "Force failed");
        }
      }
    });
  }

  // BI-4F3B2FA9: abort the active drain — level returns to normal so the
  // operator can immediately start a fresh run.
  function handleAbortRun() {
    const runId = quiescence?.run?.runId;
    if (!runId) return;
    setInFlightError(null);
    startTransition(async () => {
      try {
        const r = await actions.abort(runId);
        setAbortConfirm(false);
        if (!r.ok) setInFlightError(r.error ?? "Abort failed");
        router.refresh();
      } catch (err) {
        setAbortConfirm(false);
        if (isExpectedDuringSwap(err)) {
          enterRestarting();
        } else {
          setInFlightError(getErrorMessage(err) || "Abort failed");
        }
      }
    });
  }

  if (purposeState === "current") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm"
        data-dpf-purpose-message-key="current-status"
        data-dpf-purpose-completion-signal-key="current-version-visible"
      >
        <span className="text-[var(--dpf-text)]">No update action is needed.</span>
        <a
          href="/ops/self-upgrade"
          aria-label="Refresh update status"
          title="Refresh update status"
          data-dpf-purpose-correction-signal-key="status-refresh"
          className="inline-flex size-11 items-center justify-center rounded-lg text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-1)]"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
        </a>
        <a
          href="/docs/operations/self-upgrade"
          data-dpf-purpose-action-key="open-recovery-guidance"
          className="inline-flex min-h-11 items-center text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Recovery guidance
        </a>
      </div>
    );
  }

  if (purposeState === "failed-recoverable") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <a
          href="#self-upgrade-latest-run"
          data-dpf-primary-action
          data-owner-first-next-action
          data-dpf-purpose-action-key="open-recovery-controls"
          data-dpf-purpose-completion-signal-key="recovery-controls-reachable"
          className="inline-flex min-h-11 items-center rounded-lg bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Review recovery controls
        </a>
        <a
          href="/docs/operations/self-upgrade"
          data-dpf-purpose-action-key="open-recovery-guidance"
          className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Recovery guidance
        </a>
      </div>
    );
  }

  if (!enabled || purposeState === "blocked") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm"
        data-upgrade-status="disabled"
      >
        <span
          className="text-[var(--dpf-muted)]"
          data-dpf-purpose-correction-signal-key="blocker-reason-visible"
        >
          {blockerReason ??
            "Self-upgrade is disabled. Resolve the prerequisite before starting an update."}
        </span>
        <a
          href={recoveryHref}
          data-dpf-primary-action
          data-owner-first-next-action
          data-dpf-purpose-action-key="resolve-blocker"
          data-dpf-purpose-completion-signal-key="blocker-route-reachable"
          className="inline-flex min-h-11 items-center rounded-lg bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {recoveryLabel}
        </a>
        <a
          href="/docs/operations/self-upgrade"
          data-dpf-purpose-action-key="open-recovery-guidance"
          className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Recovery guidance
        </a>
      </div>
    );
  }

  return (
    <div
      className="space-y-2"
      data-component="self-upgrade-trigger-control"
      data-dpf-purpose-message-key={
        purposeState === "queued-or-running" ? "upgrade-progress" : undefined
      }
    >
      {restarting && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-info)]/10 border border-[var(--dpf-info)]/30 text-sm text-[var(--dpf-text)]"
          role="status"
          aria-live="polite"
          data-upgrade-restarting="true"
        >
          <span className="font-medium">Applying the upgrade…</span> the portal is
          restarting to finish the swap. This page reconnects automatically — no
          need to refresh.
        </div>
      )}

      <SelfUpgradeJobEngineHealthAlert jobEngine={jobEngine} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--dpf-success)]" />
          <span className="text-sm font-medium text-[var(--dpf-text)]">
            Self-Upgrade: <span data-upgrade-status="enabled">Enabled</span>
          </span>
          <span className="text-xs text-[var(--dpf-muted)]">({channel})</span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {upgradeInFlight ? (
            // BI-4F3B2FA9: a run is in flight. Never a dead-end disabled
            // button — when the portal is draining, surface Force Now / Abort
            // so the operator's emergency lever actually works mid-flight.
            draining && quiescence?.run?.runId ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="In-flight upgrade controls">
                {inFlightError && (
                  <span className="text-xs text-[var(--dpf-warning)]" role="alert">
                    {inFlightError}
                  </span>
                )}
                {forceConfirm ? (
                  <div role="group" aria-labelledby="force-now-warning" className="flex min-w-0 flex-wrap items-center gap-2">
                    <span id="force-now-warning" className="inline-flex items-center gap-1 text-xs text-[var(--dpf-warning)]">
                      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                      Bypass all in-flight work and swap now?
                    </span>
                    <button
                      ref={forceConfirmRef}
                      type="button"
                      onClick={handleForceNow}
                      disabled={isPending}
                      className="min-h-11 rounded-lg border border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/20 px-3 py-2 text-xs text-[var(--dpf-warning)] disabled:opacity-50"
                    >
                      Confirm force
                    </button>
                    <button
                      type="button"
                      onClick={() => setForceConfirm(false)}
                      className="min-h-11 rounded-lg border border-[var(--dpf-border)] px-3 py-2 text-xs text-[var(--dpf-muted)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : abortConfirm ? (
                  <div role="group" aria-labelledby="abort-warning" className="flex min-w-0 flex-wrap items-center gap-2">
                    <span id="abort-warning" className="text-xs text-[var(--dpf-muted)]">
                      Abort this drain?
                    </span>
                    <button
                      ref={abortConfirmRef}
                      type="button"
                      onClick={handleAbortRun}
                      disabled={isPending}
                      className="min-h-11 rounded-lg border border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/20 px-3 py-2 text-xs text-[var(--dpf-warning)] disabled:opacity-50"
                    >
                      Confirm abort
                    </button>
                    <button
                      type="button"
                      onClick={() => setAbortConfirm(false)}
                      className="min-h-11 rounded-lg border border-[var(--dpf-border)] px-3 py-2 text-xs text-[var(--dpf-muted)]"
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
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/20 px-3 py-2 text-xs text-[var(--dpf-warning)] transition-colors hover:bg-[var(--dpf-warning)]/30"
                    >
                      <Zap aria-hidden="true" className="size-4" />
                      Force now
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForceConfirm(false); setAbortConfirm(true); }}
                      aria-label={`Abort upgrade run ${quiescence.run.runId}`}
                      className="min-h-11 rounded-lg border border-[var(--dpf-border)] px-3 py-2 text-xs text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-2)]"
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
                data-dpf-purpose-completion-signal-key="upgrade-progress-visible"
              >
                {queuedRun
                  ? "Upgrade queued — waiting for the worker…"
                  : "Upgrade in progress…"}
              </span>
            )
          ) : (
            <>
              <label className="flex min-h-11 items-center gap-2 px-1 text-xs text-[var(--dpf-muted)] cursor-pointer select-none">
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
                data-owner-first-next-action
                data-dpf-primary-action
                data-dpf-purpose-action-key="start-upgrade"
                data-dpf-purpose-confirmation="explicit"
                className="min-h-11 rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isPending
                  ? "Upgrading..."
                  : justQueued
                    ? "Starting…"
                    : override
                      ? "Force upgrade now"
                      : "Upgrade now"}
              </button>
              <a
                href="/docs/operations/self-upgrade"
                data-dpf-purpose-action-key="open-recovery-guidance"
                className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] underline-offset-2 hover:underline"
              >
                Recovery guidance
              </a>
            </>
          )}
        </div>
      </div>

      {upgradeInFlight && (
        <a
          href="/docs/operations/self-upgrade"
          data-dpf-purpose-action-key="open-recovery-guidance"
          data-dpf-purpose-correction-signal-key="stalled-run-recovery"
          className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Recovery guidance
        </a>
      )}

      {triggerBusy && latestRun?.status !== "running" && !queuedRun && (
        <div
          className="text-xs text-[var(--dpf-muted)]"
          data-upgrade-starting="true"
          aria-live="polite"
        >
          Upgrade starting — the worker is checking for a new build. This can take
          a few seconds; progress will appear below. No need to click again.
        </div>
      )}

      {triggerResult && (
        <div
          role="status"
          aria-live="polite"
          data-dpf-purpose-completion-signal-key={
            triggerResult.queued ? "upgrade-queue-acknowledgement" : undefined
          }
          data-dpf-purpose-correction-signal-key={
            triggerResult.queued ? undefined : "upgrade-request-error"
          }
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
