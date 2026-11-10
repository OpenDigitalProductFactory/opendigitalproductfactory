// Accountable-approver resolution for workforce approvals (BI-HCM-004).
//
// Today every domain hand-rolls a single hop: leave reads
// `request.employeeProfile.managerEmployeeId` directly, timesheets query
// `where: { managerEmployeeId }` for direct reports. None of them handle the cases that
// actually strand work — manager unset, manager no longer able to act, or a reporting loop.
//
// This is the shared walk those domains should ask instead. Pure and DB-free so the routing
// rules are testable without Prisma; callers supply the rows.
//
// Two operator decisions are encoded here, deliberately:
//
//   1. When nobody up the chain can approve, this FAILS LOUDLY. It never invents a fallback
//      approver. An unresolved request is surfaced as operator work with the reason, so a
//      missing reporting line stays visible instead of being absorbed by a backstop.
//
//   2. An on-leave manager is skipped so work keeps moving — but the skip is TRANSIENT, not a
//      handoff. `onBehalfOf` names the manager who was routed past, so the approval stays
//      attributable to them rather than silently becoming the deputy's decision.

import { collectAncestorIds } from "./org-chart-model";
import type { WorkforceStatus } from "./workforce-types";

export type ApproverRow = {
  id: string;
  managerEmployeeId: string | null;
  status: WorkforceStatus;
};

/** Why a level of the chain could not act. */
export type SkipReason =
  | "inactive"
  | "offboarding"
  | "suspended"
  | "on-leave"
  | "offer"
  | "onboarding"
  /**
   * The approver referred this candidate (BI-D78DC392). Conflict of interest:
   * a referrer may not approve their own referral, whether or not a bonus is
   * attached. This is one more skip reason in the existing walk rather than a
   * second router - the chain-exhausted and reporting-loop failures below still
   * fail loud, so excluding the referrer can never silently produce no approver.
   */
  | "referred-this-candidate";

/**
 * Statuses that cannot approve.
 *
 * `leave` is included per operator decision — work keeps moving during an absence. It is the
 * only *transient* reason, which is why it drives `onBehalfOf`.
 *
 * `offer` and `onboarding` are included because someone who has not started cannot be
 * accountable for a decision.
 */
const CANNOT_ACT: Record<string, SkipReason> = {
  inactive: "inactive",
  offboarding: "offboarding",
  suspended: "suspended",
  leave: "on-leave",
  offer: "offer",
  onboarding: "onboarding",
};

/** Reasons the walk is transient — the person is expected back. */
const TRANSIENT: ReadonlySet<SkipReason> = new Set<SkipReason>(["on-leave"]);

export type ApprovalHop = {
  employeeProfileId: string;
  /** False for the hop that resolved. */
  skipped: boolean;
  reason?: SkipReason;
};

export type UnresolvedReason =
  /** The employee has no manager at all. */
  | "no-manager-set"
  /** Every manager up the chain is unable to act. */
  | "chain-exhausted"
  /** The chain loops, so it never reaches a root. */
  | "reporting-loop"
  /** The employee row was not supplied. */
  | "employee-not-found";

export type ApprovalRouting =
  | {
      resolved: true;
      approverEmployeeId: string;
      /**
       * Set when the walk passed a manager who is temporarily away. The approval belongs to
       * this person; the approver is acting for them.
       */
      onBehalfOf: string | null;
      path: ApprovalHop[];
    }
  | {
      resolved: false;
      reason: UnresolvedReason;
      path: ApprovalHop[];
      /** The last manager considered, for an actionable operator message. */
      stoppedAt: string | null;
    };

/**
 * Walk up the reporting chain and return the first manager who can act.
 *
 * Cycle-safe: the ancestor walk terminates on a loop and reports it rather than hanging, which
 * is why the org chart's cycle guard is a prerequisite for approval routing rather than a
 * nicety — a detached branch has no resolvable approver.
 */
export function resolveAccountableApprover(
  rows: ApproverRow[],
  employeeProfileId: string,
  /**
   * Employee ids excluded from approving THIS decision for conflict of interest
   * — currently the referrer of the candidate under consideration
   * (BI-D78DC392). Excluded like any other unable-to-act level, so the walk
   * continues upward rather than failing at the conflicted hop.
   */
  conflictedApproverIds: readonly string[] = [],
): ApprovalRouting {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const employee = byId.get(employeeProfileId);
  if (!employee) {
    return { resolved: false, reason: "employee-not-found", path: [], stoppedAt: null };
  }

  if (!employee.managerEmployeeId) {
    return { resolved: false, reason: "no-manager-set", path: [], stoppedAt: null };
  }

  const { ancestorIds, hitCycle } = collectAncestorIds(rows, employeeProfileId);

  const path: ApprovalHop[] = [];
  let onBehalfOf: string | null = null;

  for (const ancestorId of ancestorIds) {
    const candidate = byId.get(ancestorId);
    if (!candidate) continue;

    const conflicted = conflictedApproverIds.includes(ancestorId);
    if (conflicted) {
      // A conflict is NOT transient: a deputy does not act "on behalf of" a
      // referrer, because the whole point is that this person's judgement is
      // excluded from this decision.
      path.push({ employeeProfileId: ancestorId, skipped: true, reason: "referred-this-candidate" });
      continue;
    }

    const blocked = CANNOT_ACT[candidate.status];
    if (!blocked) {
      path.push({ employeeProfileId: ancestorId, skipped: false });
      return { resolved: true, approverEmployeeId: ancestorId, onBehalfOf, path };
    }

    path.push({ employeeProfileId: ancestorId, skipped: true, reason: blocked });
    // The FIRST transient skip owns the decision; a deeper deputy still acts for them.
    if (onBehalfOf === null && TRANSIENT.has(blocked)) onBehalfOf = ancestorId;
  }

  return {
    resolved: false,
    reason: hitCycle ? "reporting-loop" : "chain-exhausted",
    path,
    stoppedAt: path.length > 0 ? path[path.length - 1]!.employeeProfileId : null,
  };
}

/** Operator-facing explanation for an unresolved routing. Plain language, names the fix. */
export function describeUnresolvedRouting(
  routing: Extract<ApprovalRouting, { resolved: false }>,
  nameOf: (employeeProfileId: string) => string,
  subjectId: string,
): string {
  switch (routing.reason) {
    case "no-manager-set":
      return `${nameOf(subjectId)} has no manager set, so there is nobody to approve this. Set their manager on the org chart.`;
    case "chain-exhausted":
      return `Nobody above ${nameOf(subjectId)} can approve this right now. Set a manager who is available, or bring one back to active.`;
    case "reporting-loop":
      return `${nameOf(subjectId)} is in a reporting loop, so the chain never reaches anyone accountable. Fix the loop on the org chart.`;
    case "employee-not-found":
      return `That employee record could not be found, so no approver could be resolved.`;
  }
}
