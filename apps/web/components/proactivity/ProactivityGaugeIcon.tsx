"use client";

import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

const NEEDLE_ROTATION: Record<ProactivityLevel, number> = {
  quiet: -42,
  balanced: 0,
  assertive: 42,
};

const ACCENT_TOKEN: Record<ProactivityLevel, string> = {
  quiet: "var(--dpf-success)",
  balanced: "var(--dpf-warning)",
  assertive: "var(--dpf-error)",
};

export function ProactivityGaugeIcon({ level, size = 16 }: { level: ProactivityLevel; size?: number }) {
  const rotation = NEEDLE_ROTATION[level];
  const accent = ACCENT_TOKEN[level];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: accent, display: "block", flex: "0 0 auto" }}
    >
      <path d="M4 14a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <path
        d="M7 14a5 5 0 0 1 10 0"
        stroke="currentColor"
        strokeWidth="2"
        opacity={level === "balanced" ? "0.9" : "0.65"}
      />
      <g transform={`rotate(${rotation} 12 14)`}>
        <path d="M12 14 12 8" stroke="currentColor" strokeWidth="2.25" />
      </g>
      <circle cx="12" cy="14" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
