import "server-only";
import type { Prisma } from "@dpf/db";
import { currentUserContextFromRecord } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";
import { isRecord } from "@/lib/shared/coerce";
import { S5_REHEARSAL_APPROVAL_ACTION } from "./s5-rehearsal-approval-action";

/** Own current installation authority, not the task actor or a session claim.
 * The DB's unique local user alias pins the same active human in the envelope. */
export async function readS5RehearsalApprover(tx: Pick<Prisma.TransactionClient, "user" | "principalAlias">, userId: string) {
  const [user, alias] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: {
      isActive: true, isSuperuser: true, groups: { select: { platformRole: { select: { roleId: true } } } },
      automationVerificationId: true, automationProfile: true, automationSlot: true, automationExpiresAt: true,
    } }),
    tx.principalAlias.findUnique({
      where: { aliasType_aliasValue_issuer: { aliasType: "user", aliasValue: userId, issuer: "" } },
      select: { principal: { select: { id: true, principalId: true, kind: true, status: true } } },
    }),
  ]);
  if (!user?.isActive || user.automationVerificationId !== null || user.automationProfile !== null
    || user.automationSlot !== null || user.automationExpiresAt !== null
    || alias?.principal.kind !== "human" || alias.principal.status !== "active") return null;
  const actor = currentUserContextFromRecord(userId, user);
  return actor && can(actor, "manage_platform") ? { userId, id: alias.principal.id, principalId: alias.principal.principalId } : null;
}

export type S5DecisionEnvelope = {
  id: string; manifestActionId: string; expiresAt?: Date | null; argsJson: unknown;
  authorityDecisionId?: string | null; inputFingerprint?: string | null; approvalBindingFingerprint?: string | null;
  delegatingUserId: string; coworkerAgentId: string;
};

/** Durable locator only. The decision transaction re-reads the event, locks
 * the room, verifies reviewed pins and re-resolves the current approver. */
export async function readS5RehearsalDecision(db: Pick<Prisma.TransactionClient, "authorizationDecisionLog">,
  envelope: S5DecisionEnvelope, userId: string) {
  if (envelope.delegatingUserId !== userId || !envelope.authorityDecisionId || !envelope.inputFingerprint
    || !envelope.approvalBindingFingerprint || envelope.manifestActionId !== S5_REHEARSAL_APPROVAL_ACTION) return null;
  const decision = await db.authorizationDecisionLog.findUnique({ where: { decisionId: envelope.authorityDecisionId }, select: {
      actorType: true, actorRef: true, humanContextRef: true, agentContextRef: true, actionKey: true, objectRef: true,
      decision: true, purposeOfUse: true, rationale: true, authorityBindingId: true,
  } });
  if (!decision || decision.actorType !== "human" || decision.actorRef !== userId || decision.humanContextRef !== userId
    || decision.agentContextRef !== envelope.coworkerAgentId || decision.actionKey !== S5_REHEARSAL_APPROVAL_ACTION
    || decision.decision !== "require-approval" || decision.purposeOfUse !== "synthetic-rehearsal-approval-request"
    || !decision.objectRef || !decision.authorityBindingId || !isRecord(decision.rationale)
    || decision.rationale.inputFingerprint !== envelope.inputFingerprint) return null;
  const { approverPrincipalId, reviewedPinDigest, permitRef, sessionRef, stageKey, stageAttemptRef } = decision.rationale;
  if (typeof approverPrincipalId !== "string" || typeof permitRef !== "string"
    || typeof reviewedPinDigest !== "string" || !/^[a-f0-9]{64}$/u.test(reviewedPinDigest)
    || typeof sessionRef !== "string" || typeof stageKey !== "string" || typeof stageAttemptRef !== "string") return null;
  return { approverPrincipalId, reviewedPinDigest, permitRef, bindingRowId: decision.authorityBindingId,
    attempt: { workroomId: decision.objectRef, sessionRef, stageKey, stageAttemptRef } };
}
