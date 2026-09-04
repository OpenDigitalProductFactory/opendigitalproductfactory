"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/report-kit";
import { Spinner } from "@/components/ui/Spinner";
import {
  advanceBuildPhase,
  approveBuildStart,
  recordBuildAcceptance,
  runBuildReviewVerification,
  resumeBuildImplementation,
  resetBuildExecution,
  retryBuildExecution,
  rerunPlanReview,
} from "@/lib/actions/build";
import { captureDecisionInteraction } from "@/lib/actions/decision-perspective";
import type { ResumeBuildImplementationOutcome } from "@/lib/build/progress-visibility-types";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { DecisionGateCaptureDraft } from "@/lib/decision-perspective/capture-types";
import { ActionBanner, type ActionBannerState } from "./ActionBanner";
import { BuildStudioCustodianCallout } from "./BuildStudioCustodianCallout";
import type { BuildStudioCustodianPrompt } from "./build-studio-custodian";
import { DecisionPerspectiveGatePanel } from "./DecisionPerspectiveGatePanel";
import { TruthSourceBadge } from "./TruthSourceBadge";
import {
  deriveBuildStudioOperatorGuidance,
  type BuildStudioWorkflowAction,
} from "./build-studio-workflow-actions";

type Props = {
  build: FeatureBuildRow;
  action: BuildStudioWorkflowAction;
  compact?: boolean;
  custodianPrompt?: BuildStudioCustodianPrompt | null;
  onCustodianSnooze?: (prompt: BuildStudioCustodianPrompt) => void;
  onCompleted?: () => Promise<void> | void;
};

/**
 * Map (build phase + action.disabledReason) onto an ActionBannerState.
 *
 * The card carries dispatch + derivation logic; the banner is just a
 * compact presentation. This helper is the contract between the two —
 * extracted so T9's delegation can be tested without instantiating the
 * full card and so the derivation rule lives in one place.
 *
 * Precedence:
 *   1. disabledReason set → "blocked" (operator needs to clear an upstream gap)
 *   2. phase=failed → "review_failed"
 *   3. phase=complete → "complete"
 *   4. phase ∈ {build, review} → "running" (sandbox flow in motion)
 *   5. fallback → "ready"
 */
export function deriveActionBannerState(
  build: Pick<FeatureBuildRow, "phase">,
  action: Pick<BuildStudioWorkflowAction, "disabledReason">,
): ActionBannerState {
  // BI-A2F3FA9D — terminal escalate-to-human handoff. Checked before
  // disabledReason so it always wins (an abandoned build carries none anyway).
  if (build.phase === "abandoned") return "escalated";
  if (action.disabledReason) return "blocked";
  if (build.phase === "failed") return "review_failed";
  if (build.phase === "complete") return "complete";
  if (build.phase === "build" || build.phase === "review") return "running";
  return "ready";
}

