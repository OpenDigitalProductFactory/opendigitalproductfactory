// D2 (BI-4D030159) — safety core for the time-off decision coworker.
//
// The organization's WWWD business-decision gate RECOMMENDS; these hard guards VETO.
// A leave-decisioning coworker must never auto-recommend approval into a
// coverage breach or a negative balance, and always escalates an ambiguous
// gate outcome (BI acceptance #2/#3, and the "escalate by exception"
// contract). Pure and decision-surface-independent by construction: the guards
// are the safety rails that hold whatever the org gate scores.
//
// This module deliberately does NOT decide anything on its own confidence —
// the actual approve/deny recommendation still comes from the WWWD gate via
// `resolveLeaveDecision`. The guards can only ever push toward escalation
// (the safe direction), never toward auto-approval.

export type LeaveCoverage = {
  /** Minimum headcount the period requires to stay covered. */
  requiredHeadcount: number;
  /** Headcount that would remain covered if this leave is approved. */
  coveredIfApproved: number;
};

export type LeaveGuardInputs = {
  requestedDays: number;
  /** Remaining balance BEFORE this request is applied. */
  remainingBalance: number;
  coverage: LeaveCoverage;
  /**
   * Minimum staffing cushion the org wants to keep ABOVE the required minimum
   * before an AI may recommend approval. Default 0 = only a true breach (below
   * the minimum) escalates. A coverage-sensitive org (e.g. food-hospitality,
   * where a service that runs to the bone risks the guest experience) sets this
   * to 1+, so approving down to zero cushion escalates to a human instead of
   * being auto-recommended. Verified 2026-08-07 against the live restaurant org
   * stance: the WWWD gate's option pick is commandment-argmax and barely weights
   * business_disruption, so coverage-tightness sensitivity must live in this
   * deterministic guard, not in the gate.
   */
  minCoverageCushion?: number | null;
  /** Policy cap on a single consecutive run, or null/undefined for no cap. */
  maxConsecutiveDays?: number | null;
  requestedConsecutiveDays: number;
  inBlackoutWindow?: boolean;
};

export type LeaveGuardVerdict = {
  /** True when at least one hard rail fired — the coworker must escalate. */
  forceEscalate: boolean;
  reasons: string[];
};

/**
 * Evaluate the hard safety rails. Every failing rail forces escalation; none
 * of them can produce an approval. Reasons accumulate so the escalation is
 * legible to the human approver.
 */
export function evaluateLeaveGuards(inputs: LeaveGuardInputs): LeaveGuardVerdict {
  const reasons: string[] = [];

  if (inputs.requestedDays > inputs.remainingBalance) {
    reasons.push(
      `Request of ${inputs.requestedDays} day(s) would overdraw the remaining balance of ${inputs.remainingBalance}.`,
    );
  }

  const cushion = inputs.minCoverageCushion ?? 0;
  if (inputs.coverage.coveredIfApproved < inputs.coverage.requiredHeadcount + cushion) {
    reasons.push(
      cushion > 0
        ? `Approving would drop coverage below the required minimum plus a ${cushion}-person cushion (${inputs.coverage.coveredIfApproved} covered vs ${inputs.coverage.requiredHeadcount} required + ${cushion} cushion).`
        : `Approving would breach required coverage (${inputs.coverage.coveredIfApproved} covered vs ${inputs.coverage.requiredHeadcount} required).`,
    );
  }

  if (
    inputs.maxConsecutiveDays != null &&
    inputs.requestedConsecutiveDays > inputs.maxConsecutiveDays
  ) {
    reasons.push(
      `Requested run of ${inputs.requestedConsecutiveDays} consecutive day(s) exceeds the policy limit of ${inputs.maxConsecutiveDays}.`,
    );
  }

  if (inputs.inBlackoutWindow) {
    reasons.push("Request falls within a blackout window.");
  }

  return { forceEscalate: reasons.length > 0, reasons };
}

/** Surface-agnostic classification of the consulted business-decision outcome. */
export type LeaveDecisionOutcome =
  | "recommend-approve"
  | "recommend-deny"
  | "escalate"
  | "defer";

export type LeaveDecisionAction = "approve" | "deny" | "escalate";

/**
 * Combine the hard guards with the WWWD outcome. A fired guard always wins and
 * forces escalation; otherwise the org recommendation passes through, and any
 * non-committal outcome (escalate/defer) escalates by exception.
 */
export function resolveLeaveDecision(args: {
  guards: LeaveGuardVerdict;
  decisionOutcome: LeaveDecisionOutcome;
}): LeaveDecisionAction {
  if (args.guards.forceEscalate) return "escalate";
  switch (args.decisionOutcome) {
    case "recommend-approve":
      return "approve";
    case "recommend-deny":
      return "deny";
    default:
      return "escalate";
  }
}
