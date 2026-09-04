// External MCP approval location.
//
// When a governed writer pauses for approval, the TaskRun result must name
// the exact owner and where that owner can act. The inbox still isolates by
// delegatingUserId; a different signed-in operator never inherits Approve
// merely by being an administrator.

import {
  envelopeApproveRoute,
  envelopeDeclineRoute,
} from "@/lib/coworker/envelope-routes";

export const PENDING_APPROVAL_INBOX_HREF = "/workspace/inbox";

export type ExternalApprovalLocation = {
  envelopeId: string;
  delegatingUserId: string;
  taskRunId: string | null;
  status: string;
  expiresAt: string | null;
  approveHref: string;
  declineHref: string;
  inboxHref: typeof PENDING_APPROVAL_INBOX_HREF;
  nextAction: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function describeExternalApprovalLocation(input: {
  envelopeId: string;
  delegatingUserId: string;
  taskRunId?: string | null;
  status?: string;
  expiresAt?: Date | string | null;
}): ExternalApprovalLocation {
  const approveHref = envelopeApproveRoute(input.envelopeId);
  return {
    envelopeId: input.envelopeId,
    delegatingUserId: input.delegatingUserId,
    taskRunId: input.taskRunId ?? null,
    status: input.status ?? "proposed",
    expiresAt: iso(input.expiresAt),
    approveHref,
    declineHref: envelopeDeclineRoute(input.envelopeId),
    inboxHref: PENDING_APPROVAL_INBOX_HREF,
    nextAction:
      `The approval owner is user ${input.delegatingUserId}. `
      + `Sign in as that user and open ${PENDING_APPROVAL_INBOX_HREF}, `
      + `or POST ${approveHref}. `
      + "A different signed-in operator cannot approve this envelope by administrator privilege.",
  };
}

export function withExternalApprovalLocation<T extends Record<string, unknown>>(
  result: T,
  location: ExternalApprovalLocation | null | undefined,
): T & { approval?: ExternalApprovalLocation } {
  if (!location) return result;
  return {
    ...result,
    requiresApproval: true,
    approval: location,
  };
}

export type PendingEnvelopeRow = {
  id: string;
  delegatingUserId: string;
  status: string;
  taskRunId: string | null;
  expiresAt: Date | string | null;
  rationale: string;
  manifestActionId: string;
};

/** Keep list and inbox on the same isolation predicate. */
export function isPendingEnvelopeVisibleToCaller(
  row: PendingEnvelopeRow,
  callerUserId: string,
  now: Date = new Date(),
): boolean {
  if (!callerUserId) return false;
  if (row.delegatingUserId !== callerUserId) return false;
  if (row.status !== "proposed") return false;
  const expiresAt = iso(row.expiresAt);
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

export function listPendingEnvelopesForCaller(
  rows: readonly PendingEnvelopeRow[],
  callerUserId: string,
  now: Date = new Date(),
): ExternalApprovalLocation[] {
  return rows
    .filter((row) => isPendingEnvelopeVisibleToCaller(row, callerUserId, now))
    .map((row) => describeExternalApprovalLocation({
      envelopeId: row.id,
      delegatingUserId: row.delegatingUserId,
      taskRunId: row.taskRunId,
      status: row.status,
      expiresAt: row.expiresAt,
    }));
}
