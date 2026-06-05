"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import { PHASE_LABELS } from "@/lib/feature-build-types";
import type { NodeStatus } from "@/lib/build/process-graph-builder";
import { normalizeTaskResults } from "@/lib/build/task-results";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import { BuildStudioWorkflowActionCard } from "./BuildStudioWorkflowActionCard";
import { deriveWorkflowStageGuidance } from "./build-studio-workflow-actions";
import {
  EnvironmentStatusSummary,
  type EnvironmentStatusSummaryProps,
} from "./EnvironmentStatusSummary";
import {
  UnifiedEvidenceTimeline,
  type UnifiedEvidenceTimelineEvent,
} from "./UnifiedEvidenceTimeline";

type Props = {
  build: FeatureBuildRow;
  phase: BuildPhase;
  status: NodeStatus;
  workflowLabel: string | null;
  governedBacklogEnabled: boolean;
  progressVisibility?: BuildProgressVisibility | null;
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
    const taskCount = normalizeTaskResults(build.taskResults).tasks.length;
    if (taskCount > 0) {
      lines.push(`Completed task results: ${taskCount}`);
    }
  }

  if (build.sandboxPort != null && isRuntimePhase(phase)) {
    lines.push("Shared preview available");
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

function isRuntimePhase(phase: BuildPhase): boolean {
  return phase === "build" || phase === "review" || phase === "ship";
}

function getEnvironmentReadiness(phase: BuildPhase, build: FeatureBuildRow): EnvironmentStatusSummaryProps | null {
  if (!isRuntimePhase(phase)) return null;

  return {
    activeCandidate: build.sandboxPort != null
      ? { status: "available", url: `http://localhost:${build.sandboxPort}` }
      : { status: "pending", summary: "Shared preview assignment is not recorded yet." },
    localIntegration: getLocalIntegrationStatus(build),
  };
}

function getLocalIntegrationStatus(build: FeatureBuildRow): EnvironmentStatusSummaryProps["localIntegration"] {
  if (!build.verificationOut) {
    return { status: "pending", summary: "Merged-code verification has not been recorded yet." };
  }

  if (build.verificationOut.typecheckPassed && build.verificationOut.testsFailed === 0) {
    return { status: "passed", summary: "Merged-code gate passed." };
  }

  return { status: "failed", summary: "Merged-code verification needs attention before release." };
}

function getEvidenceEvents(phase: BuildPhase, build: FeatureBuildRow): UnifiedEvidenceTimelineEvent[] {
  if (!isRuntimePhase(phase)) return [];

  const events: UnifiedEvidenceTimelineEvent[] = [];
  const taskCount = build.taskResults ? normalizeTaskResults(build.taskResults).tasks.length : 0;

  if (taskCount > 0) {
    events.push({
      id: "implementation-tasks",
      source: sourceForCodingProvider(build.codingProvider),
      label: labelForCodingProvider(build.codingProvider),
      summary: `${taskCount} implementation task${taskCount === 1 ? "" : "s"} recorded for review.`,
      status: "recorded",
    });
  }

  if (build.diffSummary) {
    events.push({
      id: "diff-summary",
      source: "build-studio",
      label: "Build Studio",
      summary: "Implementation changes were summarized for review.",
      status: "recorded",
    });
  }

  if (build.verificationOut) {
    events.push({
      id: "local-integration",
      source: "local-integration",
      label: "Local integration",
      summary: getVerificationSummary(build.verificationOut),
      status: build.verificationOut.typecheckPassed && build.verificationOut.testsFailed === 0 ? "passed" : "failed",
      timestamp: build.verificationOut.timestamp,
    });
  }

  if (build.uxTestResults?.length) {
    const passed = build.uxTestResults.filter((result) => result.passed).length;
    events.push({
      id: "ux-review",
      source: "review",
      label: "UX review",
      summary: `${passed}/${build.uxTestResults.length} UX checks passed.`,
      status: passed === build.uxTestResults.length ? "passed" : "failed",
    });
  }

  return events;
}

function getVerificationSummary(verification: NonNullable<FeatureBuildRow["verificationOut"]>): string {
  if (verification.typecheckPassed && verification.testsFailed === 0) {
    return "Merged-code gate passed.";
  }

  if (!verification.typecheckPassed) {
    return "Typecheck needs attention before release.";
  }

  return `${verification.testsFailed} test warning${verification.testsFailed === 1 ? "" : "s"} need review.`;
}

function sourceForCodingProvider(provider: string | null): UnifiedEvidenceTimelineEvent["source"] {
  return provider?.toLowerCase().includes("codex") ? "codex" : "external";
}

function labelForCodingProvider(provider: string | null): string {
  if (!provider) return "Implementation";
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function WorkflowStageInspector({
  build,
  phase,
  status,
  workflowLabel,
  governedBacklogEnabled,
  progressVisibility,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const statusCfg = STATUS_CONFIG[status];
  const stageLabel = PHASE_LABELS[phase] ?? phase;
  const artifacts = getArtifactLines(phase, build);
  const environmentReadiness = getEnvironmentReadiness(phase, build);
  const evidenceEvents = getEvidenceEvents(phase, build);
  const stageGuidance = deriveWorkflowStageGuidance({
    build,
    phase,
    workflowLabel,
    governedBacklogEnabled,
    progressVisibility,
  });

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
                letterSpacing: 0,
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
            <div style={bodyTextStyle}>{stageGuidance.nextApproval}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <BuildStudioWorkflowActionCard
              build={build}
              action={stageGuidance.workflowAction}
              compact
            />
          </div>

          {environmentReadiness && (
            <div style={{ marginBottom: 16 }}>
              <EnvironmentStatusSummary
                activeCandidate={environmentReadiness.activeCandidate}
                localIntegration={environmentReadiness.localIntegration}
              />
            </div>
          )}

          {evidenceEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <UnifiedEvidenceTimeline events={evidenceEvents} />
            </div>
          )}

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
  letterSpacing: 0,
  color: "var(--dpf-muted)",
  marginBottom: 6,
};

const bodyTextStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--dpf-text)",
  whiteSpace: "pre-wrap",
};
