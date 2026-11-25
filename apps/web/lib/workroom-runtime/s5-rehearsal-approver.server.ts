import "server-only";
import { prisma, type Prisma } from "@dpf/db";
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

/** Registered decision authorization. Re-read the producer's authority event
 * and current requester rather than mistaking an Inbox card for authority. */
export async function canDecideS5RehearsalEnvelope(envelope: {
  authorityDecisionId?: string | null; inputFingerprint?: string | null; approvalBindingFingerprint?: string | null;
  delegatingUserId: string; coworkerAgentId: string;
}, userId: string) {
  if (envelope.delegatingUserId !== userId || !envelope.authorityDecisionId || !envelope.inputFingerprint
    || !envelope.approvalBindingFingerprint) return false;
  const [approver, decision] = await Promise.all([
    readS5RehearsalApprover(prisma, userId),
    prisma.authorizationDecisionLog.findUnique({ where: { decisionId: envelope.authorityDecisionId }, select: {
      actorType: true, actorRef: true, humanContextRef: true, agentContextRef: true, actionKey: true, objectRef: true,
      decision: true, purposeOfUse: true, rationale: true,
    } }),
  ]);
  if (!approver || !decision || decision.actorType !== "human" || decision.actorRef !== userId || decision.humanContextRef !== userId
    || decision.agentContextRef !== envelope.coworkerAgentId || decision.actionKey !== S5_REHEARSAL_APPROVAL_ACTION
    || decision.decision !== "require-approval" || decision.purposeOfUse !== "synthetic-rehearsal-approval-request"
    || !decision.objectRef || !isRecord(decision.rationale) || decision.rationale.approverPrincipalId !== approver.principalId
    || decision.rationale.inputFingerprint !== envelope.inputFingerprint || typeof decision.rationale.sessionRef !== "string") return false;
  const room = await prisma.workroom.findUnique({ where: { capsuleId: decision.objectRef }, select: {
    archivedAt: true, requestedByPrincipalId: true, taskRun: { select: { archivedAt: true, taskRunId: true, userId: true } },
  } });
  return !!room?.requestedByPrincipalId && room.requestedByPrincipalId !== approver.id && room.archivedAt === null
    && room.taskRun?.archivedAt === null && room.taskRun.taskRunId === decision.rationale.sessionRef && room.taskRun.userId !== userId;
}
