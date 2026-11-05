// Semantic review routing sensitivity comes from the reviewed Workroom
// (BI-9F620FE1, DI-AF686F829ADE).
//
// Founder direction, 2026-11-05: "The workroom dictates the type of work." and
// "Dev work is 100% public." The room's own sensitivity is already resolved
// by resolveRoomSensitivityCeiling: a declared boundary ceiling, otherwise the
// backlog item's effective sensitivity, where platform work reads public
// (DI-5E19848444FC), otherwise the fail-closed `internal`. A public room routes
// as "development" (code clearance), exactly as Build Studio's code turns do;
// any other ceiling passes through. Payload screening still runs on every
// review, so a secret, personal record or financial identifier inside a
// platform diff is still classified and kept local.

export type SemanticReviewRouteSensitivity = "development" | "internal" | "confidential" | "restricted";

/** Map a room's sensitivity ceiling to the sensitivity a review declares. */
export function semanticReviewRouteSensitivity(roomCeiling: string | null | undefined): SemanticReviewRouteSensitivity {
  switch (roomCeiling) {
    case "public": return "development";
    case "confidential":
    case "restricted": return roomCeiling;
    default: return "internal";
  }
}

type RoomRow = { scopeClaims: unknown; backlogItemId: string | null };
export type SemanticReviewRoomDeps = {
  readRoom?: (capsuleId: string) => Promise<RoomRow | null>;
  ceiling?: (room: RoomRow) => Promise<string>;
};

/** The reviewed room's routing sensitivity; anything unreadable is `internal`. */
export async function resolveSemanticReviewRoomSensitivity(
  capsuleId: string | undefined,
  deps: SemanticReviewRoomDeps = {},
): Promise<SemanticReviewRouteSensitivity> {
  if (!capsuleId) return "internal";
  try {
    const room = await (deps.readRoom ?? readRoom)(capsuleId);
    if (!room) return "internal";
    return semanticReviewRouteSensitivity(await (deps.ceiling ?? roomCeiling)(room));
  } catch {
    return "internal";
  }
}

// Imported lazily so importing the dispatcher does not construct the database client.
async function readRoom(capsuleId: string): Promise<RoomRow | null> {
  const { prisma } = await import("@dpf/db");
  return prisma.workroom.findUnique({ where: { capsuleId }, select: { scopeClaims: true, backlogItemId: true } });
}

async function roomCeiling(room: RoomRow): Promise<string> {
  const { resolveRoomSensitivityCeiling } = await import("@/lib/work-management/room-sensitivity-ceiling.server");
  return resolveRoomSensitivityCeiling(room);
}
