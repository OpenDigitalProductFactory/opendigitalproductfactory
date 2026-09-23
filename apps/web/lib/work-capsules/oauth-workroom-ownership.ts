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

/** Runs at governed dispatch, before a tool can write evidence or renew a lease. */
type OAuthCapsuleTarget = {
  params: Record<string, unknown>; userId: string; agentId?: string; authSource?: string; action: boolean;
};
export async function workroomTargetAccessRefusal(input: OAuthCapsuleTarget) {
  if (input.authSource !== "oauth" || typeof input.params.capsuleId !== "string") return null;
  const notAdmitted = { success: false as const, error: "workroom_access_denied",
    message: "You or your assistant are not admitted to this workroom. Ask its owner to invite you." };
  const { prisma } = await import("@dpf/db");
  const room = await prisma.workroom.findUnique({ where: { capsuleId: input.params.capsuleId }, select: { id: true } });
  if (!room || !input.agentId) return notAdmitted;
  const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  const requested = input.action ? "action" : "content";
  const { decision } = await resolveAgentWorkroomAccess({ userId: input.userId, agentId: input.agentId, workroomId: room.id, requested });
  if (decision.level === requested) return null;
  return decision.reason === "insufficient-clearance" ? {
    success: false as const, error: "workroom_data_access_required",
    message: "You or your assistant cannot use this workroom's information. Ask an administrator to review data access in AI Coworker Identity. Signing in again will not change this permission.",
    data: { recoveryUrl: "/platform/identity/agents" },
  } : notAdmitted;
}

export async function authorizeOAuthCapsuleTarget(input: OAuthCapsuleTarget): Promise<boolean> {
  return await workroomTargetAccessRefusal(input) === null;
}
