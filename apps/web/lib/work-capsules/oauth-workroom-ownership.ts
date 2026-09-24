import type { WorkCapsuleActor } from "./work-capsule-store-types";
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
      `Take it over with ${WORKROOM_HANDOVER_TOOL} (the exact call is in data.handover); they will be asked to approve it. ` +
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
  const access = (asHandover: boolean) => resolveAgentWorkroomAccess({
    userId: input.userId, agentId: input.agentId!, workroomId: room.id,
    requested: asHandover ? "action" : requested, handover: asHandover,
  });
  const { decision } = await access(handover);
  if (decision.level === requested) return null;
  if (decision.reason === "insufficient-clearance") return {
    success: false as const, error: "workroom_data_access_required",
    message: "You or your assistant cannot use this workroom's information. Ask an administrator to review data access in AI Coworker Identity. Signing in again will not change this permission.",
    data: { recoveryUrl: "/platform/identity/agents" },
  };
  if (!handover && (await access(true)).decision.level === "action") {
    const { providerToExecutorKind } = await import("./external-session-capture");
    return assistantNotAdmitted(input.params.capsuleId, providerToExecutorKind(input.agentId));
  }
  return notAdmitted;
}

export async function authorizeOAuthCapsuleTarget(input: OAuthCapsuleTarget): Promise<boolean> {
  return await workroomTargetAccessRefusal(input) === null;
}
