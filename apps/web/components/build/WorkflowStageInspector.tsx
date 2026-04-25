"use client";

import { useCallback, useEffect } from "react";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import { PHASE_LABELS } from "@/lib/feature-build-types";
import type { NodeStatus } from "@/lib/build/process-graph-builder";
import { WorkflowDetailPanel } from "./WorkflowDetailPanel";

type Props = {
  build: FeatureBuildRow;
  phase: BuildPhase;
  status: NodeStatus;
  workflowLabel: string | null;
  onClose: () => void;
};

const STATUS_CONFIG: Record<NodeStatus, { label: string; toneClassName: string }> = {
  pending: {
    label: "Pending",
    toneClassName: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  },
  running: {
    label: "In Progress",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-accent)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-accent)_12%,var(--dpf-surface-1))] text-[var(--dpf-accent)]",
  },
  done: {
    label: "Done",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-success)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-success)_12%,var(--dpf-surface-1))] text-[var(--dpf-success)]",
  },
  error: {
    label: "Blocked",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-error)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-error)_12%,var(--dpf-surface-1))] text-[var(--dpf-error)]",
  },
};

function getStageSummary(phase: BuildPhase, build: FeatureBuildRow): string {
  switch (phase) {
    case "ideate":
      return build.originator
        ? "Build Studio is shaping the canonical backlog request into a constrained draft effort with assumptions that can be reviewed before work begins."
        : "Build Studio is capturing the request and shaping a constrained implementation direction.";
    case "plan":
      return "The coworker is turning the approved direction into an execution plan, design decisions, and reviewable implementation structure.";
    case "build":
      return build.sandboxPort != null
        ? "Implementation is underway in the sandbox, and a preview environment is available for inspection."
        : "Implementation is underway in the sandbox, with code and tasks being executed against the approved plan.";
    case "review":
      return "The feature is being checked for quality, behavior, and readiness with review evidence gathered before release decisions.";
    case "ship":
      return "The work is ready for governed release decisions, including community sharing and production promotion.";
    default:
      return "This workflow stage is being tracked by Build Studio.";
  }
}

function getNextApproval(phase: BuildPhase, build: FeatureBuildRow, workflowLabel: string | null): string {
  if (workflowLabel === "Prepared Draft") {
    return "Approve Start to let Build Studio move from draft preparation into active execution.";
  }

  if (workflowLabel === "Ready to Start") {
    return "Start execution when the request, assumptions, and draft effort all look correct.";
  }

  if (phase === "review") {
    return "Review the sandbox evidence and decide whether the feature is ready to move into release readiness.";
  }

  if (phase === "ship") {
    return "Decide separately on community sharing, release timing, and production promotion.";
  }

  if (build.phase === "failed") {
    return "Resolve the blocking issue before advancing the workflow.";
  }

  return "No additional approval is required at this stage yet.";
}

function getArtifactLines(phase: BuildPhase, build: FeatureBuildRow): string[] {
  const lines: string[] = [];

  if (build.originator) {
    lines.push(`Backlog item: ${build.originator.itemId}`);
  }

  if (phase === "ideate" && build.brief?.description) {
    lines.push(`Brief: ${build.brief.description}`);
  }

  if (phase === "plan" && build.buildPlan?.tasks?.length) {
    lines.push(`Planned tasks: ${build.buildPlan.tasks.length}`);
  }

  if (phase === "build" && build.taskResults) {
    const taskCount = Array.isArray(build.taskResults)
      ? build.taskResults.length
      : Array.isArray((build.taskResults as { tasks?: unknown[] }).tasks)
        ? (build.taskResults as { tasks?: unknown[] }).tasks?.length ?? 0
        : 0;
    if (taskCount > 0) {
      lines.push(`Completed task results: ${taskCount}`);
    }
  }

  if (build.sandboxPort != null && (phase === "build" || phase === "review" || phase === "ship")) {
    lines.push(`Sandbox preview: port ${build.sandboxPort}`);
  }

  if (phase === "review" && build.uxTestResults?.length) {
    const passed = build.uxTestResults.filter((result) => result.passed).length;
    lines.push(`UX checks: ${passed}/${build.uxTestResults.length} passed`);
  }

  if (phase === "ship" && build.uxVerificationStatus) {
    lines.push(`Release readiness: ${build.uxVerificationStatus}`);
  }

  if (build.diffSummary && (phase === "build" || phase === "review" || phase === "ship")) {
    lines.push("Diff summary captured");
  }

  return lines;
}

export function WorkflowStageInspector({
  build,
  phase,
  status,
  workflowLabel,
  onClose,
}: Props) {
  const statusCfg = STATUS_CONFIG[status];
  const stageLabel = PHASE_LABELS[phase] ?? phase;
  const artifacts = getArtifactLines(phase, build);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <WorkflowDetailPanel
      eyebrow="Workflow Stage"
      title={stageLabel}
      subtitle="Inspect what happened in this stage, the related artifacts, and the approval needed to keep moving."
      onClose={onClose}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] ${statusCfg.toneClassName}`}
            >
              {statusCfg.label}
            </span>
            {workflowLabel ? (
              <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--dpf-text)]">
                {workflowLabel}
              </span>
            ) : null}
          </div>

          <InfoSection label="What Happened">
            <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
              {getStageSummary(phase, build)}
            </p>
          </InfoSection>

          <InfoSection label="Next Approval">
            <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
              {getNextApproval(phase, build, workflowLabel)}
            </p>
          </InfoSection>
        </div>

        <div className="space-y-4">
          {artifacts.length > 0 ? (
            <InfoSection label="Related Artifacts">
              <div className="space-y-2">
                {artifacts.map((line) => (
                  <div
                    key={line}
                    className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </InfoSection>
          ) : null}

          {build.originator?.resolution ? (
            <InfoSection label="Decision Context">
              <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
                {build.originator.resolution}
              </p>
            </InfoSection>
          ) : null}
        </div>
      </div>
    </WorkflowDetailPanel>
  );
}

function InfoSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
        {label}
      </div>
      {children}
    </section>
  );
}
