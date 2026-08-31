/**
 * EP-WORK-POSTURE — the two human-in-the-loop ladders become one projection.
 * BI-13ED1BE1 (the join + verification) and BI-06C41FDC (posture governs).
 *
 * THE DEFECT THIS CLOSES. Two mechanisms independently decided whether a human
 * could be skipped, and they never met:
 *
 *   • `WorkCaseAutonomyDecisionMode` — from trust level, risk class and the
 *     regulatory ceiling (autonomy-envelope.ts). `autonomous-action` is the sole
 *     mode that permits acting without a human turn.
 *   • `ProactivityActionBoundary` — advise | propose | preauthorized, carried on
 *     the proactivity plan and now on a room's resolved posture.
 *
 * So a `preauthorized` posture could imply autonomy the envelope would deny, and
 * an `autonomous-action` envelope could act on work whose shape said `propose`.
 * The operator saw whichever surface they happened to be looking at.
 *
 * THE RULE: STRICTER WINS, ALWAYS. Neither ladder may purchase autonomy the
 * other withholds. This is `human-in-the-loop-at-phase-boundaries` applied at a
 * boundary that was previously unguarded, and it is the consumption-side half of
 * the posture layer's tighten-only invariant: a posture may restrict what a
 * participant does and can never widen it.
 */
import type { RiskClass } from "@/lib/autonomy/trust-graduation";
import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";
import type { VerificationDepth } from "@/lib/golden-triangle";

import type { WorkCaseAutonomyDecisionMode } from "./autonomy-envelope";

/** Descending autonomy. Lower rank = stricter = fewer things done unattended. */
const DECISION_MODE_RANK: Record<WorkCaseAutonomyDecisionMode, number> = {
  "shadow-only": 0,
  "propose-for-approval": 1,
  "supervised-action": 2,
  "autonomous-action": 3,
};

/**
 * The MOST autonomy each action boundary permits.
 *
 * `advise` maps to `shadow-only` rather than `propose-for-approval` on purpose:
 * advising is saying what should happen, not putting an action forward to be
 * approved. Mapping it to propose would let an advisory posture surface a
 * one-click action, which is a different and larger permission.
 */
const BOUNDARY_CEILING: Record<ProactivityActionBoundary, WorkCaseAutonomyDecisionMode> = {
  preauthorized: "autonomous-action",
  propose: "propose-for-approval",
  advise: "shadow-only",
};

export function decisionModeRank(mode: WorkCaseAutonomyDecisionMode): number {
  return DECISION_MODE_RANK[mode];
}

export function boundaryCeiling(
  boundary: ProactivityActionBoundary,
): WorkCaseAutonomyDecisionMode {
  return BOUNDARY_CEILING[boundary];
}

export interface JoinedAutonomy {
  decisionMode: WorkCaseAutonomyDecisionMode;
  /** Which ladder set the result — for the receipt and the surface. */
  constrainedBy: "envelope" | "posture" | "both-agree";
  reason: string;
}

/**
 * Join the envelope's decision mode with the posture's action boundary.
 * Returns the STRICTER of the two, never the more permissive.
 *
 * `boundary` absent (no room posture) returns the envelope mode unchanged, so
 * every existing caller behaves exactly as before this join existed.
 */
export function joinAutonomy(
  envelopeMode: WorkCaseAutonomyDecisionMode,
  boundary: ProactivityActionBoundary | null | undefined,
): JoinedAutonomy {
  if (!boundary) {
    return {
      decisionMode: envelopeMode,
      constrainedBy: "envelope",
      reason: "No room posture applies, so the coworker's autonomy envelope decides the turn.",
    };
  }

  const ceiling = BOUNDARY_CEILING[boundary];
  const envelopeRank = DECISION_MODE_RANK[envelopeMode];
  const ceilingRank = DECISION_MODE_RANK[ceiling];

  if (ceilingRank < envelopeRank) {
    return {
      decisionMode: ceiling,
      constrainedBy: "posture",
      reason: `This room's work is set to ${boundary}, which is stricter than the coworker's usual authority here.`,
    };
  }
  if (envelopeRank < ceilingRank) {
    return {
      decisionMode: envelopeMode,
      constrainedBy: "envelope",
      reason: "The coworker's autonomy envelope is stricter than this room's setting.",
    };
  }
  return {
    decisionMode: envelopeMode,
    constrainedBy: "both-agree",
    reason: "The room's setting and the coworker's envelope agree on this turn.",
  };
}

// ── Verification: making verificationDepth load-bearing ──────────────────────
//
// `verificationDepth` has been compiled, rendered as a "Deep verification" chip
// and written to receipts since the Golden Triangle shipped, while gating
// nothing. An operator could set Assured on a payroll run, see the chip, and
// have the action complete unverified. That is a promise the system did not keep.
//
// The stake classes are NOT a new taxonomy. `RiskClass.outbound-or-floor` is
// already defined as "the kernel floor: irreversible/outbound/financial/
// access-control" — outward-facing sends, money movement and regulated filing
// are exactly that class. Fusing onto it rather than inventing a parallel axis.

export interface VerificationRequirement {
  required: boolean;
  /** Stable code for the receipt and the denial message. */
  reasonCode: string;
  reason: string;
}

export type VerificationEvidence = {
  /** Work Case evidence shape. */
  verifiedAt?: string | Date | null;
  /** Canonical RuntimeVerification receipt shape. */
  status?: string | null;
  completedAt?: string | Date | null;
};

/**
 * One predicate for both policy-envelope evidence and canonical room runtime
 * receipts. A failed or merely-started receipt never satisfies the gate.
 */
export function hasPassingVerificationEvidence(
  evidence?: readonly VerificationEvidence[] | null,
): boolean {
  return (evidence ?? []).some(
    (entry) => Boolean(entry.verifiedAt) || (entry.status === "passed" && Boolean(entry.completedAt)),
  );
}

const NOT_REQUIRED: VerificationRequirement = {
  required: false,
  reasonCode: "verification_not_required",
  reason: "This work does not require verification before it counts as done.",
};

/**
 * Does this turn require verification evidence before the action may close?
 *
 * True when EITHER the work sits at the kernel floor (outbound, financial,
 * irreversible, access-control) OR the resolved posture asked for verification.
 * Deliberately an OR: a posture may ADD a verification requirement to work that
 * would not otherwise carry one, and may never remove the floor's requirement —
 * the same tighten-only asymmetry the posture layer enforces everywhere else.
 */
export function resolveVerificationRequirement(input: {
  risk?: RiskClass | null;
  verificationDepth?: VerificationDepth | null;
}): VerificationRequirement {
  if (input.risk === "outbound-or-floor") {
    return {
      required: true,
      reasonCode: "verification_required_by_risk",
      reason:
        "This action leaves the business, moves money, or cannot be undone, so it is verified before it counts as done.",
    };
  }
  if (input.verificationDepth === "deep" || input.verificationDepth === "shallow") {
    return {
      required: true,
      reasonCode: "verification_required_by_posture",
      reason: "The shape of this work asks for verification before it counts as done.",
    };
  }
  return NOT_REQUIRED;
}
