// Pseudo-User Contract (spec §6.4) — Prisma-bound envelope actions.
// Wraps the pure state machine (envelope-state-machine.ts) with the
// minimum DB I/O needed by the chat handler, the API routes, and the
// future screen_propose_action / screen_dispatch_action handlers.
//
// Each action:
//   1. Loads the current envelope row by id.
//   2. Validates the transition via the state machine.
//   3. Writes the new status (plus side fields — resolvedAt, link to
//      the resulting ToolExecution row when relevant).
//   4. Returns a discriminated union so callers can render a clear
//      success or refusal without exception handling.
//
// Tests live in the integration tier (require a DB connection); the
// pure state-machine layer is covered by unit tests in
// envelope-state-machine.test.ts.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { prisma } from "@dpf/db";

import {
  describeTransitionError,
  isEnvelopeStatus,
  transitionOnApprove,
  transitionOnCancel,
  transitionOnDeny,
  transitionOnExecutionFailure,
  transitionOnExecutionSuccess,
  type EnvelopeStatus,
} from "./envelope-state-machine";

export interface EnvelopeRow {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  threadId: string;
  chatMessageId: string | null;
  manifestActionId: string;
  argsJson: unknown;
  rationale: string;
  status: EnvelopeStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

// Deliberately NOT lib/shared/action-result's ActionResult: this is an HTTP
// refusal contract (structured reason + status for the API routes), renamed so
// the generic name has exactly one home (BI-1CED89B9, Simplify & Strengthen W6).
export type EnvelopeActionResult<T = EnvelopeRow> =
  | { ok: true; envelope: T }
  | { ok: false; reason: string; httpStatus: number };

/** Common load + validate prelude. Returns the row in a known-good shape
 *  (with `status` typed as EnvelopeStatus) or a structured refusal. */
async function loadEnvelope(envelopeId: string): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const row = await prisma.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  if (!row) {
    return { ok: false, reason: `Envelope ${envelopeId} not found.`, httpStatus: 404 };
  }
  if (!isEnvelopeStatus(row.status)) {
    return {
      ok: false,
      reason: `Envelope ${envelopeId} has an unrecognised status: ${JSON.stringify(row.status)}.`,
      httpStatus: 500,
    };
  }
  return { ok: true, envelope: row as EnvelopeRow };
}

/** Verify the calling user matches the envelope's delegating user. Coworker
 *  actions only ever resolve on behalf of the user who initiated the
 *  chat turn that produced the proposal. */
function assertCallerIsDelegate(envelope: EnvelopeRow, callerUserId: string): EnvelopeActionResult<EnvelopeRow> {
  if (envelope.delegatingUserId !== callerUserId) {
    return {
      ok: false,
      reason: `User ${callerUserId} cannot act on envelope ${envelope.id} — delegating user is ${envelope.delegatingUserId}.`,
      httpStatus: 403,
    };
  }
  return { ok: true, envelope };
}

// ─── Verbs ───────────────────────────────────────────────────────────────────

/** User-side approve: proposed → approved. The actual underlying-tool
 *  execution happens in a follow-on call (markExecutedOnSuccess /
 *  markFailedOnExecutionError); they're split so the approval audit row
 *  lands before the side effect runs and the side-effect outcome is
 *  recorded against the same envelope. */
export async function approveEnvelope(
  envelopeId: string,
  callerUserId: string,
): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;
  const authz = assertCallerIsDelegate(load.envelope, callerUserId);
  if (!authz.ok) return authz;

  const transition = transitionOnApprove(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "approved" },
  });

  // BI-3907AF35: approving is only half the handoff. The coworker asked for
  // this action, was refused with `approval-required`, and its task parked at
  // `input-required`. The authority gate finds the approved envelope on the
  // coworker's NEXT attempt — but nothing makes it attempt again, so an
  // approved envelope and a waiting task sit and stare at each other forever.
  //
  // Live repro: envelope cmtcts7a1 (record_initiative_design_review for
  // BI-C3B5FB75) approved, task TR-...7EDD83DD497B still `input-required` with
  // no retry; re-summoning replayed the idempotent packet without re-invoking.
  // Nobody could record the spec approval, and spec-approval is
  // `independent: true` so nobody else was permitted to.
  //
  // Marking the task working is what resumeAuthorityApprovalTask exists for.
  // Best-effort: a failure to resume must not undo an approval the employee
  // has already given.
  if (updated.taskRunId) {
    try {
      const { resumeAuthorityApprovalTask } = await import(
        "@/lib/coworker/authority-approval-envelope"
      );
      await resumeAuthorityApprovalTask(updated.taskRunId);
    } catch {
      // The approval stands; the task can still be resumed by any later attempt.
    }
  }

  return { ok: true, envelope: updated as EnvelopeRow };
}

/** User-side deny: proposed → declined. Terminal — the envelope cannot
 *  be reopened. (If the user wants the same action they re-prompt the
 *  coworker; this is auditable as a fresh envelope.) */
export async function denyEnvelope(
  envelopeId: string,
  callerUserId: string,
): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;
  const authz = assertCallerIsDelegate(load.envelope, callerUserId);
  if (!authz.ok) return authz;

  const transition = transitionOnDeny(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "declined", resolvedAt: new Date() },
  });
  return { ok: true, envelope: updated as EnvelopeRow };
}

/** Cancellation: either status (proposed | approved) → cancelled. Used
 *  by the chat handler when the user navigates away or the turn ends
 *  with an envelope still in flight. */
export async function cancelEnvelope(
  envelopeId: string,
  callerUserId: string,
): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;
  const authz = assertCallerIsDelegate(load.envelope, callerUserId);
  if (!authz.ok) return authz;

  const transition = transitionOnCancel(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "cancelled", resolvedAt: new Date() },
  });
  return { ok: true, envelope: updated as EnvelopeRow };
}

/** Side-effect-side finalisers. Called by the dispatcher after the
 *  underlying tool runs. The dispatcher itself owns the executeTool
 *  call; these helpers only record the outcome against the envelope.
 *  Status flow: approved → executed (on success) or approved → failed
 *  (on error). Both are terminal. */
export async function markEnvelopeExecuted(envelopeId: string): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;

  const transition = transitionOnExecutionSuccess(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "executed", resolvedAt: new Date() },
  });
  return { ok: true, envelope: updated as EnvelopeRow };
}

export async function markEnvelopeFailed(envelopeId: string): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;

  const transition = transitionOnExecutionFailure(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "failed", resolvedAt: new Date() },
  });
  return { ok: true, envelope: updated as EnvelopeRow };
}
