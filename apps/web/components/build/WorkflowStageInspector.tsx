"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import { PHASE_LABELS } from "@/lib/feature-build-types";
import type { NodeStatus } from "@/lib/build/process-graph-builder";

type Props = {
  build: FeatureBuildRow;
  phase: BuildPhase;
  status: NodeStatus;
  workflowLabel: string | null;
  onClose: () => void;
};

const STATUS_CONFIG: Record<NodeStatus, { label: string; colorVar: string }> = {
  pending: { label: "Pending", colorVar: "var(--dpf-muted)" },
  running: { label: "In Progress", colorVar: "var(--dpf-accent)" },
  done: { label: "Done", colorVar: "var(--dpf-success)" },
  error: { label: "Blocked", colorVar: "var(--dpf-error)" },
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
  const panelRef = useRef<HTMLDivElement>(null);
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
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in srgb, var(--dpf-bg) 85%, transparent)",
          zIndex: 998,
          cursor: "pointer",
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Workflow stage: ${stageLabel}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          background: "var(--dpf-surface-1)",
          borderLeft: "1px solid var(--dpf-border)",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          boxShadow: "-4px 0 20px color-mix(in srgb, var(--dpf-bg) 50%, transparent)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--dpf-border)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
            Workflow Stage
          </span>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            style={{
              width: 28,
              height: 28,
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--dpf-border)",
              borderRadius: 4,
              color: "var(--dpf-muted)",
              fontSize: 14,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {"\u2715"}
          </button>
        </div>

        <div style={{ padding: "16px", flex: 1 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--dpf-text)",
              margin: "0 0 10px 0",
            }}
          >
            {stageLabel}
          </h3>

          <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                background: `color-mix(in srgb, ${statusCfg.colorVar} 15%, transparent)`,
                color: statusCfg.colorVar,
                border: `1px solid color-mix(in srgb, ${statusCfg.colorVar} 30%, transparent)`,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {statusCfg.label}
            </span>
            {workflowLabel && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                  border: "1px solid var(--dpf-border)",
                }}
              >
                {workflowLabel}
              </span>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={sectionLabelStyle}>What Happened</div>
            <div style={bodyTextStyle}>{getStageSummary(phase, build)}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={sectionLabelStyle}>Next Approval</div>
            <div style={bodyTextStyle}>{getNextApproval(phase, build, workflowLabel)}</div>
          </div>

          {artifacts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Related Artifacts</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {artifacts.map((line) => (
                  <div
                    key={line}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "var(--dpf-surface-2)",
                      border: "1px solid var(--dpf-border)",
                      fontSize: 11,
                      color: "var(--dpf-text)",
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {build.originator?.resolution && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Decision Context</div>
              <div style={bodyTextStyle}>{build.originator.resolution}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--dpf-muted)",
  marginBottom: 6,
};

const bodyTextStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--dpf-text)",
  whiteSpace: "pre-wrap",
};
