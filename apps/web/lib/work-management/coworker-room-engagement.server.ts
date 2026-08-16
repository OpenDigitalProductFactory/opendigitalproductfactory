/**
 * 360 coworker-utilization read model (EP-WORKROOM-COMMS, BI-3EDEA0D8).
 *
 * Inverts the per-room participant view into a per-coworker rollup: for an AI
 * coworker, which Work Rooms it is actively engaged in right now, its role in each
 * (incl. Coordinator), so an operator can manage coworker use across rooms and
 * recognise routine engagement patterns. Presence-scoped ("active workrooms").
 *
 * Server-only. Refs are canonical Principal.principalId (PRN).
 * Design of record: docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §2
 */
import { prisma } from "@dpf/db";

import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import type { WorkroomParticipantRole } from "./room-types";
import { PRESENCE_ACTIVE_WINDOW_MS } from "./work-item-presence";
import { encodeWorkCaseKey } from "./workspace-case-loader";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

export interface CoworkerRoomEngagementRoom {
  caseKey: string;
  roles: WorkroomParticipantRole[];
  coordinator: boolean;
  activeNow: boolean;
}

export interface CoworkerRoomEngagement {
  agentId: string;
  principalRef: string | null;
  activeRoomCount: number;
  rooms: CoworkerRoomEngagementRoom[];
}

/**
 * Resolve which active Work Rooms a coworker is currently engaged in, and its role
 * in each. Empty when the coworker has no live presence in any room.
 */
export async function getCoworkerRoomEngagement(input: {
  agentId: string;
  now?: Date;
}): Promise<CoworkerRoomEngagement> {
  const principal = await ensureAgentPrincipalIdentity(input.agentId);
  const principalRef = principal?.principalId ?? null;
  if (!principalRef) {
    return { agentId: input.agentId, principalRef: null, activeRoomCount: 0, rooms: [] };
  }

  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - PRESENCE_ACTIVE_WINDOW_MS);
  const presence = await prisma.workItemPresence.findMany({
    where: { principalType: "agent", principalId: principalRef, lastSeenAt: { gte: cutoff } },
    select: { workItemId: true },
  });
  if (presence.length === 0) {
    return { agentId: input.agentId, principalRef, activeRoomCount: 0, rooms: [] };
  }

  const workItemIds = [...new Set(presence.map((row) => row.workItemId))];
  const items = await prisma.workItem.findMany({
    where: { id: { in: workItemIds } },
    select: { id: true, itemId: true, sourceType: true, sourceId: true, evidence: true },
  });

  const rooms: CoworkerRoomEngagementRoom[] = items.map((item) => {
    const policy = readWorkspaceRoomPolicy(item.evidence);
    const mine = (policy.participants ?? []).find((participant) => participant.principalRef === principalRef);
    const roles = (mine?.roles ?? []) as WorkroomParticipantRole[];
    return {
      caseKey: encodeWorkCaseKey({ sourceType: item.sourceType, sourceId: item.sourceId ?? item.itemId }),
      roles,
      coordinator: roles.includes("coordinator"),
      activeNow: true,
    };
  });

  return { agentId: input.agentId, principalRef, activeRoomCount: rooms.length, rooms };
}
