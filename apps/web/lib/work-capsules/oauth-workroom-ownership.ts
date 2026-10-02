import type { WorkCapsuleActor } from "./work-capsule-store-types";
import type { HandoverRefusal } from "@/lib/work-management/workroom-agent-access.server";
import type { WorkCapsuleExecutorKind } from "@/lib/work-capsules";
import { isExternalLeaseExecutor, leaseUntil } from "./work-capsule-branch-identity";

/** Creation and adoption persist the same human/assistant relationship. */
export function workroomOwnershipData(actor: WorkCapsuleActor, executor: WorkCapsuleExecutorKind | null | undefined, now: Date, requester?: string | null) {
  return {
    leaseHolderPrincipalId: isExternalLeaseExecutor(executor) ? actor.principalId : null,
    leaseExpiresAt: isExternalLeaseExecutor(executor) ? leaseUntil(now) : null,
    createdByPrincipalId: actor.agentPrincipalId ?? actor.principalId,
    requestedByPrincipalId: actor.agentPrincipalId ? actor.principalId : requester ?? null,
  };
}

type Ownership = { leaseHolderPrincipalId?: string | null; createdByPrincipalId?: string | null; requestedByPrincipalId?: string | null };
export function assertOAuthWorkroomOwner(room: Ownership, actor: WorkCapsuleActor): void {
  if (!actor.agentPrincipalId) return;
  if (!actor.principalId || ![room.leaseHolderPrincipalId, room.createdByPrincipalId, room.requestedByPrincipalId].includes(actor.principalId)) {
    throw new Error("You are not authorized to change this workroom. Ask its owner to give you access.");
  }
}

/** The one call through which a person hands their own room to a new assistant (BI-821EEB18). */
export const WORKROOM_HANDOVER_TOOL = "reassign_workroom_executor";

/** Runs at governed dispatch, before a tool can write evidence or renew a lease. */
type OAuthCapsuleTarget = {
  params: Record<string, unknown>; userId: string; agentId?: string; authSource?: string; action: boolean; toolName?: string;
};

/**
 * The person owns the room but this assistant has never worked in it, which is
 * what a replacement session looks like. Name the handover instead of sending
 * the assistant to "ask the owner", who is the person it acts for.
 */
function assistantNotAdmitted(capsuleId: string, toExecutorKind: WorkCapsuleExecutorKind) {
  return {
    success: false as const,
    error: "workroom_assistant_not_admitted",
    message:
      "The person you act for owns this workroom, but you have not been admitted to it. " +
      `Take it over with ${WORKROOM_HANDOVER_TOOL} (the exact call is in data.handover). They may be asked to approve it, unless an operator has already graduated you for this kind of action. ` +
      "After that, get_workroom shows where the work stands and what to do next.",
    data: {
      handover: {
        tool: WORKROOM_HANDOVER_TOOL,
        arguments: {
          capsuleId,
          toExecutorKind,
          reason: "A new assistant is taking over this work for the room's owner.",
        },
      },
    },
  };
}
type HandoverAccess = { decision: { level: string; reason?: string }; handoverRefusal?: HandoverRefusal };

/**
 * The person is in the room but cannot hand it to this assistant. Say which
 * rule refused it and the supported way forward, so nobody is asked to approve
 * a handover that cannot run (BI-F4EB23C1). Neither recovery grants anything
 * by itself: the owner acts, or the assistant reconnects as the owner.
 */
function handoverRefused(refusal: HandoverRefusal) {
  return refusal === "not-owner"
    ? { success: false as const, error: "workroom_handover_not_owner",
        message: "The account your assistant is connected as can see this workroom but does not own it: another person coordinates it. "
          + "Only the room's owner can hand it to an assistant, so approving a handover from this account cannot work. "
          + "Either connect your assistant while signed in as the room's owner and ask again, or ask the owner to invite this assistant to the room." }
    : { success: false as const, error: "workroom_handover_assistant_in_room",
        message: "This assistant was removed from this workroom or limited to observing it, so it cannot take the room over. "
          + "Only the room's owner can give it back the access it had, from the room's participants." };
}

export async function workroomTargetAccessRefusal(input: OAuthCapsuleTarget) {
  if (input.authSource !== "oauth" || typeof input.params.capsuleId !== "string") return null;
  const notAdmitted = { success: false as const, error: "workroom_access_denied",
    message: "You or your assistant are not admitted to this workroom. Ask its owner to invite you." };
  const { prisma } = await import("@dpf/db");
  const room = await prisma.workroom.findUnique({ where: { capsuleId: input.params.capsuleId }, select: { id: true } });
  if (!room || !input.agentId) return notAdmitted;
  const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  const requested = input.action ? "action" : "content";
  const handover = input.toolName === WORKROOM_HANDOVER_TOOL;
  const access = (asHandover: boolean): Promise<HandoverAccess> => resolveAgentWorkroomAccess({
    userId: input.userId, agentId: input.agentId!, workroomId: room.id,
    requested: asHandover ? "action" : requested, handover: asHandover,
  });
  const first = await access(handover);
  const { decision } = first;
  if (decision.level === requested) return null;
  if (decision.reason === "insufficient-clearance") return {
    success: false as const, error: "workroom_data_access_required",
    message: "You or your assistant cannot use this workroom's information. Ask an administrator to review data access in AI Coworker Identity. Signing in again will not change this permission.",
    data: { recoveryUrl: "/platform/identity/agents" },
  };
  const asHandover = handover ? first : await access(true);
  if (!handover && asHandover.decision.level === "action") {
    const { providerToExecutorKind } = await import("./external-session-capture");
    return assistantNotAdmitted(input.params.capsuleId, providerToExecutorKind(input.agentId));
  }
  return asHandover.handoverRefusal ? handoverRefused(asHandover.handoverRefusal) : notAdmitted;
}

export async function authorizeOAuthCapsuleTarget(input: OAuthCapsuleTarget): Promise<boolean> {
  return await workroomTargetAccessRefusal(input) === null;
}
