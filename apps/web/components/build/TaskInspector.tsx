"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AssignedTask } from "@/lib/integrate/task-dependency-graph";
import type {
  NodeStatus,
  NormalizedStoredTaskResult,
} from "@/lib/build/process-graph-builder";

type Props = {
  task: AssignedTask;
  status: NodeStatus;
  result: NormalizedStoredTaskResult | undefined;
  onClose: () => void;
};

const STATUS_CONFIG: Record<
  NodeStatus,
  { label: string; colorVar: string }
> = {
  pending: { label: "Pending", colorVar: "var(--dpf-muted)" },
  running: { label: "Running", colorVar: "var(--dpf-accent)" },
  done: { label: "Done", colorVar: "var(--dpf-success)" },
  error: { label: "Error", colorVar: "var(--dpf-error)" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * 320px slide-in panel on task click.
 * Shows task details, file list, and result output.
 */
export function TaskInspector({ task, status, result, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const statusCfg = STATUS_CONFIG[status];

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Dim overlay */}
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

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Task: ${task.title}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          background: "var(--dpf-surface-1)",
          borderLeft: "1px solid var(--dpf-border)",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          boxShadow: "-4px 0 20px color-mix(in srgb, var(--dpf-bg) 50%, transparent)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--dpf-border)",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--dpf-text)",
            }}
          >
            Task Inspector
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
              transition: "color 200ms, border-color 200ms",
              padding: 0,
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", flex: 1 }}>
          {/* Task title */}
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--dpf-text)",
              margin: "0 0 10px 0",
              lineHeight: 1.4,
            }}
          >
            {task.title}
          </h3>

          {/* Status badge */}
          <div style={{ marginBottom: 16 }}>
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
          </div>

          {/* Specialist */}
          <div style={{ marginBottom: 16 }}>
            <div style={sectionLabelStyle}>Specialist</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--dpf-text-secondary)",
              }}
            >
              {task.specialist
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")}
            </div>
          </div>

          {/* Task description */}
          {task.task.implement && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Implementation</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--dpf-text-secondary)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {task.task.implement}
              </div>
            </div>
          )}

          {/* Files list */}
          {task.files.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>
                Files ({task.files.length})
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {task.files.map((file) => (
                  <div
                    key={file.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 6px",
                      borderRadius: 4,
                      background: "var(--dpf-surface-2)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 600,
                        padding: "1px 4px",
                        borderRadius: 2,
                        background:
                          file.action === "create"
                            ? "color-mix(in srgb, var(--dpf-success) 15%, transparent)"
                            : "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
                        color:
                          file.action === "create"
                            ? "var(--dpf-success)"
                            : "var(--dpf-accent)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        flexShrink: 0,
                      }}
                    >
                      {file.action === "create" ? "NEW" : "MOD"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--dpf-text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "monospace",
                      }}
                      title={file.path}
                    >
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result output */}
          {result != null && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>Result</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color:
                        result.outcome === "DONE" ||
                        result.outcome === "DONE_WITH_CONCERNS"
                          ? "var(--dpf-success)"
                          : "var(--dpf-error)",
                    }}
                  >
                    {result.outcome}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--dpf-muted)",
                    }}
                  >
                    {formatDuration(result.durationMs)}
                  </span>
                </div>
              </div>
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
