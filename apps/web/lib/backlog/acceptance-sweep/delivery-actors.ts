// Who delivered an item: every coworker that must never verify its acceptance
// (BI-099A0BA3, security review M1).
//
// The sweep used to exclude ONE "author": the newest room's assistant, else the
// claimant, else the item's agent. An agent that delivered in an older room
// could then be named the verifier once a later room was touched by someone
// else, and map its own delivery with no person involved. The rule now
// excludes the whole set, and it is re-checked where the write happens, inside
// the objective-mapping transaction (steward-objective-mapping-authority.ts).
//
// The set: every agent that created, held the lease of, or worked in (any
// role but observer, reviewer or approver; any lifecycle, so a past
// contributor counts) ANY Workroom bound to the item, live or archived, the
// Build Studio assistant for a Build Studio room, the item's claimant and the
// item's agent. The item's own acceptance steward room is not a delivery room
// and is left out. Reading is bounded; an item with more rooms than the bound
// fails closed (no verifier can be cleared), never truncates.
//
// Shared on purpose: any other path that names an acceptance owner (for
// example an execution-evidence owner) adopts this set rather than its own.

import type { Prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import { acceptanceRoomCapsuleId } from "./acceptance-room-identity";

/** Rooms read per item at most; one more fails closed. */
export const MAX_DELIVERY_ROOMS = 200;

/** Participant roles that do not deliver the work. */
const NON_DELIVERY_ROLES = new Set(["observer", "reviewer", "approver"]);

type AgentPrincipal = { kind: string; aliases: Array<{ aliasValue: string }> } | null;

type DeliveryRoom = {
  capsuleId: string;
  executorKind: string | null;
  createdByPrincipal: AgentPrincipal;
  leaseHolderPrincipal: AgentPrincipal;
  participants: Array<{ roles: string[]; principal: AgentPrincipal }>;
};

/** Exactly the reads the set needs; a Prisma client or transaction satisfies it. */
export type DeliveryActorDb = {
  backlogItem: {
    findUnique(args: unknown): Promise<{ id: string; itemId: string; claimedByAgentId: string | null; agentId: string | null } | null>;
  };
  workroom: { findMany(args: unknown): Promise<DeliveryRoom[]> };
};

const agentAlias = {
  select: { kind: true, aliases: { where: { aliasType: "agent", issuer: "" }, select: { aliasValue: true }, take: 1 } },
} as const;

function agentIdOf(principal: AgentPrincipal): string | null {
  return principal?.kind === "agent" ? principal.aliases[0]?.aliasValue ?? null : null;
}

/** Pure: the delivery-actor ids of an item's rooms and its own agent fields. */
export function deliveryActorIdsFrom(input: {
  itemId: string;
  rooms: readonly DeliveryRoom[];
  claimedByAgentId: string | null;
  agentId: string | null;
  buildStudioAgentId: string | null;
}): string[] {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => { if (id && id.trim()) ids.add(id.trim()); };
  add(input.claimedByAgentId);
  add(input.agentId);
  const stewardRoom = acceptanceRoomCapsuleId(input.itemId);
  for (const room of input.rooms) {
    if (room.capsuleId === stewardRoom) continue;
    add(agentIdOf(room.createdByPrincipal));
    add(agentIdOf(room.leaseHolderPrincipal));
    if (room.executorKind === "build-studio") add(input.buildStudioAgentId);
    for (const participant of room.participants) {
      if (participant.roles.length > 0 && participant.roles.every((role) => NON_DELIVERY_ROLES.has(role))) continue;
      add(agentIdOf(participant.principal));
    }
  }
  return [...ids].sort();
}

/**
 * Every agent that delivered `itemId`, or a failure when the item is unknown
 * or has more rooms than can be read in one bounded query.
 */
export async function loadItemDeliveryActorIds(db: DeliveryActorDb, itemId: string): Promise<ActionResult<string[]>> {
  const item = await db.backlogItem.findUnique({
    where: { itemId },
    select: { id: true, itemId: true, claimedByAgentId: true, agentId: true },
  } satisfies Prisma.BacklogItemFindUniqueArgs);
  if (!item) return err(`BacklogItem ${itemId} was not found.`);
  // A room may record the item's BI- id or its row id (Build Studio writes the row id).
  const rooms = await db.workroom.findMany({
    where: { backlogItemId: { in: [item.itemId, item.id] } },
    orderBy: { createdAt: "asc" },
    take: MAX_DELIVERY_ROOMS + 1,
    select: {
      capsuleId: true,
      executorKind: true,
      createdByPrincipal: agentAlias,
      leaseHolderPrincipal: agentAlias,
      participants: { select: { roles: true, principal: agentAlias } },
    },
  } satisfies Prisma.WorkroomFindManyArgs);
  if (rooms.length > MAX_DELIVERY_ROOMS) return err(`${itemId} has more than ${MAX_DELIVERY_ROOMS} Workrooms; its delivery actors cannot be bounded.`);
  const buildStudioAgentId = rooms.some((room) => room.executorKind === "build-studio")
    ? (await import("@/lib/backlog/initiative-readiness/build-studio-owed-routes")).BUILD_STUDIO_ASSISTANT_AGENT_ID
    : null;
  return ok(deliveryActorIdsFrom({ itemId: item.itemId, rooms, claimedByAgentId: item.claimedByAgentId, agentId: item.agentId, buildStudioAgentId }));
}
