"use client";

import { useCallback, useEffect } from "react";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";
import type {
  NodeStatus,
  NormalizedStoredTaskResult,
} from "@/lib/build/process-graph-builder";
import { WorkflowDetailPanel } from "./WorkflowDetailPanel";

type Props = {
  task: AssignedTask;
  status: NodeStatus;
  result: NormalizedStoredTaskResult | undefined;
  onClose: () => void;
};

const STATUS_CONFIG: Record<NodeStatus, { label: string; toneClassName: string }> = {
  pending: {
    label: "Pending",
    toneClassName: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  },
  running: {
    label: "Running",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-accent)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-accent)_12%,var(--dpf-surface-1))] text-[var(--dpf-accent)]",
  },
  done: {
    label: "Done",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-success)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-success)_12%,var(--dpf-surface-1))] text-[var(--dpf-success)]",
  },
  error: {
    label: "Error",
    toneClassName:
      "border-[color-mix(in_srgb,var(--dpf-error)_30%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-error)_12%,var(--dpf-surface-1))] text-[var(--dpf-error)]",
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function TaskInspector({ task, status, result, onClose }: Props) {
  const statusCfg = STATUS_CONFIG[status];

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <WorkflowDetailPanel
      eyebrow="Task Details"
      title={task.title}
      subtitle="Review the assigned specialist, touched files, and recorded execution result without leaving the workflow."
      onClose={onClose}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] ${statusCfg.toneClassName}`}
            >
              {statusCfg.label}
            </span>
            <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--dpf-text)]">
              {task.specialist
                .split("-")
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")}
            </span>
          </div>

          {task.task.implement ? (
            <InfoSection label="Implementation">
              <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
                {task.task.implement}
              </p>
            </InfoSection>
          ) : null}

          {task.task.verify ? (
            <InfoSection label="Verification">
              <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
                {task.task.verify}
              </p>
            </InfoSection>
          ) : null}
        </div>

        <div className="space-y-4">
          {task.files.length > 0 ? (
            <InfoSection label={`Files (${task.files.length})`}>
              <div className="space-y-2">
                {task.files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
                  >
                    <span className="inline-flex min-w-[42px] items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--dpf-text)]">
                      {file.action === "create" ? "New" : "Mod"}
                    </span>
                    <span className="truncate font-mono text-xs text-[var(--dpf-text)]" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            </InfoSection>
          ) : null}

          {result ? (
            <InfoSection label="Result">
              <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--dpf-text)]">
                    {result.outcome}
                  </span>
                  <span className="text-xs text-[var(--dpf-muted)]">
                    {formatDuration(result.durationMs)}
                  </span>
                </div>
              </div>
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
