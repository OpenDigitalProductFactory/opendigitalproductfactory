"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  advanceBuildPhase,
  approveBuildStart,
  retryBuildExecution,
} from "@/lib/actions/build";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
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

  const primaryEnabled = action.kind !== "review-only" && action.disabledReason == null;
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
      case "advance-phase":
        return action.targetPhase === "build" ? "Starting implementation..." : "Starting verification...";
      case "retry-build":
        return "Retrying build...";
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
    try {
      if (action.kind === "approve-start") {
        await approveBuildStart(build.buildId);
      } else if (action.kind === "advance-phase" && action.targetPhase) {
        await advanceBuildPhase(build.buildId, action.targetPhase);
      } else if (action.kind === "retry-build") {
        await retryBuildExecution(build.buildId);
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
              Studio Control
            </p>
            <h4 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
              {action.title}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
              {action.message}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--dpf-text)]">
            {build.phase}
          </span>
        </div>

        {action.disabledReason && (
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--dpf-muted)]">
            {action.disabledReason}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] px-3 py-2 text-xs leading-relaxed text-[var(--dpf-error)]">
            {error}
          </div>
        )}

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
