// How long a coworker approval request lives (BI-0012E6CA).
//
// Every authority envelope used to get one fixed fifteen-minute window. That
// treats each approval as a synchronous "the agent is blocked on you" exchange,
// so a request raised while the person was asleep lapsed before they returned
// (merge_backlog_items, 2026-10-01, 04:00). Most approvals are not time-bound:
// the decision is as good tomorrow as it is now, and the execution path re-checks
// the exact call anyway.
//
// The lifetime is derived from the call's DECLARED consequence
// (ToolDefinition.consequence, narrowed per call by resolveCallConsequence) —
// the same property the escalation gate uses. There is no second taxonomy.
//
//   outward       → the short decision window. The effect leaves the install
//                   and cannot be recalled, and the content and target it was
//                   approved for age. Platform-scoped outward calls are
//                   deliberately included until that is decided separately.
//   unclassified  → the short decision window. The classification could not be
//                   read (unknown or discovered tool), so the old behaviour
//                   stands — fail closed.
//   everything else (irreversible, authority, ordinary) → seven days. Seven days
//                   is the pending-work default of the kernel principle
//                   paused-work-is-not-abandoned-work: it survives a week of
//                   travel and a weekly rate-limit reset. It is a real date, not
//                   "never", because several execution paths treat a missing
//                   expiresAt as already expired.
//
// Pure: imported by the authority evaluator, the envelope writer and the inbox.

import type { ToolConsequence } from "@/lib/tool-consequence";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The short window: how long a time-bound approval stays decidable. */
export const APPROVAL_DECISION_WINDOW_MS = 15 * MINUTE_MS;

/** How long a durable approval stays decidable (paused-work-is-not-abandoned-work). */
export const DURABLE_APPROVAL_LIFETIME_MS = 7 * DAY_MS;

/**
 * How far back a retry may find the settled outcome of an identical approved
 * call and return it instead of asking again (BI-12E5DD91, BI-F4EB23C1). A
 * replay window, not a decision window: lengthening approval lifetimes does not
 * lengthen it.
 */
export const APPROVAL_REPLAY_WINDOW_MS = 15 * MINUTE_MS;

/** How far back an expired, unanswered request stays re-surfaceable in the inbox. */
export const EXPIRED_APPROVAL_RESURFACE_MS = DURABLE_APPROVAL_LIFETIME_MS;

/**
 * The call's resolved consequence, or `"unclassified"` when it could not be
 * read. `null` is a positive claim: the tool declares no consequence.
 */
export type ApprovalClassification = ToolConsequence | null | "unclassified";

/** How long an approval for a call of this classification may stay open. */
export function approvalLifetimeMs(consequence: ApprovalClassification): number {
  return consequence === "outward" || consequence === "unclassified"
    ? APPROVAL_DECISION_WINDOW_MS
    : DURABLE_APPROVAL_LIFETIME_MS;
}

/**
 * The staleness re-check at execution.
 *
 * The stored `expiresAt` was chosen under the classification that held when the
 * request was raised. At execution the same exact call is classified again, and
 * the approval is honoured only until
 * `min(expiresAt, approvedAt + approvalLifetimeMs(currentConsequence))` — so an
 * approval given under a durable classification cannot authorize a call that
 * now resolves as time-bound. Without an approval time there is nothing to
 * re-judge and the stored window stands.
 */
export function effectiveApprovalExpiry(input: {
  expiresAt: Date;
  approvedAt?: Date | null;
  consequence: ApprovalClassification;
}): Date {
  if (!input.approvedAt) return input.expiresAt;
  const byClassification = input.approvedAt.getTime() + approvalLifetimeMs(input.consequence);
  return new Date(Math.min(input.expiresAt.getTime(), byClassification));
}
