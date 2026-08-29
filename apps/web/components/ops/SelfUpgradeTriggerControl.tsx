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
import { triggerSelfUpgrade, forceActiveRun, abortActiveRun } from "@/lib/actions/promotions";
import { isExpectedDuringSwap } from "@/lib/self-upgrade/is-expected-during-swap";
import {
  describeSelfUpgradeActionState,
  SELF_UPGRADE_ACTION_STATE,
  type SelfUpgradeActionState,
} from "@/lib/self-upgrade/action-state";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { LatestRun, QuiescenceActivity } from "@/lib/self-upgrade/run-types";
import SelfUpgradeJobEngineHealthAlert, {
  type JobEngineHealth,
} from "@/components/ops/SelfUpgradeJobEngineHealthAlert";
import { useOptionalSelfUpgradeLive } from "@/components/ops/SelfUpgradeLiveProvider";

type Props = {
  enabled: boolean;
  actionState: SelfUpgradeActionState;
  unavailableReason?: string | null;
  channel: string;
  latestRun: LatestRun | null;
  quiescence?: QuiescenceActivity | null;
  jobEngine?: JobEngineHealth;
  targetSha?: string | null;
  targetTag?: string | null;
};

export default function SelfUpgradeTriggerControl({
  enabled,
  actionState,
  unavailableReason,
  channel,
  latestRun: initialLatestRun,
  quiescence: initialQuiescence,
  jobEngine: initialJobEngine,
  targetSha,
  targetTag,
}: Props) {
  const router = useRouter();
  const live = useOptionalSelfUpgradeLive();
  const latestRun = live?.snapshot.latestRun ?? initialLatestRun;
  const quiescence = live?.snapshot.quiescence ?? initialQuiescence;
  const jobEngine = live?.snapshot.jobEngine ?? initialJobEngine;
  const [isPending, startTransition] = useTransition();
  const [override, setOverride] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{
    queued: boolean;
    reason?: string;
    runId?: string;
    dispatchStatus?: string;
    uncertain?: boolean;
  } | null>(null);
  const [admissionUncertain, setAdmissionUncertain] = useState(false);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [inFlightError, setInFlightError] = useState<string | null>(null);
  // A forced upgrade can swap this portal out from under the operator's own
  // request. `restarting` holds a calm reconnect banner (and keeps the status
  // poll alive) instead of letting the page paint the global crash screen.
  const [restarting, setRestarting] = useState(false);
  const restartBaselineRef = useRef<string | null>(null);
  const admissionBaselineRef = useRef<string | null>(null);

  const draining = !!quiescence && quiescence.level !== "normal";
  const queuedRun = latestRun?.status === "queued" || latestRun?.status === "pending";
  const upgradeInFlight = queuedRun || latestRun?.status === "running" || draining;
  const triggerBusy = isPending || admissionUncertain;
  const updateAvailable = actionState === SELF_UPGRADE_ACTION_STATE.UPDATE_AVAILABLE;

  // A compact fingerprint of the server-derived state. When it changes after
  // a swap-induced disconnect, the new container has answered and the
  // reconnect banner can clear.
  function serverSignature(): string {
    return [
      latestRun?.runId ?? "",
      latestRun?.status ?? "",
      latestRun?.dispatchStatus ?? "",
      quiescence?.level ?? "",
    ].join("|");
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

  function enterRestarting() {
    restartBaselineRef.current = serverSignature();
    setRestarting(true);
    refreshStatus();
  }

  function refreshStatus() {
    if (live) {
      void live.refresh();
    } else {
      // Isolated rendering/tests outside the route provider retain the old
      // bounded mutation behavior; production is always provider-backed.
      router.refresh();
    }
  }

  function handleTrigger() {
    setTriggerResult(null);
    setInFlightError(null);
    const force = override;
    admissionBaselineRef.current = serverSignature();
    startTransition(async () => {
      try {
        const result = await triggerSelfUpgrade({
          ...(force ? { force: true } : {}),
          expectedTargetSha: targetSha,
          expectedTargetTag: targetTag,
        });
        setTriggerResult(result);
        setAdmissionUncertain(false);
        admissionBaselineRef.current = null;
        refreshStatus();
      } catch (err) {
        // A severed trigger response is ambiguous: the server may already
        // have persisted the admission even though the browser never received
        // its result. Keep the mutation latched until durable server state
        // changes. Force/abort requests are different because they already
        // bind an existing run and can use the bounded swap-reconnect state.
        setAdmissionUncertain(true);
        setTriggerResult({
          queued: false,
          uncertain: true,
          reason: getErrorMessage(err) || "The admission response was interrupted.",
        });
        refreshStatus();
      }
    });
  }

  useEffect(() => {
    if (!admissionUncertain || admissionBaselineRef.current === null) return;
    if (serverSignature() !== admissionBaselineRef.current) {
      admissionBaselineRef.current = null;
      setAdmissionUncertain(false);
      setTriggerResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionUncertain, latestRun?.runId, latestRun?.status, latestRun?.dispatchStatus]);

  // BI-4F3B2FA9: escalate the active drain to forced — coordinator bypasses
  // all blockers on its next tick (~5s) and swaps, without restarting the run.
  function handleForceNow() {
    const runId = quiescence?.run?.runId;
    if (!runId) return;
    setInFlightError(null);
    startTransition(async () => {
      try {
        const r = await forceActiveRun(runId);
        setForceConfirm(false);
        if (!r.ok) setInFlightError(r.error ?? "Force failed");
        refreshStatus();
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
        const r = await abortActiveRun(runId);
        setAbortConfirm(false);
        if (!r.ok) setInFlightError(r.error ?? "Abort failed");
        refreshStatus();
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

  if (!enabled) {
    return (
      <div
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-muted)]"
        data-upgrade-status={unavailableReason ? "unavailable" : "disabled"}
      >
        {unavailableReason ??
          "Self-upgrade is disabled. Enable it in settings to allow automated upgrades."}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-component="self-upgrade-trigger-control">
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

      {latestRun?.dispatchStatus === "dispatch_failed" && (
        <div
          className="rounded-lg border border-[var(--dpf-destructive)]/30 bg-[var(--dpf-destructive)]/10 p-3 text-sm text-[var(--dpf-destructive)]"
          role="status"
          data-upgrade-dispatch-failed="true"
        >
          Upgrade admission {latestRun.runId} was not dispatched. {latestRun.dispatchError ?? "Review job-engine health before trying again."}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--dpf-success)]" aria-hidden="true" />
          <span className="text-sm font-medium text-[var(--dpf-text)]">
            Self-Upgrade: <span data-upgrade-status="enabled">Enabled</span>
          </span>
          <span className="text-xs text-[var(--dpf-muted)]">({channel})</span>
        </div>

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
                  ? latestRun?.dispatchStatus === "indeterminate"
                    ? `Upgrade ${latestRun.runId} admitted — dispatch outcome is being reconciled…`
                    : latestRun?.dispatchStatus === "dispatching"
                      ? `Upgrade ${latestRun.runId} admitted — dispatching to the worker…`
                      : latestRun?.dispatchStatus === "admission_pending"
                        ? `Upgrade ${latestRun.runId} admitted — waiting for dispatch…`
                        : "Upgrade queued — waiting for the worker…"
                  : "Upgrade in progress…"}
              </span>
            )
          ) : (
            <>
            {updateAvailable ? (
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
                data-owner-first-next-action
                data-dpf-primary-action
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--dpf-accent)] text-white border border-[var(--dpf-accent)] shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isPending
                  ? "Admitting…"
                  : override
                      ? "Force upgrade now"
                      : "Upgrade now"}
              </button>
              </>
            ) : (
              <span
                className="text-xs text-[var(--dpf-muted)]"
                data-upgrade-action-state={actionState}
                role="status"
              >
                {describeSelfUpgradeActionState(actionState)}
              </span>
            )}
            </>
          )}
        </div>
      </div>

      {updateAvailable && isPending && latestRun?.status !== "running" && !queuedRun && (
        <div
          className="text-xs text-[var(--dpf-muted)]"
          data-upgrade-starting="true"
          aria-live="polite"
        >
          Recording this upgrade before dispatch. Keep this page open; the durable
          run will appear below as soon as admission commits.
        </div>
      )}

      {updateAvailable && triggerResult && (
        <div
          className={`p-3 rounded-lg text-sm ${
            triggerResult.uncertain
              ? "bg-[var(--dpf-info)]/10 text-[var(--dpf-text)] border border-[var(--dpf-info)]/30"
              : triggerResult.queued
              ? "bg-[var(--dpf-success)]/10 text-[var(--dpf-success)] border border-[var(--dpf-success)]/30"
              : "bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)] border border-[var(--dpf-destructive)]/30"
          }`}
        >
          {triggerResult.uncertain
            ? `Admission response interrupted: ${triggerResult.reason} The server record is being checked; do not click again.`
            : triggerResult.queued
            ? `Upgrade admitted${triggerResult.runId ? ` as ${triggerResult.runId}` : ""}. Dispatch is tracked by this run; do not click again.`
            : `Not admitted: ${triggerResult.reason}`}
        </div>
      )}
    </div>
  );
}
