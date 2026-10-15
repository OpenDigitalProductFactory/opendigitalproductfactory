// Room-owned cadence resolution (DI-81E47BDA59F1, BI-4CE4F52F slice 2).
//
// Split from coworker-self-tasks.ts, which was at its 800-LOC ceiling. It is
// also a genuinely separate concern: this answers "what pace do the rooms
// carrying this coworker's work declare?", which is a question about ROOMS, and
// the caller answers "what should this coworker's scheduled task do about it?".
//
// The sibling consumer of the same posture claim is
// queue/functions/workroom-drive.ts (`postureLevelOf`). Both read one
// declaration, so a room cannot drive its own turns at one pace while setting a
// different pace for the coworkers it carries.

import { prisma } from "@dpf/db";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { isProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";

// A finished room does not drive anything; reading its posture would keep a
// coworker running on the pace of work that is over.
const TERMINAL_ROOM_STATUS = new Set(["complete", "abandoned", "archived"]);
// Ordering for "most assertive wins" — both readers below rank with this one
// table so a single-agent read and the whole-fleet sweep cannot disagree.
const LEVEL_RANK: Record<string, number> = { quiet: 0, balanced: 1, assertive: 2 };

/**
 * The pace the ROOMS carrying this coworker's standing work declare.
 *
 * DI-81E47BDA59F1: cadence is room-owned. The join is
 * agentId -> PrincipalAlias(aliasType "agent") -> WorkroomParticipant -> the
 * room's posture claim, which carries a proactivityLevel in the same
 * quiet/balanced/assertive vocabulary a self-task cadence uses.
 *
 * WHEN A COWORKER SITS IN SEVERAL ROOMS it holds ONE self-task, not one per
 * room, so the levels must resolve to a single answer. The MOST ASSERTIVE wins:
 * a room that declared "Pushes" has standing work at that pace, and running the
 * coworker slower than the fastest room asked would silently under-serve that
 * room. Quiet rooms do not drag the others down; they simply do not raise it.
 *
 * Returns null when no live room carries this coworker — the case the ruling
 * flagged as open, handled by the caller.
 */
export async function roomOwnedLevelFor(agentId: string): Promise<ProactivityLevel | null> {
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "agent", aliasValue: agentId },
    select: { principalId: true },
  });
  if (!alias) return null;

  const memberships = await prisma.workroomParticipant.findMany({
    where: { principalId: alias.principalId, lifecycle: "active" },
    select: { workroom: { select: { scopeClaims: true, status: true } } },
  });

  let best: ProactivityLevel | null = null;

  for (const m of memberships) {
    const room = m.workroom;
    if (!room || TERMINAL_ROOM_STATUS.has(String(room.status))) continue;
    const declared = readWorkroomPostureClaim(room.scopeClaims)?.proactivityLevel;
    if (!declared || !isProactivityLevel(declared)) continue;
    if (best === null || LEVEL_RANK[declared]! > LEVEL_RANK[best]!) best = declared;
  }
  return best;
}

/** One coworker the live rooms can drive on their own, with no legacy fact. */
export type RoomOwnedCoworker = {
  agentId: string;
  level: ProactivityLevel;
  ownerUserId: string;
};

export type RoomOwnedEnumeration = {
  coworkers: RoomOwnedCoworker[];
  /**
   * Agents the rooms DO declare a pace for but whose owning user could not be
   * resolved. Surfaced rather than dropped: a self-task is owned by a user, so
   * an unresolvable owner is a seeding defect to report, not a coworker to
   * silently leave unscheduled.
   */
  ownerlessAgentIds: string[];
};

