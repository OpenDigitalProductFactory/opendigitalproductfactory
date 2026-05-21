// apps/web/components/build/fleet-derivation.ts
//
// Pure helpers that derive per-build fleet-rail state from a FeatureBuildRow.
// The real queue runtime (concurrency cap, FIFO position, dependency blocks)
// is owned by a separate thread — these helpers produce conservative
// phase-based defaults until that thread surfaces real values. They're
// split out so the BuildStudio shell wiring stays thin and so the
// derivation rule is unit-testable in isolation.

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { BuildQueueState } from "./QueueStateBadge";

/**
 * Derive a BuildQueueState from the FeatureBuildRow's phase + execution state.
 *
 * Until the concurrency-thread dispatcher lands, the fleet rail surfaces
 * runtime state by inference:
 *   - phase = "build" + executing → "running" with the current step label
 *   - phase = "build" + failed/concerning state → "blocked"
 *   - phase = "failed" → "blocked" (terminal failure)
 *   - anything else (ideate / plan / review / ship / complete) → "idle"
 *
 * When the dispatcher exposes real queue positions, this helper switches to
 * a passthrough from that source — the discriminated-union shape doesn't
 * change, so callers won't need to update.
 */
export function deriveQueueState(build: FeatureBuildRow): BuildQueueState {
  // Terminal failure — operator needs to look.
  if (build.phase === "failed") {
    return { kind: "blocked", reason: "Build failed; reset or retry from the action card." };
  }

  // Build phase: examine buildExecState for richer signal.
  if (build.phase === "build") {
    const exec = build.buildExecState as
      | { step?: string; error?: string | null }
      | null
      | undefined;
    if (exec?.error) {
      return { kind: "blocked", reason: exec.error.slice(0, 140) };
    }
    if (exec?.step) {
      // Step name doubles as the stepLabel for the running glyph tooltip.
      return { kind: "running", stepLabel: humanizeStep(exec.step) };
    }
    // Phase says "build" but no exec yet — treat as running with unknown step.
    return { kind: "running", stepLabel: null };
  }

  // Review phase with verification results pending → running.
  if (build.phase === "review") {
    return { kind: "running", stepLabel: "Verification & review" };
  }

  // All other phases (ideate, plan, ship, complete) are idle from a runtime
  // queue perspective. The mini-rail conveys progress; the badge stays off.
  return { kind: "idle" };
}

/**
 * Map an internal step id to a human label for the running glyph tooltip.
 * Falls back to the raw step name if no friendly form is known.
 */
function humanizeStep(step: string): string {
  const friendly: Record<string, string> = {
    sandbox_created: "Creating sandbox",
    workspace_initialized: "Initializing workspace",
    db_ready: "Preparing database",
    deps_installed: "Installing dependencies",
    code_generated: "Generating code",
    tests_run: "Running tests",
    complete: "Wrapping up",
  };
  return friendly[step] ?? step.replace(/_/g, " ");
}

/**
 * Does this build need the operator's attention right now?
 *
 * Heuristic — kept conservative so the attention dot stays meaningful:
 *   - phase=failed → yes (terminal)
 *   - phase=build + buildExecState.error set → yes
 *   - planReview / designReview with decision="fail" → yes (waiting on revision)
 *   - phase=ship with no acceptanceMet → yes (operator decision needed)
 *   - claim status indicates a stalled / abandoned claim → yes
 *
 * The dot is shape+color (red dot + ring) so color-blind users still see it.
 */
export function deriveNeedsAttention(build: FeatureBuildRow): boolean {
  if (build.phase === "failed") return true;

  if (build.phase === "build") {
    const exec = build.buildExecState as { error?: string | null } | null | undefined;
    if (exec?.error) return true;
  }

  const designReview = build.designReview as { decision?: string } | null | undefined;
  if (designReview?.decision === "fail") return true;

  const planReview = build.planReview as { decision?: string } | null | undefined;
  if (planReview?.decision === "fail") return true;

  if (build.phase === "ship" && build.acceptanceMet === null) return true;

  if (build.claimStatus === "abandoned") return true;

  return false;
}

/**
 * Counters for the FleetRail header label. Pure — operates over the
 * derived queueStates so the count matches what the rail renders.
 */
export function deriveFleetCounts(states: readonly BuildQueueState[]): {
  runningCount: number;
  queuedCount: number;
  blockedCount: number;
} {
  let running = 0;
  let queued = 0;
  let blocked = 0;
  for (const s of states) {
    if (s.kind === "running") running++;
    else if (s.kind === "queued") queued++;
    else if (s.kind === "blocked") blocked++;
  }
  return { runningCount: running, queuedCount: queued, blockedCount: blocked };
}
