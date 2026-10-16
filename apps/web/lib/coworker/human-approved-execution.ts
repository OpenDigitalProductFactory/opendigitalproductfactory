import "server-only";
import { prisma } from "@dpf/db";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { isRecord } from "@/lib/shared/coerce";
import { currentUserContext, currentUserContextFromRecord } from "@/lib/govern/current-user-context";
import { can, type CapabilityKey } from "@/lib/permissions";

export type HumanApprovalMarker = { userId: string; approvedAt: string;
  by?: string; onBehalfOf?: string; reason?: string };

export function humanApprovalMarker(userId: string, now = new Date()): HumanApprovalMarker {
  return { userId, approvedAt: now.toISOString() };
}

function parseHumanApprovalMarker(value: unknown, now: number): HumanApprovalMarker | null {
  if (!isRecord(value) || typeof value.userId !== "string" || !value.userId.trim() || typeof value.approvedAt !== "string") return null;
  const approvedAt = Date.parse(value.approvedAt);
  if (!Number.isFinite(approvedAt) || approvedAt > now) return null;
  if ("by" in value || "onBehalfOf" in value || "reason" in value) {
    if (typeof value.by !== "string" || !value.by.trim() || typeof value.onBehalfOf !== "string" || !value.onBehalfOf.trim()
      || typeof value.reason !== "string" || !value.reason.trim()) return null;
    return { userId: value.userId, approvedAt: value.approvedAt, by: value.by, onBehalfOf: value.onBehalfOf, reason: value.reason };
  }
  return { userId: value.userId, approvedAt: value.approvedAt };
}

type ApprovalInput = {
  envelopeId?: string | null;
  toolName: string;
  userId: string;
  agentId?: string | null;
  params: Record<string, unknown>;
  /** Explicit consumer opt-in. Other consumers retain their owner-only contract. */
  requiredApproverCapability?: CapabilityKey;
};
type VerifiedApproval = { envelopeId: string; userId: string; approverUserId: string;
  onBehalfOf: string | null; inputFingerprint: string };

/** One interpretation of the stored decision for capture and later consumption.
 * The envelope comes from trusted execution context, never caller arguments. */
async function resolvePersistedHumanApproval(args: ApprovalInput, phase: "execution" | "consumption"): Promise<VerifiedApproval | null> {
  if (!args.envelopeId || !args.agentId) return null;
  const row = await prisma.coworkerActionEnvelope.findUnique({ where: { id: args.envelopeId } });
  const now = Date.now();
  const inputFingerprint = fingerprintCoworkerInput(args.params);
  // The executor's compare-and-set reserves once by setting resolvedAt while
  // status remains approved; it finalizes to executed after the handler.
  const allowedState = row?.status === "approved" || (phase === "consumption" && row?.status === "executed");
  if (!row || !allowedState || !row.resolvedAt || !Number.isFinite(row.resolvedAt.getTime()) || row.resolvedAt.getTime() > now
    || !row.expiresAt || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= now
    || row.manifestActionId !== args.toolName
    || row.delegatingUserId !== args.userId || row.coworkerAgentId !== args.agentId
    || row.inputFingerprint !== inputFingerprint) return null;
  const approval = parseHumanApprovalMarker(isRecord(row.argsJson) ? row.argsJson.humanApproval : null, now);
  if (!approval) return null;
  const onBehalf = approval.userId !== args.userId;
  if (onBehalf) {
    if (!args.requiredApproverCapability || approval.by !== approval.userId || approval.onBehalfOf !== args.userId) return null;
  } else if (approval.by !== undefined || approval.onBehalfOf !== undefined || approval.reason !== undefined) return null;

  if (args.requiredApproverCapability) {
    const user = await prisma.user.findUnique({ where: { id: approval.userId }, select: {
      isActive: true, isSuperuser: true, automationVerificationId: true, automationProfile: true,
      automationSlot: true, automationExpiresAt: true, groups: { include: { platformRole: true } },
    } });
    const actor = currentUserContextFromRecord(approval.userId, user);
    if (!actor || user?.automationVerificationId != null || user?.automationProfile != null
      || user?.automationSlot != null || user?.automationExpiresAt != null
      || !can(actor, args.requiredApproverCapability) || (onBehalf && !can(actor, "manage_users"))) return null;
    const owner = onBehalf ? await currentUserContext(args.userId) : actor;
    if (!owner || !can(owner, args.requiredApproverCapability)) return null;
  }
  return { envelopeId: row.id, userId: args.userId, approverUserId: approval.userId,
    onBehalfOf: onBehalf ? args.userId : null, inputFingerprint };
}

/** The monitor reserves once before execution; no new approval or grant is created. */
export function humanApprovalForExecution(args: ApprovalInput): Promise<VerifiedApproval | null> {
  return resolvePersistedHumanApproval(args, "execution");
}

/** A reserved or executed decision must still be valid whenever its evidence is used. */
export function humanApprovalForConsumption(args: ApprovalInput): Promise<VerifiedApproval | null> {
  return resolvePersistedHumanApproval(args, "consumption");
}
