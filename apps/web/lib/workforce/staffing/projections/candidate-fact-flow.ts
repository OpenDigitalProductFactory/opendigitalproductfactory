/**
 * Time-off-intent candidate-fact flow (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 7).
 * Spec §2.2, §10, §11: a message, a "busy" calendar block, or a learned pattern
 * is NEVER an approved leave request. Communication-derived intent enters as a
 * bounded `WorkforceCandidateFact`, and only an employee-confirmed fact becomes a
 * pending `LeaveRequest` — which still requires the configured approver before it
 * is approved leave (a hard unavailability). This module is the pure state
 * machine for that pipeline; it performs no writes and can never emit an approved
 * leave.
 *
 * The flow (spec §11):
 *   provider event -> candidate fact (time_off_intent)
 *     -> employee confirm/edit/reject
 *     -> LeaveRequest(pending)      [confirm only]
 *     -> authorized approval        [OUT OF SCOPE HERE — human decides]
 */

export type CandidateFact = {
  candidateFactId: string;
  subjectEmployeeProfileId: string | null;
  kind: string; // "time_off_intent" | ...
  reviewState: string; // "pending" | "confirmed" | "edited" | "rejected"
  extractedValue: { startDate?: string; endDate?: string; leaveType?: string } | null;
  identityResolution: string; // "unresolved" | "resolved" | "ambiguous"
  confidence: number | null;
};

export type EmployeeReview =
  | { action: "confirm" }
  | { action: "edit"; startDate: string; endDate: string; leaveType?: string }
  | { action: "reject" };

/** A pending LeaveRequest payload — the ONLY thing a confirmed intent promotes
 *  to. It is `pending`, never approved: an approver still decides (spec §11). */
export type PendingLeaveRequestDraft = {
  employeeProfileId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: "pending";
  sourceCandidateFactId: string;
};

export type FlowResult =
  | { outcome: "promoted"; draft: PendingLeaveRequestDraft; nextReviewState: "confirmed" }
  | { outcome: "rejected"; nextReviewState: "rejected" }
  | { outcome: "blocked"; reason: string };

/**
 * Apply an employee review to a candidate fact. A confirm/edit on a time-off
 * intent with a resolved subject and dates promotes to a PENDING leave draft;
 * anything else is blocked (never silently promoted). Identity must be resolved
 * — an ambiguous or unresolved subject can never generate a leave request
 * (spec §10 identity resolution; §2.2 never treat unread/inferred as approved).
 */
export function applyEmployeeReview(fact: CandidateFact, review: EmployeeReview): FlowResult {
  if (fact.kind !== "time_off_intent") {
    return { outcome: "blocked", reason: `candidate fact kind "${fact.kind}" is not a time-off intent` };
  }
  if (review.action === "reject") {
    return { outcome: "rejected", nextReviewState: "rejected" };
  }
  if (fact.subjectEmployeeProfileId === null || fact.identityResolution !== "resolved") {
    return { outcome: "blocked", reason: "subject identity is not resolved; cannot create a leave request" };
  }

  const start = review.action === "edit" ? review.startDate : fact.extractedValue?.startDate;
  const end = review.action === "edit" ? review.endDate : fact.extractedValue?.endDate;
  const leaveType =
    (review.action === "edit" ? review.leaveType : fact.extractedValue?.leaveType) ?? "unspecified";

  if (!start || !end) {
    return { outcome: "blocked", reason: "confirmed intent is missing start/end dates" };
  }
  if (new Date(end).getTime() < new Date(start).getTime()) {
    return { outcome: "blocked", reason: "end date precedes start date" };
  }

  return {
    outcome: "promoted",
    nextReviewState: "confirmed",
    draft: {
      employeeProfileId: fact.subjectEmployeeProfileId,
      leaveType,
      startDate: start,
      endDate: end,
      status: "pending",
      sourceCandidateFactId: fact.candidateFactId,
    },
  };
}
