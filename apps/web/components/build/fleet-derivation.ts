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

// The stall primitive moved to lib/build/build-attention.ts — it is a
// projection input, and lib must not import from components. Re-exported here
// so existing component-side callers and tests keep one import site.
import { isBuildStalled, STALL_THRESHOLD_MS } from "@/lib/build/build-attention";

export { isBuildStalled, STALL_THRESHOLD_MS };

function stalledReason(build: Pick<FeatureBuildRow, "updatedAt">, now: number): string {
  const mins = Math.round((now - new Date(build.updatedAt).getTime()) / 60000);
  const label = mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins} min`;
  return `Stalled — no activity for ${label}. Needs attention.`;
}

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
export function deriveQueueState(build: FeatureBuildRow, now: number = Date.now()): BuildQueueState {
  // Terminal failure — operator needs to look.
  if (build.phase === "failed") {
    return { kind: "blocked", reason: "Build failed; reset or retry from the action card." };
  }

  // BI-46204009: a stalled build/review build is frozen, not running — never show
  // it as a live "running/Working" badge. Surface it as blocked with the staleness
  // so the operator sees it needs attention (deriveNeedsAttention agrees, moving it
  // to the "Needs you" band and out of the "Working" count).
  if (isBuildStalled(build, now)) {
    return { kind: "blocked", reason: stalledReason(build, now) };
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

  // BI-5939B62F: ideate and plan are IN-FLIGHT phases — a coworker is actively
  // working the brief / plan (or it's sitting at the gate awaiting approval), so
  // the build is part of the live fleet. Mapping them to "idle" made the
  // fleet/queue counters read 0 while builds were genuinely in progress. Count
  // them as running so the fleet summary reflects reality; the phase mini-rail
  // still conveys which stage.
  if (build.phase === "ideate") {
    return { kind: "running", stepLabel: "Ideating" };
  }
  if (build.phase === "plan") {
    return { kind: "running", stepLabel: "Planning" };
  }

  // Remaining phases (ship, complete) are terminal-ish and idle from a runtime
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

// deriveNeedsAttention() was deleted here. It returned a BOOLEAN over seven
// distinct conditions, discarding which one fired, so a row could only ever
// print the literal string "Needs you" — and it disagreed with the canonical
// owner state that drove the Next card. Its replacement is
// deriveBuildAttention() in lib/build/build-attention.ts, which returns the
// canonical BuildStudioOwnerState plus the reason.

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

/**
 * How many builds the AI coworker is actively carrying in its own custody —
 * ideate/plan phases that stay OFF the operator focus rail (isOperatorFocusEntry)
 * but are genuinely in progress. Surfaced as a distinct "Coworker" header count so
 * the operator sees activity is happening without those probes cluttering the rail
 * or being conflated with operator-actionable "Working" builds (BI-5939B62F).
 */
export function deriveCoworkerActivityCount(
  builds: ReadonlyArray<Pick<FeatureBuildRow, "phase">>,
): number {
  return builds.filter((b) => b.phase === "ideate" || b.phase === "plan").length;
}

export type OperatorFocusEntry = {
  build: Pick<FeatureBuildRow, "buildId" | "phase">;
  queueState: BuildQueueState;
  /** From the single attention producer — see lib/build/build-attention.ts. */
  attention: { needsOwner: boolean } | null;
};

/**
 * The operator fleet is a focus queue, not a dump of every not-complete row.
 * Quiet ideation / planning probes remain under the AI Coworker's custody;
 * builds stay visible when they are selected, running, queued, blocked, or
 * waiting on the human.
 */
export function isOperatorFocusEntry(
  entry: OperatorFocusEntry,
  activeBuildId: string | null,
): boolean {
  if (activeBuildId && entry.build.buildId === activeBuildId) return true;
  if (entry.attention?.needsOwner) return true;
  // BI-5939B62F: ideate/plan now derive to "running" so they COUNT in the fleet
  // summary, but quiet ideation/planning probes still stay OUT of the operator
  // focus queue (AI-custody) unless selected or needing attention — the pre-fix
  // behavior this list intentionally preserves. Keying focus on phase here
  // decouples "counted as in-flight" from "operator-actionable".
  if (entry.build.phase === "ideate" || entry.build.phase === "plan") return false;
  return entry.queueState.kind !== "idle";
}

export function formatOperatorFocusHeader({
  needsYouCount,
  workingCount,
  parkedCount,
  blockedCount = 0,
  queuedCount = 0,
  coworkerCount = 0,
}: {
  needsYouCount: number;
  workingCount: number;
  parkedCount: number;
  blockedCount?: number;
  queuedCount?: number;
  /** Builds the coworker is actively working off-rail (ideate/plan). Shown only
   *  when > 0 so it never adds noise on a quiet fleet. */
  coworkerCount?: number;
}): string {
  const parts = [
    `Needs you: ${needsYouCount}`,
    `Working: ${workingCount}`,
  ];
  if (blockedCount > 0) {
    parts.push(`Blocked: ${blockedCount}`);
  }
  if (queuedCount > 0) {
    parts.push(`Waiting: ${queuedCount}`);
  }
  if (coworkerCount > 0) {
    parts.push(`Coworker: ${coworkerCount}`);
  }
  parts.push(`Parked: ${parkedCount}`);
  return parts.join(" · ");
}

export function formatFleetHeader(
  runningCount: number,
  _cap: number = 0,
  queuedCount: number = 0,
): string {
  return formatOperatorFocusHeader({
    needsYouCount: 0,
    workingCount: runningCount,
    queuedCount,
    parkedCount: 0,
  });
}
