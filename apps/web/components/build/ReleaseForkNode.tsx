"use client";

import type { NodeProps } from "@xyflow/react";
import type { ReleaseForkNodeData } from "@/lib/build/process-graph-builder";

const TONE_STYLES = {
  neutral: {
    border: "var(--dpf-border)",
    background: "var(--dpf-surface-1)",
    accent: "var(--dpf-muted)",
  },
  info: {
    border: "#3b82f6",
    background: "color-mix(in srgb, #3b82f6 10%, var(--dpf-surface-1))",
    accent: "#3b82f6",
  },
  success: {
    border: "#22c55e",
    background: "color-mix(in srgb, #22c55e 10%, var(--dpf-surface-1))",
    accent: "#22c55e",
  },
  warning: {
    border: "#f59e0b",
    background: "color-mix(in srgb, #f59e0b 10%, var(--dpf-surface-1))",
    accent: "#f59e0b",
  },
  danger: {
    border: "#ef4444",
    background: "color-mix(in srgb, #ef4444 10%, var(--dpf-surface-1))",
    accent: "#ef4444",
  },
} as const;

const STATUS_ICONS = {
  neutral: "\u25CB",
  info: "\u23F3",
  success: "\u2713",
  warning: "\u26A0",
  danger: "\u2717",
} as const;

export function ReleaseForkNode({ data, selected }: NodeProps) {
  const fork = data as ReleaseForkNodeData;
  const tone = TONE_STYLES[fork.tone];

  return (
    <div
      style={{
        minWidth: 210,
        maxWidth: 240,
        borderRadius: 12,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        boxShadow: selected
          ? `0 0 0 2px color-mix(in srgb, ${tone.accent} 35%, transparent)`
          : "0 10px 30px color-mix(in srgb, var(--dpf-bg) 15%, transparent)",
        padding: "12px 14px",
      }}
      data-testid={`release-fork-node-${fork.forkKind}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: tone.accent, fontSize: 14 }}>{STATUS_ICONS[fork.tone]}</span>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--dpf-text)" }}>{fork.label}</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: tone.accent }}>
        {fork.statusLabel}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4, color: "var(--dpf-muted)" }}>
        {fork.detail}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--dpf-text)" }}>
        Select to inspect artifacts and next steps.
      </div>
    </div>
  );
}
