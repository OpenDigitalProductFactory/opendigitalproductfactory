"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TaskNodeData, ProcessActorKind } from "@/lib/build/process-graph-builder";

const ACTOR_LABELS: Record<ProcessActorKind, string> = {
  ai_coworker: "AI",
  system: "SYS",
  human_hitl: "HITL",
  review_gate: "GATE",
};

/**
 * 200x72px node representing a single task in the Level 2 task graph.
 * Role-colored border, specialist badge with actor provenance chip,
 * status badge, and click → inspector support.
 */
export const TaskNode = memo(function TaskNode({ data }: NodeProps) {
  const nodeData = data as TaskNodeData;
  const {
    label,
    status,
    specialist,
    roleColor,
    roleIcon,
    actorKind,
    actorLabel,
  } = nodeData;

  const isPending = status === "pending";
  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  // CSS animation class
  let animClass = "";
  if (isRunning) animClass = "pg-node-running";
  else if (isDone) animClass = "pg-node-done-flash";
  else if (isError) animClass = "pg-node-error-enter";

  const borderColor = isPending ? "var(--dpf-border)" : roleColor;

  return (
    <div
      className={animClass}
      style={{
        width: 200,
        height: 72,
        background: "var(--dpf-surface-1)",
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        padding: "8px 12px",
        opacity: isPending ? 0.45 : 1,
        position: "relative",
        userSelect: "none",
        cursor: "pointer",
        transition: "opacity 200ms, border-color 200ms",
        ...(isRunning
          ? ({ "--pg-color-25": `color-mix(in srgb, ${roleColor} 25%, transparent)` } as React.CSSProperties)
          : {}),
      }}
    >
      {/* Hidden handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1 }}
      />

      {/* Status badge (top-right) */}
      {isDone && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--dpf-success)",
            lineHeight: 1,
          }}
        >
          {"\u2713"}
        </span>
      )}
      {isError && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--dpf-error)",
            lineHeight: 1,
          }}
        >
          {"\u2717"}
        </span>
      )}

      {/* Task title (2-line max, ellipsis) */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--dpf-text)",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          lineHeight: "1.3",
          marginBottom: 6,
          paddingRight: 16,
        }}
      >
        {label}
      </div>

      {/* Specialist badge + actor provenance */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, color: roleColor, lineHeight: 1 }}>
          {roleIcon}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "var(--dpf-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 100,
          }}
        >
          {actorLabel}
        </span>
        <span
          style={{
            fontSize: 8,
            fontWeight: 600,
            padding: "1px 4px",
            borderRadius: 3,
            background: `color-mix(in srgb, ${roleColor} 15%, transparent)`,
            color: roleColor,
            border: `1px solid color-mix(in srgb, ${roleColor} 30%, transparent)`,
            letterSpacing: "0.03em",
            marginLeft: "auto",
          }}
        >
          {ACTOR_LABELS[actorKind]}
        </span>
      </div>
    </div>
  );
});
