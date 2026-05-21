// apps/web/components/build/QueueStateBadge.tsx
//
// Discriminated-union badge that conveys a build's queue runtime state in the
// fleet rail. The Build Studio runtime caps concurrent coworker-driven builds;
// without this badge the operator can't tell if a quiet build is running,
// blocked, or waiting in queue.
//
// Per the layout spec amendment (PR #898):
//   - Renders shape + color so it passes WCAG 1.4.1 (color is not sole conveyor).
//   - 14×14 inline SVG, bounded so it never expands the 32px fleet row.
//   - Tooltip (title attribute) surfaces the reason from the discriminated union.
//   - "idle" renders no badge so idle rows stay visually quiet.

"use client";

import type { ReactElement } from "react";

import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

/** The runtime states the fleet rail surfaces. Source of truth for the shape. */
export type BuildQueueState =
  | { kind: "running"; stepLabel: string | null }
  | { kind: "queued"; position: number; reason: "capacity" | "dependency"; ahead: number }
  | { kind: "blocked"; reason: string }
  | { kind: "idle" };

export type QueueStateBadgeProps = {
  state: BuildQueueState;
};

function tooltipFor(state: BuildQueueState): string {
  switch (state.kind) {
    case "running":
      return state.stepLabel ? `Running: ${state.stepLabel}` : "Running";
    case "queued": {
      const reason = state.reason === "capacity" ? "capacity" : "dependency";
      const ahead = state.ahead === 1 ? "1 build ahead" : `${state.ahead} builds ahead`;
      return `Queued at position ${state.position} (${reason} — ${ahead})`;
    }
    case "blocked":
      return `Blocked: ${state.reason}`;
    case "idle":
      return "Idle";
  }
}

function ariaLabelFor(state: BuildQueueState): string {
  switch (state.kind) {
    case "running":
      return "Running";
    case "queued":
      return `Queued, position ${state.position}`;
    case "blocked":
      return "Blocked";
    case "idle":
      return "Idle";
  }
}

/** Filled triangle play glyph — running. */
function RunningGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <polygon points="2,1 9,5 2,9" fill="currentColor" />
    </svg>
  );
}

/** Numbered hourglass — queued. The number sits inside the glyph for at-a-glance position. */
function QueuedGlyph({ position }: { position: number }): ReactElement {
  // 1-indexed positions; cap visual width at 2 chars so the badge stays 14px.
  const text = position > 99 ? "99+" : String(position);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3,2 L11,2 M3,12 L11,12 M3,2 L11,12 M11,2 L3,12"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <text
        x="7"
        y="9.5"
        textAnchor="middle"
        fontSize="6"
        fill="currentColor"
        fontWeight="700"
      >
        {text}
      </text>
    </svg>
  );
}

/** Two pause bars — blocked. */
function BlockedGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="2" y="1" width="2.5" height="8" fill="currentColor" />
      <rect x="5.5" y="1" width="2.5" height="8" fill="currentColor" />
    </svg>
  );
}

/** Color class per state (uses DPF state tokens from globals.css). */
function stateClassName(state: BuildQueueState): string {
  switch (state.kind) {
    case "running":
      return "bg-[var(--dpf-state-success)] text-[var(--dpf-success)] border-[var(--dpf-success)]";
    case "queued":
      return "bg-[var(--dpf-state-info)] text-[var(--dpf-info)] border-[var(--dpf-info)]";
    case "blocked":
      return "bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)] border-[var(--dpf-warning)]";
    case "idle":
      return "";
  }
}

export function QueueStateBadge({ state }: QueueStateBadgeProps) {
  if (state.kind === "idle") {
    // Idle renders nothing — keeps the fleet row visually quiet.
    return null;
  }

  return (
    <span
      role="img"
      aria-label={ariaLabelFor(state)}
      title={tooltipFor(state)}
      data-testid={BUILD_STUDIO_TEST_IDS.queueStateBadge}
      data-kind={state.kind}
      data-position={state.kind === "queued" ? state.position : undefined}
      className={[
        "queue-state-badge",
        `queue-state-badge--${state.kind}`,
        "inline-flex",
        "h-[14px]",
        "w-[14px]",
        "shrink-0",
        "items-center",
        "justify-center",
        "rounded-sm",
        "border",
        stateClassName(state),
      ].join(" ")}
    >
      {state.kind === "running" && <RunningGlyph />}
      {state.kind === "queued" && <QueuedGlyph position={state.position} />}
      {state.kind === "blocked" && <BlockedGlyph />}
    </span>
  );
}
