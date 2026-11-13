import type { Prisma } from "@dpf/db";
import { ownsRoom, resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readWorkspaceRoomPolicy } from "@/lib/work-management/workspace-room-access";
import { assertExternalSurface, databaseWallTime, lapsedLeaseLeavesRoomUnheld, readLeaseHolderKind, type HandoffRoom } from "./bounded-handoff-authority";
import { BoundedHandoffRefusal } from "./bounded-handoff-command";
import { assertBoundedHandoffDependencies } from "./bounded-handoff-dependencies";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

const fail = (code: string, message: string): never => { throw new BoundedHandoffRefusal(code, message); };

export type OwnRoomTakeover = {
  capsuleId: string; toExecutorKind: string; toExecutorRef?: string | null;
  expectedLeaseHolderPrincipalId?: string | null;
};

/**
 * BI-1986D3C1: the owner's own assistant taking over a room the owner owns.
 *
 * The two-step handover needs a live partner to acknowledge. When the previous
 * session is gone (its lease lapsed, or the chat ended) nobody is left to
 * acknowledge, so a replacement session takes the room in one call. Owner
 * direction 2026-11-04: inside the room's ownership scope that is automated;
 * outside it the owner decides. Inside scope means all of:
 *  • the caller is an authenticated assistant acting for the person, and takes
 *    the room for itself (its own external surface);
 *  • the person owns the room, and no other person holds its lease;
 *  • the assistant may act in the room, or is one nobody admitted, narrowed or
 *    removed, so the owner may hand it over (BI-821EEB18);
 *  • the room keeps the bounded-handoff boundary: no build or native task, not
 *    archived, not restricted, and no live reservation of the outgoing session
 *    on the room's own branch.
 * The consent preview and the writer's transaction run this same check.
 */
export async function assessOwnRoomTakeover(input: { db: CapsuleDb; actor: WorkCapsuleActor; takeover: OwnRoomTakeover }): Promise<HandoffRoom> {
  const { db, actor, takeover } = input;
  if (!actor.agentId || !actor.agentPrincipalId || !actor.principalId) {
    return fail("takeover-authenticated-assistant-required", "Only an authenticated assistant acting for the room's owner can take a room over without the owner's approval.");
  }
  const room = await db.workroom.findUnique({ where: { capsuleId: takeover.capsuleId } }) as HandoffRoom | null;
  if (!room) return fail("handoff-room-not-found", "The Workroom could not be found.");
  assertExternalSurface(actor.agentId, takeover.toExecutorKind);
  if (room.featureBuildId || room.taskRunId || room.archivedAt) return fail("handoff-build-boundary", "A linked build, native task or archived room requires its existing controlled handover.");
  if (room.leaseHolderPrincipalId && room.leaseHolderPrincipalId !== actor.principalId) {
    // BI-53BED66C: a platform coworker's lapsed lease leaves the room unheld.
    const now = db.$queryRaw ? await databaseWallTime(db) : new Date();
    const holderKind = await readLeaseHolderKind(db, room.leaseHolderPrincipalId, Boolean(db.$queryRaw));
    if (!lapsedLeaseLeavesRoomUnheld(room, now, actor.principalId, holderKind)) {
      return fail("takeover-other-holder", "Another person, or a coworker with a live lease, holds this room, so taking it over needs the owner's decision.");
    }
  }
  if (takeover.expectedLeaseHolderPrincipalId !== undefined && takeover.expectedLeaseHolderPrincipalId !== room.leaseHolderPrincipalId) {
    return fail("handoff-source-changed", "The room's lease holder changed. Read the room and take it over again.");
  }
  const access = await resolveAgentWorkroomAccess({ userId: actor.userId, agentId: actor.agentId, workroomId: room.id,
    requested: "action", handover: true }, db as unknown as Prisma.TransactionClient);
  const context = access.authorityContext;
  if (access.decision.level !== "action" || !context?.humanPrincipal || !context.agentPrincipal
    || context.humanPrincipal.id !== actor.principalId) {
    return fail("handoff-room-admission-required", "This assistant may not act in this room, so taking it over needs the owner's decision.");
  }
  const { room: authorityRoom } = context;
  if (!ownsRoom({ ...context.humanPrincipal, sensitivityClearance: [] }, authorityRoom.participants,
    [authorityRoom.createdByPrincipalId, authorityRoom.requestedByPrincipalId, authorityRoom.leaseHolderPrincipalId])) {
    return fail("handoff-owner-required", "Only the room's owner can have their assistant take it over.");
  }
  if ([context.sensitivityCeiling, readWorkspaceRoomPolicy(authorityRoom.workItem?.evidence).sensitivityCeiling].includes("restricted")) {
    return fail("handoff-restricted-boundary", "Restricted work retains its existing consequential handover.");
  }
  // Only the outgoing session's reservation on this room's branch can be stranded.
  if (room.executorRef && room.executorRef !== takeover.toExecutorRef) {
    await assertBoundedHandoffDependencies(db as unknown as Parameters<typeof assertBoundedHandoffDependencies>[0],
      { capsule: room, sourceExecutorRef: room.executorRef, destinationExecutorRef: room.executorRef });
  }
  return room;
}
