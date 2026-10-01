// The members a room policy snapshot must keep (BI-16DA79C5).
//
// appendRoomPolicyParticipant writes an explicit policy, and an explicit policy
// restricts who may enter. So every invite carries the room's current active
// members, with action rights for those whose role acts, plus whoever created,
// requested or holds the room (the same people room access already admits).

import { prisma, type Prisma } from "@dpf/db";

import type { RoomMember } from "./room-policy";

/** Roles that may act in a room; mirrors workroom-agent-access `admitted`. */
const ACTING_ROLES = ["accountable", "coordinator", "contributor", "specialist", "approver", "reviewer"];

export async function loadRoomMembersForWorkItem(
  workItemId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<RoomMember[]> {
  const rooms = await db.workroom.findMany({
    where: { workItemId },
    select: {
      createdByPrincipalId: true,
      requestedByPrincipalId: true,
      leaseHolderPrincipalId: true,
      participants: { select: { principalId: true, lifecycle: true, roles: true, principal: { select: { principalId: true } } } },
    },
  });
  const members = new Map<string, boolean>();
  const add = (ref: string, canAct: boolean) => members.set(ref, (members.get(ref) ?? false) || canAct);
  const holderIds = new Set<string>();
  for (const room of rooms) {
    for (const p of room.participants) {
      if (p.lifecycle === "active") add(p.principal.principalId, p.roles.some((role) => ACTING_ROLES.includes(role)));
    }
    // A holder with a participant row is governed by that row (they may have left).
    const rowIds = new Set(room.participants.map((p) => p.principalId));
    for (const id of [room.createdByPrincipalId, room.requestedByPrincipalId, room.leaseHolderPrincipalId]) {
      if (id && !rowIds.has(id)) holderIds.add(id);
    }
  }
  if (holderIds.size > 0) {
    const holders = await db.principal.findMany({ where: { id: { in: [...holderIds] } }, select: { principalId: true } });
    holders.forEach((h) => add(h.principalId, true));
  }
  return [...members.entries()].map(([principalRef, canAct]) => ({ principalRef, canAct }));
}
