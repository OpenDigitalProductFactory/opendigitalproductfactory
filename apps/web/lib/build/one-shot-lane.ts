// One-shot feature lane — single-pass governed dispatch + auto-ship for the
// low-risk tail of the backlog.
//
// BI-417AE8E9 (EP-27FD96BC). The user's goal: lower cost while holding quality
// by "one-shotting new features" — not whole products. The 2026 evidence says a
// single-pass build is safe ONLY when success is machine-checkable and the
// change is low-stakes (greenfield-simple, tests-as-oracle). So the one-shot
// lane is deliberately narrow: a SMALL/MEDIUM, LOW-sensitivity feature/fix whose
// graduated gate auto-proceeds (BI-D996C238) and whose oracles (typecheck +
// tests) are green skips the multi-round deliberation and auto-ships; everything
// else stays on the standard multi-round lane. This is the composition point the
// graduated ship gate feeds — it does not invent new autonomy, it narrows WHERE
// existing auto-proceed applies.
//
// Pure predicate + decision; no DB, no dispatch — unit-testable. The build
// pipeline consults it to pick a lane; the actual single-pass dispatch and
// auto-ship are gated by DPF_BUILD_ONE_SHOT_LANE and the (phase-2) ship gate.

import type { DeliverableSensitivity } from "@/lib/explore/build-process-matrix";
import { graduatedGateOutcome } from "@/lib/decision-perspective/graduated-autonomy";
import type { DecisionOutcomeType } from "@/lib/decision-perspective/types";

/** Work types eligible for one-shot — a feature or a fix (a chore/doc is either
 *  already trivial or not a "feature" to one-shot). */
const ONE_SHOT_WORK_TYPES: ReadonlySet<string> = new Set(["feature", "fix", "bug"]);
/** Sizes eligible — small and medium only. large/xlarge always take the full
 *  lane (they are decomposed / thoroughly reviewed). */
const ONE_SHOT_SIZES: ReadonlySet<string> = new Set(["small", "medium"]);

export type OneShotLaneInput = {
  workType?: string | null;
  effortSize?: string | null;
  sensitivity: DeliverableSensitivity;
  /** The gate outcome for this build's advancement (from the graduated gate). */
  gateOutcome: DecisionOutcomeType;
  /** Machine oracles: typecheck + tests are green in the sandbox. */
  oraclesGreen: boolean;
};

export type OneShotLaneDecision = {
  lane: "one-shot" | "standard";
  /** Human/machine-readable reason the lane was (not) chosen. */
  reason: string;
};

/**
 * PURE. True iff every one-shot precondition holds: a small/medium feature-or-fix
 * that is LOW sensitivity, whose graduated gate auto-proceeds, with green oracles.
 * Any single failing precondition disqualifies — the lane is fail-safe (defaults
 * to the standard lane), never fail-open.
 */
export function isOneShotEligible(input: OneShotLaneInput): boolean {
  if (!ONE_SHOT_WORK_TYPES.has(input.workType ?? "")) return false;
  if (!ONE_SHOT_SIZES.has(input.effortSize ?? "")) return false;
  if (input.sensitivity !== "low") return false;
  if (!input.oraclesGreen) return false;
  return graduatedGateOutcome(input.gateOutcome).autoProceed;
}

/**
 * PURE. Resolve the lane with a reason for the audit trail. Returns "one-shot"
 * only when isOneShotEligible; otherwise "standard" with the first failing
 * precondition named (so the operator sees WHY a build stayed on the full lane).
 */
export function oneShotLaneDecision(input: OneShotLaneInput): OneShotLaneDecision {
  if (!ONE_SHOT_WORK_TYPES.has(input.workType ?? "")) {
    return { lane: "standard", reason: `work type "${input.workType ?? "?"}" is not one-shot-eligible (feature/fix only)` };
  }
  if (!ONE_SHOT_SIZES.has(input.effortSize ?? "")) {
    return { lane: "standard", reason: `size "${input.effortSize ?? "?"}" is not one-shot-eligible (small/medium only)` };
  }
  if (input.sensitivity !== "low") {
    return { lane: "standard", reason: `${input.sensitivity} deliverable sensitivity requires the full review lane` };
  }
  if (!input.oraclesGreen) {
    return { lane: "standard", reason: "oracles (typecheck/tests) are not green" };
  }
  const outcome = graduatedGateOutcome(input.gateOutcome);
  if (!outcome.autoProceed) {
    return { lane: "standard", reason: `governance did not auto-proceed (${outcome.reason})` };
  }
  return { lane: "one-shot", reason: "small/medium low-sensitivity feature, gate auto-proceeds, oracles green" };
}
