import "server-only";

// EP-WORK-POSTURE §8.2 — the I/O half of room-turn-authority.ts. Loads the
// room the turn runs in, the coworker's standing grants and the decreed
// platform room default, then hands them to the pure deriver. Nothing here
// decides anything.
//
// Fail-closed on the room, fail-open on nothing: if the room cannot be loaded
// the turn is UNROOMED (platform default, deny-by-default), never "roomed with
// whatever we could guess".
import { prisma } from "@dpf/db";

import { getAgentToolGrantsAsync } from "@/lib/tak/agent-grants";
import { shapeBiasFor } from "@/lib/work-posture/derive";

import { getWorkShape } from "./work-shapes";
import { readDeclaredWorkShapeKey } from "./work-shapes";
import { readWorkroomPostureClaim } from "./workroom-posture-claim";
import { readWorkroomShapeClaim } from "./workroom-shape-claim";
import { getWorkroomPostureDefault } from "./workroom-posture-defaults";
import {
  deriveRoomTurnAuthority,
  workroomIdFromRoute,
  type RoomTurnAuthority,
  type RoomTurnAuthorityFacts,
} from "./room-turn-authority";

export type RoomTurnAuthorityDb = {
  workroom: {
    findFirst(args: unknown): Promise<{
      id: string;
      capsuleId: string;
      scopeClaims: unknown;
      participants?: Array<{ principalId: string; roles: string[] }>;
    } | null>;
  };
  principalAlias: {
    findFirst(args: unknown): Promise<{ principalId: string } | null>;
  };
};

async function loadRoomFacts(
  capsuleId: string,
  agentId: string,
  db: RoomTurnAuthorityDb,
): Promise<RoomTurnAuthorityFacts["room"]> {
  const [room, alias] = await Promise.all([
    db.workroom.findFirst({
      where: { OR: [{ capsuleId }, { id: capsuleId }] },
      select: {
        id: true,
        capsuleId: true,
        scopeClaims: true,
        participants: {
          where: { lifecycle: "active" },
          select: { principalId: true, roles: true },
        },
      },
    }),
    // The coworker's Principal ROW id (WorkroomParticipant.principalId is the
    // row id, not the semantic principalId) via its internal agent alias.
    db.principalAlias
      .findFirst({
        where: { aliasType: "agent", aliasValue: agentId, issuer: "" },
        select: { principalId: true },
      })
      .catch(() => null),
  ]);
  if (!room) return null;
  const collaborationShape = readWorkroomShapeClaim(room.scopeClaims);
  const workShapeKey = readDeclaredWorkShapeKey(room.scopeClaims);
  const workShape = workShapeKey ? getWorkShape(workShapeKey) : null;
  const declaration = readWorkroomPostureClaim(room.scopeClaims);
  return {
    workroomId: room.capsuleId,
    collaborationShape,
    workShapeKey,
    workShapeGrants: workShape ? workShape.grants : null,
    declaredActionBoundary: declaration?.actionBoundary ?? null,
    declaredPriority: declaration?.priority ?? null,
    shapeActionBoundary: shapeBiasFor(collaborationShape)?.actionBoundary ?? null,
    participants: room.participants?.length ? room.participants : null,
    agentPrincipalId: alias?.principalId ?? null,
  };
}

/**
 * Resolve what THIS turn may do, from the room it runs in. `capsuleId` is the
 * Workroom the composer resolved from the route/portal context (null when the
 * page has no room). The coworker's grants are read DB-first exactly as the
 * tool surface does, so the two never disagree.
 */
export async function loadRoomTurnAuthority(input: {
  agentId: string;
  /** The Workroom the portal envelope resolved, when it resolved one. */
  capsuleId?: string | null;
  /** Fallback: a /build/work/<capsuleId> route names the room directly. */
  routeContext?: string | null;
  db?: RoomTurnAuthorityDb;
}): Promise<RoomTurnAuthority> {
  const db = input.db ?? (prisma as unknown as RoomTurnAuthorityDb);
  const capsuleId = input.capsuleId ?? workroomIdFromRoute(input.routeContext);
  const [agentGrants, room, platformDefault] = await Promise.all([
    getAgentToolGrantsAsync(input.agentId).catch(() => [] as string[]),
    capsuleId ? loadRoomFacts(capsuleId, input.agentId, db).catch(() => null) : Promise.resolve(null),
    getWorkroomPostureDefault().catch(() => null),
  ]);
  return deriveRoomTurnAuthority({
    room,
    agentGrants,
    platformDefaultActionBoundary: platformDefault?.actionBoundary ?? null,
  });
}
