// Server-side authority check for workforce approvals (BI-HCM-004).
//
// The DB-facing companion to the pure walk in `approval-routing.ts`. It exists so leave,
// timesheets, and future approval surfaces share ONE authority rule instead of each writing
// their own — which is how both surfaces ended up with no rule at all.
//
// Not a `"use server"` module: it is a helper that server actions call, so it may export
// non-action functions.

import { prisma } from "@dpf/db";
import { describeUnresolvedRouting, resolveAccountableApprover } from "./approval-routing";
import type { WorkforceStatus } from "./workforce-types";

export type ApprovalAuthority =
  | { ok: true; approverEmployeeId: string; onBehalfOf: string | null }
  | { ok: false; error: string };

/**
 * May this signed-in user decide something on `subjectEmployeeProfileId`'s behalf?
 *
 * Authority comes from the org chart: the subject's manager, or the first person above them
 * who can act. An unresolvable chain fails with operator-facing copy that names the fix rather
 * than leaving the request to sit unexplained.
 *
 * @param decisionNoun what the caller is deciding, for the "no employee profile" message.
 */
export async function authorizeApprovalDecision(
  userId: string,
  subjectEmployeeProfileId: string,
  decisionNoun = "this",
): Promise<ApprovalAuthority> {
  const actor = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!actor) {
    return {
      ok: false,
      error: `You do not have an employee profile, so you cannot decide ${decisionNoun}.`,
    };
  }

  const rows = await prisma.employeeProfile.findMany({
    select: { id: true, managerEmployeeId: true, status: true, displayName: true },
  });

  const routing = resolveAccountableApprover(
    rows.map((r) => ({
      id: r.id,
      managerEmployeeId: r.managerEmployeeId,
      status: r.status as WorkforceStatus,
    })),
    subjectEmployeeProfileId,
  );

  if (!routing.resolved) {
    const names = new Map(rows.map((r) => [r.id, r.displayName]));
    return {
      ok: false,
      error: describeUnresolvedRouting(
        routing,
        (id) => names.get(id) ?? "This employee",
        subjectEmployeeProfileId,
      ),
    };
  }

  if (routing.approverEmployeeId !== actor.id) {
    return { ok: false, error: "You are not the accountable approver for this request." };
  }

  return { ok: true, approverEmployeeId: actor.id, onBehalfOf: routing.onBehalfOf };
}
