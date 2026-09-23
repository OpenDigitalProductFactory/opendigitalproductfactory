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

  // A finished room does not drive anything; reading its posture would keep a
  // coworker running on the pace of work that is over.
  const TERMINAL = new Set(["complete", "abandoned", "archived"]);
  const RANK: Record<string, number> = { quiet: 0, balanced: 1, assertive: 2 };
  let best: ProactivityLevel | null = null;

  for (const m of memberships) {
    const room = m.workroom;
    if (!room || TERMINAL.has(String(room.status))) continue;
    const declared = readWorkroomPostureClaim(room.scopeClaims)?.proactivityLevel;
    if (!declared || !isProactivityLevel(declared)) continue;
    if (best === null || RANK[declared]! > RANK[best]!) best = declared;
  }
  return best;
}
