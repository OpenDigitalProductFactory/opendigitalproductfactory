"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PhaseNodeData, ProcessActorKind } from "@/lib/build/process-graph-builder";

const ACTOR_LABELS: Record<ProcessActorKind, string> = {
  ai_coworker: "AI",
  system: "SYS",
  human_hitl: "HITL",
  review_gate: "GATE",
};

/**
 * Large 200x90px node representing a build phase in the Level 1 phase graph.
 * Status drives visual state: pending (dimmed), running (pulsing ring),
 * done (green badge), error (red badge + shake).
 */
export const PhaseNode = memo(function PhaseNode({ data }: NodeProps) {
  const nodeData = data as PhaseNodeData;
  const { label, status, color, icon } = nodeData;

  const isPending = status === "pending";
  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  // Determine CSS animation class
  let animClass = "";
  if (isRunning) animClass = "pg-node-running";
  else if (isDone) animClass = "pg-node-done-flash";
  else if (isError) animClass = "pg-node-error-enter";

  // Border color based on status
  const borderColor = isPending ? "var(--dpf-border)" : color;

  return (
    <div
      className={animClass}
      style={{
        width: 200,
        height: 90,
        background: "var(--dpf-surface-1)",
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: "10px 14px",
        opacity: isPending ? 0.45 : 1,
        position: "relative",
        userSelect: "none",
        transition: "opacity 200ms, border-color 200ms",
        // Set custom property for the pulse animation
        ...(isRunning ? { "--pg-color-25": `color-mix(in srgb, ${color} 25%, transparent)` } as React.CSSProperties : {}),
      }}
    >
      {/* Hidden handles for ReactFlow connections */}
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
            top: 6,
            right: 8,
            fontSize: 14,
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
            top: 6,
            right: 8,
            fontSize: 14,
            fontWeight: 700,
            color: "var(--dpf-error)",
            lineHeight: 1,
          }}
        >
          {"\u2717"}
        </span>
      )}

      {/* Phase icon + label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 18,
            color,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--dpf-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      {/* Actor provenance badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "1px 5px",
            borderRadius: 3,
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
            color,
            border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
            letterSpacing: "0.03em",
          }}
        >
          {ACTOR_LABELS.ai_coworker}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--dpf-muted)",
          }}
        >
          AI Coworker
        </span>
      </div>
    </div>
  );
});
