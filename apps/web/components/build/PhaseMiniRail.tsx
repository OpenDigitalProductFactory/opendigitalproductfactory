// apps/web/components/build/PhaseMiniRail.tsx
//
// Compact 5-dot phase indicator for the fleet rail. Shows where a build is
// across the canonical ideate → plan → build → review → ship sequence.
//
// Per the design spec §1 + §3:
//   - Shape AND color carry "reached vs pending" (filled vs outlined) so the
//     mini-rail passes WCAG 1.4.1 (color is not the sole conveyor).
//   - Wrapper is role="img" with an aria-label summarizing the reached phases.
//   - Each dot has its own aria-label.
//   - Renders at fleet-row density (≤32px); the dots fit in ~14px each.

"use client";

import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

/** The canonical phase progression visible in the fleet rail. */
export const PHASE_RAIL_ORDER = ["ideate", "plan", "build", "review", "ship"] as const;
export type PhaseRailPhase = (typeof PHASE_RAIL_ORDER)[number];

/** State for a single dot in the rail. */
export type PhaseDotState = "reached" | "active" | "pending";

export type PhaseMiniRailProps = {
  /** Current phase the build is on. */
  currentPhase: PhaseRailPhase;
  /** Optional class to merge into the wrapper (e.g. spacing tweaks from callers). */
  className?: string;
};

/**
 * Derive the {reached|active|pending} state of each dot from the current phase.
 *
 * "reached" = phases before currentPhase. "active" = the current phase itself.
 * "pending" = phases after currentPhase.
 */
export function derivePhaseDotStates(currentPhase: PhaseRailPhase): readonly PhaseDotState[] {
  const idx = PHASE_RAIL_ORDER.indexOf(currentPhase);
  return PHASE_RAIL_ORDER.map((_, i) => {
    if (i < idx) return "reached";
    if (i === idx) return "active";
    return "pending";
  });
}

function dotClassName(state: PhaseDotState): string {
  // Shape distinction: reached/active use a filled circle, pending uses an outlined ring.
  // Color distinction: reached uses accent, active uses accent (stronger), pending uses muted border.
  if (state === "reached") {
    return [
      "phase-dot",
      "phase-dot--reached",
      "h-2.5",
      "w-2.5",
      "rounded-full",
      "bg-[var(--dpf-accent)]",
    ].join(" ");
  }
  if (state === "active") {
    return [
      "phase-dot",
      "phase-dot--active",
      "h-2.5",
      "w-2.5",
      "rounded-full",
      "bg-[var(--dpf-accent)]",
      "ring-2",
      "ring-[var(--dpf-accent)]",
      "ring-offset-1",
      "ring-offset-[var(--dpf-surface-1)]",
    ].join(" ");
  }
  return [
    "phase-dot",
    "phase-dot--pending",
    "h-2.5",
    "w-2.5",
    "rounded-full",
    "border",
    "border-[var(--dpf-muted)]",
    "bg-transparent",
  ].join(" ");
}

function dotAriaLabel(phase: PhaseRailPhase, state: PhaseDotState): string {
  return `${phase}: ${state}`;
}

/**
 * Wrapper aria-label summarizes which phases are reached + which is active.
 * Example: "Phases reached: ideate, plan. Active: build."
 */
function wrapperAriaLabel(currentPhase: PhaseRailPhase): string {
  const idx = PHASE_RAIL_ORDER.indexOf(currentPhase);
  const reached = PHASE_RAIL_ORDER.slice(0, idx);
  if (reached.length === 0) {
    return `No phases reached. Active: ${currentPhase}.`;
  }
  return `Phases reached: ${reached.join(", ")}. Active: ${currentPhase}.`;
}

export function PhaseMiniRail({ currentPhase, className }: PhaseMiniRailProps) {
  const states = derivePhaseDotStates(currentPhase);

  return (
    <span
      role="img"
      aria-label={wrapperAriaLabel(currentPhase)}
      data-testid={BUILD_STUDIO_TEST_IDS.phaseMiniRail}
      data-current-phase={currentPhase}
      className={["inline-flex", "items-center", "gap-1", className].filter(Boolean).join(" ")}
    >
      {PHASE_RAIL_ORDER.map((phase, i) => (
        <span
          key={phase}
          aria-label={dotAriaLabel(phase, states[i])}
          data-phase={phase}
          data-state={states[i]}
          className={dotClassName(states[i])}
        />
      ))}
    </span>
  );
}
