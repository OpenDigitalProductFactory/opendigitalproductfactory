"use client";

import type { CSSProperties } from "react";

/**
 * Compact, theme-aware indicator that a coworker skill is steering the
 * currently in-flight run. Renders nothing when no active skill is present
 * so the parent can mount it unconditionally next to the busy state.
 *
 * Theme-token discipline (AGENTS.md §12): only DPF CSS variables, no
 * hardcoded colors. Sole exception (per the standing rule) is text-white
 * on accent backgrounds — not used here.
 */
export type SkillAttribution = {
  skillId: string;
  label: string;
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  lineHeight: 1.2,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-2)",
  color: "var(--dpf-muted)",
  maxWidth: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const labelStyle: CSSProperties = {
  color: "var(--dpf-text)",
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const idStyle: CSSProperties = {
  color: "var(--dpf-accent)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
};

export function AgentSkillAttributionChip({
  skill,
}: {
  skill: SkillAttribution | null;
}) {
  if (!skill) return null;
  return (
    <span style={chipStyle} aria-label={`Active skill: ${skill.label}`} data-testid="skill-attribution-chip">
      <span style={idStyle}>skill</span>
      <span style={labelStyle}>{skill.label}</span>
    </span>
  );
}