export function BuildStudioWorkflowActionCard({
  build,
  action,
  compact = false,
  custodianPrompt = null,
  onCustodianSnooze,
  onCompleted,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ResumeBuildImplementationOutcome | null>(null);

  const primaryEnabled = action.kind !== "review-only" && action.disabledReason == null;
  const operatorGuidance = useMemo(() => deriveBuildStudioOperatorGuidance(action, build), [action, build]);
  const decisionInteraction =
    action.kind === "advance-phase" && action.targetPhase === "build"
      ? build.decisionInteraction ?? null
      : null;

  const [voiceOutput, setVoiceOutput] = useState<{ audioStorageKey: string; durationMs: number } | null>(null);

  // Poll for stored voice output when a decision interaction is present.
  // DecisionInteractionGateView only carries profileId, not the full profile —
  // skip the voiceEnabled guard here and let the gate panel handle visibility.
  useEffect(() => {
    const interactionId = decisionInteraction?.interactionId;
    if (!interactionId) {
      setVoiceOutput(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 4;
    const POLL_INTERVAL_MS = 2000;

    async function poll() {
      if (cancelled || attempts >= MAX_ATTEMPTS) return;
      attempts++;
      try {
        const res = await fetch(`/api/voice/audio/status?interactionId=${encodeURIComponent(interactionId!)}`)
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setVoiceOutput(data as { audioStorageKey: string; durationMs: number });
            return; // stop polling once found
          }
        }
      } catch {
        // Non-fatal — voice output may not exist yet
      }
      if (!cancelled && attempts < MAX_ATTEMPTS) {
        setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [decisionInteraction?.interactionId]);
  const primaryLabel = useMemo(() => {
    if (action.primaryLabel == null) {
      return null;
    }
    if (!pending) {
      return action.primaryLabel;
    }
    switch (action.kind) {
      case "approve-start":
        return "Recording approval...";
      case "run-review-verification":
        return "Running UX verification...";
      case "record-acceptance":
        return "Recording acceptance...";
      case "advance-phase":
        if (action.targetPhase === "build") {
          return "Starting implementation...";
        }
        if (action.targetPhase === "review") {
          return "Starting verification...";
        }
        return "Opening release decisions...";
      case "retry-build":
        return "Retrying build...";
      case "retry-inference":
        return "Retrying the AI call...";
      case "reset-build":
        return "Resetting build...";
      case "resume-implementation":
        return "Reopening implementation...";
      case "rerun-plan-review":
        return "Re-running plan review...";
      case "decompose-now":
        return "Opening decomposition...";
      case "amend-parent-design":
        return "Opening parent design...";
      default:
        return action.primaryLabel;
    }
  }, [action, pending]);

  async function handlePrimaryAction() {
    if (!primaryEnabled) {
      return;
    }
    setPending(true);
    setError(null);
    setLastOutcome(null);
    try {
      // BI-8C6AA60E / BI-CE1AB982: an expected operational refusal ("no releasable
      // source changes", "no engine can run this") comes back as a value, because a
      // thrown Error is stripped to a production digest and the operator needs the cause.
      let refusal: { ok: boolean; message?: string; error?: string } | null = null;
      if (action.kind === "approve-start") {
        refusal = await approveBuildStart(build.buildId);
      } else if (action.kind === "record-acceptance") {
        await recordBuildAcceptance(build.buildId);
      } else if (action.kind === "run-review-verification") {
        await runBuildReviewVerification(build.buildId);
      } else if (action.kind === "advance-phase" && action.targetPhase) {
        refusal = await advanceBuildPhase(build.buildId, action.targetPhase);
      } else if (action.kind === "retry-inference") {
        // BI-F0005EB0 — the AI call errored. Re-drive the failed coworker turn
        // (the same recovery the user does by re-prompting today) by opening the
        // coworker panel with a retry message. The server-side bounded auto-retry
        // handles transient failures before we ever get here.
        openCoworkerPanel(action.coworkerPrompt, action.message);
      } else if (action.kind === "retry-build") {
        await retryBuildExecution(build.buildId);
      } else if (action.kind === "reset-build") {
        await resetBuildExecution(build.buildId);
      } else if (action.kind === "resume-implementation") {
        setLastOutcome(await resumeBuildImplementation(build.buildId));
      } else if (action.kind === "rerun-plan-review") {
        // BI-E1CB0522 — re-run the canonical plan reviewer. A re-run that now
        // passes auto-advances plan->build server-side; router.refresh() below
        // picks up the new phase + cleared planReview.
        const outcome = await rerunPlanReview(build.buildId);
        if (!outcome.success) {
          setError(outcome.message);
        }
      } else if (action.kind === "decompose-now") {
        document.dispatchEvent(
          new CustomEvent("open-build-decomposition", {
            detail: { buildId: build.buildId },
          }),
        );
      } else if (action.kind === "amend-parent-design") {
        document.dispatchEvent(
          new CustomEvent("open-parent-design-amendment", {
            detail: { buildId: build.buildId },
          }),
        );
      }
      if (refusal && !refusal.ok) return setError(refusal.error ?? refusal.message ?? "That could not be completed.");

      window.dispatchEvent(
        new CustomEvent("build-progress-update", {
          detail: {
            type: "phase:change",
            buildId: build.buildId,
          },
        }),
      );
      router.refresh();
      await onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action could not be completed.");
      router.refresh();
      await onCompleted?.();
    } finally {
      setPending(false);
    }
  }

  function handleCoworkerAction() {
    openCoworkerPanel(action.coworkerPrompt, action.message);
  }

  /** Nudge the coworker on the owner's behalf. `prompt` stays machine-precise;
   *  `display` is what the owner sees — otherwise internal tool names land in
   *  their own transcript as if they had typed them. */
  function openCoworkerPanel(prompt: string, display?: string) {
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: prompt,
          displayMessage: display,
          targetBuildId: build.buildId,
        },
      }),
    );
  }

  async function handleCustodianPrimaryAction(prompt: BuildStudioCustodianPrompt) {
    if (prompt.primaryAction === "workflow") {
      await handlePrimaryAction();
      return;
    }
    openCoworkerPanel(prompt.coworkerPrompt, prompt.recommendedAction);
  }

  async function handleDecisionCapture(capture: DecisionGateCaptureDraft) {
    await captureDecisionInteraction({
      buildId: build.buildId,
      ...capture,
    });
    window.dispatchEvent(
      new CustomEvent("build-progress-update", {
        detail: {
          type: "wwmd:capture",
          buildId: build.buildId,
        },
      }),
    );
    router.refresh();
    await onCompleted?.();
  }

  // ── Compact rendering — delegate to ActionBanner ───────────────────────
  // Per spec §6, the BuildStudio shell mounts a 40px pinned ActionBanner
  // at the top of the active-build zone instead of the legacy ~200px card.
  // The derivation logic (action computation, dispatch flow, decision
  // interaction) stays in this file — the banner only changes presentation.
  //
  // If there's an open decision interaction that needs capture, fall back to
  // the full card so the DecisionPerspectiveGatePanel still renders — the
  // 40px banner has no room for the capture UI.
  const compactBannerEligible = compact && !decisionInteraction;
  if (compactBannerEligible) {
    if (custodianPrompt) {
      return (
        <div data-testid="build-studio-workflow-action-card">
          <BuildStudioCustodianCallout
            prompt={custodianPrompt}
            onPrimaryAction={() => void handleCustodianPrimaryAction(custodianPrompt)}
            onSnooze={() => onCustodianSnooze?.(custodianPrompt)}
          />
          {error && (
            <div
              role="alert"
              className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-2 text-xs text-[var(--dpf-danger)]"
            >
              {error}
            </div>
          )}
        </div>
      );
    }

    const bannerState = deriveActionBannerState(build, action);
    // BI-A2F3FA9D — terminal escalate-to-human handoff. The build is a human's
    // now: the primary affordance is a link to the parked backlog item (resume
    // path), and the detail line carries the human-readable escalation reason.
    const bannerPrimaryAction = action.kind === "escalated-to-human"
      ? { label: "Open parked item", onClick: () => router.push(action.resumeHref) }
      : operatorGuidance.nextLabel
      ? {
        label: operatorGuidance.useCoworkerForNext ? operatorGuidance.nextLabel : (primaryLabel ?? operatorGuidance.nextLabel),
        onClick: operatorGuidance.useCoworkerForNext ? handleCoworkerAction : handlePrimaryAction,
        disabled: operatorGuidance.useCoworkerForNext ? false : (!primaryEnabled || pending),
      }
      : undefined;
    const bannerDetail = action.kind === "escalated-to-human"
      ? (action.abandonReason ?? undefined)
      : (action.disabledReason ?? undefined);
    return (
      <div data-testid="build-studio-workflow-action-card">
        <ActionBanner
          state={bannerState}
          operatorStatus={operatorGuidance.status}
          sentence={operatorGuidance.nextSentence}
          primaryAction={bannerPrimaryAction}
          detail={bannerDetail}
        />
        {error && (
          <div
            role="alert"
            className="mt-1 rounded-md border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] px-3 py-1.5 text-[11px] leading-snug text-[var(--dpf-error)]"
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={[
        "rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
        compact ? "p-3" : "p-4",
      ].join(" ")}
      data-testid="build-studio-workflow-action-card"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
              Build Status
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h4 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">
                {action.title}
              </h4>
              <span
                data-testid="build-operator-status"
                className="inline-flex"
              >
                <StatusBadge
                  intent={operatorGuidance.status.intent}
                  label={operatorGuidance.status.label}
                  variant="soft"
                  uppercase={false}
                />
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
              {action.message}
            </p>
            <p
              className="mt-1 text-xs font-medium leading-relaxed text-[var(--dpf-text)]"
              data-testid="build-next-action"
            >
              {operatorGuidance.nextSentence}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
            {build.phase}
          </span>
        </div>

        {action.truthSources && action.truthSources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {action.truthSources.map((source) => (
              <TruthSourceBadge
                key={`${source.source}-${source.observedAt ?? "unknown"}`}
                source={source.source}
                observedAt={source.observedAt}
              />
            ))}
          </div>
        )}

        {action.disabledReason && (
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--dpf-muted)]">
            {action.disabledReason}
          </div>
        )}

        {action.resumeMode && (
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs leading-relaxed">
            <div className="font-semibold text-[var(--dpf-text)]">{action.resumeMode.label}</div>
            <div className="mt-1 text-[var(--dpf-muted)]">{action.resumeMode.reason}</div>
          </div>
        )}

        {action.kind === "escalated-to-human" && (
          <div
            data-testid="build-escalated-handoff"
            className="rounded-lg border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] px-3 py-2 text-xs leading-relaxed"
          >
            {action.parkedBacklogItemId && (
              <div className="text-[var(--dpf-text)]">
                Parked as{" "}
                <span className="font-mono font-semibold">{action.parkedBacklogItemId}</span>
              </div>
            )}
            {action.abandonReason && (
              <div className="mt-1 text-[var(--dpf-muted)]">{action.abandonReason}</div>
            )}
            <button
              type="button"
              onClick={() => router.push(action.resumeHref)}
              className="mt-2 inline-flex items-center rounded-md border border-[var(--dpf-error)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-error)] transition-opacity hover:opacity-90"
            >
              Open parked item
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] px-3 py-2 text-xs leading-relaxed text-[var(--dpf-error)]">
            {error}
          </div>
        )}

        {lastOutcome && (
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
            {lastOutcome.message}
          </div>
        )}

        <DecisionPerspectiveGatePanel
          interaction={decisionInteraction}
          onCapture={handleDecisionCapture}
          voiceOutput={voiceOutput}
        />

        {operatorGuidance.guidedRecovery && operatorGuidance.recoveryHint && (
          <div
            data-testid="build-guided-recovery"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--dpf-muted)]"
          >
            {operatorGuidance.recoveryHint}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {primaryLabel && (
            <span
              title={!primaryEnabled && action.disabledReason ? action.disabledReason : undefined}
              className="inline-flex"
            >
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={!primaryEnabled || pending}
                aria-disabled={!primaryEnabled || pending}
                aria-describedby={!primaryEnabled && action.disabledReason ? `${action.kind}-disabled-reason` : undefined}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending && <Spinner size="xs" tone="current" presentational />}
                {primaryLabel}
              </button>
            </span>
          )}
          {!primaryEnabled && action.disabledReason && primaryLabel && (
            <span
              id={`${action.kind}-disabled-reason`}
              className="text-[11px] text-[var(--dpf-text-muted)]"
              role="status"
            >
              {action.disabledReason}
            </span>
          )}
          <button
            type="button"
            onClick={handleCoworkerAction}
            className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
          >
            {operatorGuidance.guidedRecovery ? "Something looks off" : action.coworkerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