/**
 * Every coworker a live room can drive, derived from the ROOMS alone.
 *
 * This is the read-side half of BI-4CE4F52F slice 2. `roomOwnedLevelFor` let a
 * room OVERRIDE the pace of a coworker that already held a legacy
 * `aiCoworkerProactivity:agent:*` fact — but the sweep still ENUMERATED from
 * those facts, so a coworker with a live room and no fact row was never
 * considered at all. The facts are unwritable (BI-87C9C91C removed the control
 * and its save path), which made "has a legacy fact" an accident of history
 * that decided who could be switched on.
 *
 * Enumerating from rooms removes that gate. A coworker becomes drivable because
 * a room carries its work and declared a pace — which is what DI-81E47BDA59F1
 * ruled — not because a row survived a migration.
 *
 * MOST ASSERTIVE WINS across rooms, for the reason `roomOwnedLevelFor` gives:
 * one coworker holds ONE self-task, and running it slower than its fastest room
 * asked would under-serve that room.
 *
 * OWNER RESOLUTION is deterministic, because the owning user is part of the
 * task's identity (`coworkerSelfTaskId(agentId, userId)`) — a different owner is
 * a different task. Candidates are the rooms' requester (who commissioned the
 * work) then creator, taken in room-creation order, and the first that resolves
 * to a `user` alias wins. Oldest room first means the answer does not change as
 * newer rooms open and close.
 */
export async function enumerateRoomOwnedCoworkers(): Promise<RoomOwnedEnumeration> {
  const memberships = await prisma.workroomParticipant.findMany({
    where: { lifecycle: "active" },
    select: {
      principal: {
        select: { aliases: { where: { aliasType: "agent" }, select: { aliasValue: true } } },
      },
      workroom: {
        select: {
          status: true,
          scopeClaims: true,
          createdAt: true,
          requestedByPrincipalId: true,
          createdByPrincipalId: true,
        },
      },
    },
  });

  type Candidate = { principalId: string; roomCreatedAt: Date };
  const levelByAgent = new Map<string, ProactivityLevel>();
  const candidatesByAgent = new Map<string, Candidate[]>();

  for (const m of memberships) {
    const room = m.workroom;
    if (!room || TERMINAL_ROOM_STATUS.has(String(room.status))) continue;
    const declared = readWorkroomPostureClaim(room.scopeClaims)?.proactivityLevel;
    if (!declared || !isProactivityLevel(declared)) continue;

    // A to-many relation select can come back absent under partial mocks; treat
    // a missing alias list as "not an agent" rather than throwing mid-sweep.
    const aliases = m.principal?.aliases ?? [];
    for (const alias of aliases) {
      const agentId = alias?.aliasValue;
      if (!agentId) continue;
      const best = levelByAgent.get(agentId);
      if (best === undefined || LEVEL_RANK[declared]! > LEVEL_RANK[best]!) {
        levelByAgent.set(agentId, declared);
      }
      const owner = room.requestedByPrincipalId ?? room.createdByPrincipalId;
      if (!owner) continue;
      const list = candidatesByAgent.get(agentId) ?? [];
      list.push({ principalId: owner, roomCreatedAt: room.createdAt ?? new Date(0) });
      candidatesByAgent.set(agentId, list);
    }
  }

  if (levelByAgent.size === 0) return { coworkers: [], ownerlessAgentIds: [] };

  // One batched alias read, not one per agent — this runs hourly over the whole
  // participant set.
  const principalIds = [
    ...new Set([...candidatesByAgent.values()].flat().map((c) => c.principalId)),
  ];
  const userAliases = principalIds.length
    ? await prisma.principalAlias.findMany({
        where: { aliasType: "user", principalId: { in: principalIds } },
        select: { principalId: true, aliasValue: true },
      })
    : [];
  const userIdByPrincipal = new Map<string, string>();
  for (const a of userAliases) {
    if (a?.principalId && a.aliasValue && !userIdByPrincipal.has(a.principalId)) {
      userIdByPrincipal.set(a.principalId, a.aliasValue);
    }
  }

  const coworkers: RoomOwnedCoworker[] = [];
  const ownerlessAgentIds: string[] = [];
  for (const [agentId, level] of levelByAgent) {
    const ordered = (candidatesByAgent.get(agentId) ?? [])
      .slice()
      .sort((a, b) => a.roomCreatedAt.getTime() - b.roomCreatedAt.getTime());
    const ownerUserId = ordered
      .map((c) => userIdByPrincipal.get(c.principalId))
      .find((id): id is string => Boolean(id));
    if (!ownerUserId) {
      ownerlessAgentIds.push(agentId);
      continue;
    }
    coworkers.push({ agentId, level, ownerUserId });
  }
  return { coworkers, ownerlessAgentIds };
}
