"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  advanceBuildPhase,
  approveBuildStart,
  recordBuildAcceptance,
  runBuildReviewVerification,
  resumeBuildImplementation,
  retryBuildExecution,
} from "@/lib/actions/build";
import { captureDecisionInteraction } from "@/lib/actions/decision-perspective";
import type { ResumeBuildImplementationOutcome } from "@/lib/build/progress-visibility-types";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { DecisionGateCaptureDraft } from "@/lib/decision-perspective/capture-types";
import { DecisionPerspectiveGatePanel } from "./DecisionPerspectiveGatePanel";
import { TruthSourceBadge } from "./TruthSourceBadge";
import type { BuildStudioWorkflowAction } from "./build-studio-workflow-actions";

type Props = {
  build: FeatureBuildRow;
  action: BuildStudioWorkflowAction;
  compact?: boolean;
  onCompleted?: () => Promise<void> | void;
};

export function BuildStudioWorkflowActionCard({
  build,
  action,
  compact = false,
  onCompleted,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ResumeBuildImplementationOutcome | null>(null);

  const primaryEnabled = action.kind !== "review-only" && action.disabledReason == null;
  const decisionInteraction =
    action.kind === "advance-phase" && action.targetPhase === "build"
      ? build.decisionInteraction ?? null
      : null;
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
      case "resume-implementation":
        return "Reopening implementation...";
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
      if (action.kind === "approve-start") {
        await approveBuildStart(build.buildId);
      } else if (action.kind === "record-acceptance") {
        await recordBuildAcceptance(build.buildId);
      } else if (action.kind === "run-review-verification") {
        await runBuildReviewVerification(build.buildId);
      } else if (action.kind === "advance-phase" && action.targetPhase) {
        await advanceBuildPhase(build.buildId, action.targetPhase);
      } else if (action.kind === "retry-build") {
        await retryBuildExecution(build.buildId);
      } else if (action.kind === "resume-implementation") {
        setLastOutcome(await resumeBuildImplementation(build.buildId));
      }

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
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: action.coworkerPrompt,
          targetBuildId: build.buildId,
        },
      }),
    );
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
            <h4 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
              {action.title}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
              {action.message}
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
        />

        <div className="flex flex-wrap items-center gap-2">
          {primaryLabel && (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={!primaryEnabled || pending}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {primaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleCoworkerAction}
            className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
          >
            {action.coworkerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
