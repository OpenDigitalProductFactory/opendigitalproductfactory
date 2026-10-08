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

import { prisma, type Prisma } from "@dpf/db";
import { createAuthorizationDecisionLog } from "@/lib/governance-data";
import { isRecord } from "@/lib/shared/coerce";
import { humanApprovalMarker } from "./human-approved-execution";
import { labelOnBehalfDecision, readOnBehalfDecision, type OnBehalfDecision } from "./on-behalf-decision";

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
  approvalBindingFingerprint?: string | null;
  rationale: string;
  status: EnvelopeStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  expiresAt?: Date | null;
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

// ─── Deciding on someone's behalf (BI-7BCC87BB, plan B8, AC-OVERRIDE) ──────────
//
// The founder's answer to waiver W6: the person whose authority is lent (for a
// scheduled task, its owner) is the primary approver, and an admin can decide
// in their place — when that person has left, or cannot sign in — with a reason.
// "Admin" is the capability the user-management surface checks (manage_users,
// lib/actions/users.ts); the route resolves it from the session and passes it
// in. The request keeps its delegating user: the approved call still runs with
// that person's authority, re-checked by the monitor (spec D4). Nothing is
// reassigned (BI-D9562C1D's WWMD answer, no reassignment, stands); the
// override is a recorded decision, not a transfer.

/** What the caller asked for when deciding someone else's request. */
export type OnBehalfDecisionRequest = { reason: string; callerIsAdmin: boolean };

export { readOnBehalfDecision, type OnBehalfDecision } from "./on-behalf-decision";

/** The on-behalf record with each person named by their sign-in email, for the card. */
export async function describeOnBehalfDecision(argsJson: unknown): Promise<OnBehalfDecision | null> {
  const decision = readOnBehalfDecision(argsJson);
  if (!decision) return null;
  const users = await prisma.user.findMany({
    where: { id: { in: [decision.by, decision.onBehalfOf] } },
    select: { id: true, email: true },
  }).catch(() => [] as Array<{ id: string; email: string }>);
  return labelOnBehalfDecision(decision, new Map(users.map((user) => [user.id, user.email])));
}

/** The bound authority envelope's metadata, or null for a screen-action envelope (verbatim args). */
function boundAuthorityArgs(envelope: EnvelopeRow): Record<string, unknown> | null {
  return envelope.approvalBindingFingerprint
    && isRecord(envelope.argsJson) && isRecord(envelope.argsJson.approvalBinding)
    ? envelope.argsJson : null;
}

/**
 * Who may decide: the delegate, unchanged; otherwise an admin with a non-empty
 * reason, on a bound authority envelope only. Returns the cleaned reason when
 * this is an on-behalf decision, null when it is the delegate's own.
 */
function authorizeDecider(
  envelope: EnvelopeRow,
  callerUserId: string,
  onBehalf: OnBehalfDecisionRequest | undefined,
): { ok: true; reason: string | null } | { ok: false; reason: string; httpStatus: number } {
  if (envelope.delegatingUserId === callerUserId) return { ok: true, reason: null };
  const refused = assertCallerIsDelegate(envelope, callerUserId);
  if (!onBehalf?.callerIsAdmin) return refused as { ok: false; reason: string; httpStatus: number };
  const reason = onBehalf.reason.trim();
  if (!reason) {
    return { ok: false, reason: "Deciding someone else's request needs a reason, which is recorded with the decision.", httpStatus: 400 };
  }
  if (!boundAuthorityArgs(envelope)) {
    return { ok: false, reason: "Only the person who was asked can decide this request.", httpStatus: 409 };
  }
  return { ok: true, reason };
}

async function auditOnBehalf(envelope: EnvelopeRow, by: string, reason: string, verb: "approve" | "decline"): Promise<void> {
  await createAuthorizationDecisionLog({
    actorType: "user",
    actorRef: by,
    humanContextRef: envelope.delegatingUserId,
    actionKey: `coworker_envelope.${verb}_on_behalf`,
    objectRef: envelope.id,
    decision: "allow",
    rationale: {
      by, onBehalfOf: envelope.delegatingUserId, reason,
      toolName: envelope.manifestActionId, coworkerAgentId: envelope.coworkerAgentId,
    },
  });
}

/**
 * A decision that arrives after the window closed settles the request as
 * `expired` instead of approving or declining it (BI-12E5DD91, BI-78D3CF1E).
 * The periodic sweep does the same later; doing it here means a stale card
 * can never approve a lapsed request, and the person sees why.
 */
