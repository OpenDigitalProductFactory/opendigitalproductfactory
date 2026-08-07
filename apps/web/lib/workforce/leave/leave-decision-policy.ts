// D2 (BI-4D030159) — safety core for the kernel-decided time-off coworker.
//
// The decision kernel (principle_decide) RECOMMENDS; these hard guards VETO.
// A leave-decisioning coworker must never auto-recommend approval into a
// coverage breach or a negative balance, and always escalates an ambiguous
// kernel outcome (BI acceptance #2/#3, and the "escalate by exception"
// contract). Pure and kernel-independent by construction: the guards are the
// safety rails that hold whatever the kernel scores.
//
// This module deliberately does NOT decide anything on its own confidence —
// the actual approve/deny recommendation still comes from the kernel via
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

  if (inputs.coverage.coveredIfApproved < inputs.coverage.requiredHeadcount) {
    reasons.push(
      `Approving would breach required coverage (${inputs.coverage.coveredIfApproved} covered vs ${inputs.coverage.requiredHeadcount} required).`,
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

/** The kernel's classified outcome, mapped from `mapConsultOutcome`. */
export type LeaveKernelOutcome =
  | "recommend-approve"
  | "recommend-deny"
  | "escalate"
  | "defer";

export type LeaveDecisionAction = "approve" | "deny" | "escalate";

/**
 * Combine the hard guards with the kernel outcome. A fired guard always wins
 * and forces escalation; otherwise the kernel's recommendation passes through,
 * and any non-committal kernel outcome (escalate/defer) escalates by exception.
 */
export function resolveLeaveDecision(args: {
  guards: LeaveGuardVerdict;
  kernelOutcome: LeaveKernelOutcome;
}): LeaveDecisionAction {
  if (args.guards.forceEscalate) return "escalate";
  switch (args.kernelOutcome) {
    case "recommend-approve":
      return "approve";
    case "recommend-deny":
      return "deny";
    default:
      return "escalate";
  }
}