async function refuseIfLapsed(envelope: EnvelopeRow): Promise<EnvelopeActionResult<EnvelopeRow> | null> {
  if (!envelope.expiresAt || envelope.expiresAt.getTime() > Date.now()) return null;
  if (envelope.status === "proposed" || envelope.status === "approved") {
    await prisma.coworkerActionEnvelope.updateMany({
      where: { id: envelope.id, status: { in: ["proposed", "approved"] }, resolvedAt: null },
      data: { status: "expired", resolvedAt: new Date() },
    });
  }
  return {
    ok: false,
    reason: "This request's decision window closed before it was answered, so it has expired. Your coworker can ask again.",
    httpStatus: 409,
  };
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
  onBehalf?: OnBehalfDecisionRequest,
): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;
  const authz = authorizeDecider(load.envelope, callerUserId, onBehalf);
  if (!authz.ok) return authz;
  const lapsed = await refuseIfLapsed(load.envelope);
  if (lapsed) return lapsed;

  const transition = transitionOnApprove(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  // Bound authority envelopes store metadata, not executable arguments. Screen
  // action envelopes replay argsJson verbatim, so never add metadata to them.
  const boundArgs = boundAuthorityArgs(load.envelope);
  const marker = humanApprovalMarker(callerUserId);
  const data = {
    status: "approved",
    // BI-E6E2E704: distinguish an authenticated person's decision from a
    // policy-projected envelope. Preserve the existing exact-call binding.
    // BI-7BCC87BB: an on-behalf approval names the admin, the owner and why.
    ...(boundArgs ? { argsJson: {
      ...boundArgs,
      humanApproval: authz.reason
        ? { ...marker, by: callerUserId, onBehalfOf: load.envelope.delegatingUserId, reason: authz.reason }
        : marker,
    } as Prisma.InputJsonObject } : {}),
  };
  // Conditional on still being proposed: two overlapping decisions (a slow
  // first POST and a second press after the card reconciled, BI-F4EB23C1)
  // record one approval; the other is told it is already settled.
  const claimed = await prisma.coworkerActionEnvelope.updateMany({
    where: { id: envelopeId, status: "proposed" },
    data,
  });
  if (claimed.count !== 1) {
    return { ok: false, reason: "This request was already decided.", httpStatus: 409 };
  }
  if (authz.reason) await auditOnBehalf(load.envelope, callerUserId, authz.reason, "approve");
  const updated = { ...load.envelope, ...data };
  // Approving does NOT mark the waiting task working here, and must not.
  // Marking it working at approval time makes the resume's CAS on
  // `status: "input-required"` unmatchable and the approval unusable — #4796
  // did exactly that and was reverted. The approve route instead runs the
  // resume itself (approved-task-run.ts, BI-9FD11E5E), taking that same CAS, so
  // it and a client replay of the immutable packet cannot both run the writer.
  // If an approval appears not to take effect, check the envelope's
  // `expiresAt` first: outward requests close after 15 minutes, everything
  // else after seven days (approval-lifetime.ts, BI-0012E6CA), and execution
  // re-checks freshness against the call's current classification.
  return { ok: true, envelope: updated as EnvelopeRow };
}

/** User-side deny: proposed → declined. Terminal — the envelope cannot
 *  be reopened. (If the user wants the same action they re-prompt the
 *  coworker; this is auditable as a fresh envelope.) */
export async function denyEnvelope(
  envelopeId: string,
  callerUserId: string,
  onBehalf?: OnBehalfDecisionRequest,
): Promise<EnvelopeActionResult<EnvelopeRow>> {
  const load = await loadEnvelope(envelopeId);
  if (!load.ok) return load;
  const authz = authorizeDecider(load.envelope, callerUserId, onBehalf);
  if (!authz.ok) return authz;
  const lapsed = await refuseIfLapsed(load.envelope);
  if (lapsed) return lapsed;

  const transition = transitionOnDeny(load.envelope.status);
  if (!transition.ok) {
    return {
      ok: false,
      reason: describeTransitionError(transition) ?? "Transition refused.",
      httpStatus: 409,
    };
  }

  const declinedOnBehalf = authz.reason ? {
    argsJson: {
      ...boundAuthorityArgs(load.envelope),
      humanDecline: { by: callerUserId, onBehalfOf: load.envelope.delegatingUserId, reason: authz.reason, declinedAt: new Date().toISOString() },
    } as Prisma.InputJsonObject,
  } : {};
  const updated = await prisma.coworkerActionEnvelope.update({
    where: { id: envelopeId },
    data: { status: "declined", resolvedAt: new Date(), ...declinedOnBehalf },
  });
  if (authz.reason) await auditOnBehalf(load.envelope, callerUserId, authz.reason, "decline");
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
