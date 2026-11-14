import type { WorkPortfolioRoleKey } from "@/lib/navigation/area-portfolio";
import { loadCapsuleLivenessInventory, type InventoryDb } from "@/lib/work-capsules/liveness-inventory";
import { readDeclaredWorkShapeKey } from "@/lib/work-management/work-shapes";
import { loadRoomAccountabilityBatch, type RoomWorkforceDb } from "@/lib/work-management/room-workforce.server";
import {
  ATLAS_ROOM_READ_LIMIT,
  projectAtlas,
  type AtlasInventoryRoom,
  type AtlasPicture,
} from "@/lib/work-management/atlas-projection";

type AtlasDb = InventoryDb & RoomWorkforceDb;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The one Atlas read (BI-7ACC31F9): every non-archived workroom, through the
 * same liveness inventory and accountability batch the Work in progress page
 * uses. Reads one row past the limit so the picture can say it was truncated.
 */
export async function loadAtlasPicture(
  db: AtlasDb,
  options: { portfolioRole?: WorkPortfolioRoleKey; limit?: number; now?: Date } = {},
): Promise<AtlasPicture> {
  const limit = options.limit ?? ATLAS_ROOM_READ_LIMIT;
  const inventory = await loadCapsuleLivenessInventory(db, {
    where: { archivedAt: null, ...(options.portfolioRole ? { portfolioRole: options.portfolioRole } : {}) },
    take: limit + 1,
    portalSummary: true,
  });
  // The portal inventory leaves scope claims out, so the declared shape is one
  // bounded read keyed by the rooms already read, never one query per room.
  const read = inventory.capsulesAll.slice(0, limit).map((room) => String(room.capsuleId));
  const claims = read.length && db.workroom
    ? await db.workroom.findMany({ where: { capsuleId: { in: read } }, select: { capsuleId: true, scopeClaims: true } }).catch(() => [])
    : [];
  const shapeById = new Map(claims.map((row: { capsuleId: string; scopeClaims: unknown }) =>
    [row.capsuleId, readDeclaredWorkShapeKey(row.scopeClaims)] as const));
  const rooms: AtlasInventoryRoom[] = inventory.capsulesAll.map((room) => {
    const drive = room.drive as { action: string | null; reason: string | null; attentionRecorded?: boolean; stageKey?: string | null } | undefined;
    return {
      capsuleId: String(room.capsuleId),
      title: String(room.title ?? room.capsuleId),
      status: String(room.status),
      liveness: String(room.liveness),
      isLive: room.isLive === true,
      portfolioRole: str(room.portfolioRole),
      trueLivenessAt: str(room.trueLivenessAt),
      drive: drive ? { action: drive.action, reason: drive.reason, attentionRecorded: drive.attentionRecorded } : null,
      stageKey: str(drive?.stageKey),
      shapeKey: shapeById.get(String(room.capsuleId)) ?? null,
    };
  });
  const rowIds = inventory.capsulesAll.slice(0, limit).flatMap((room) => typeof room.id === "string" ? [room.id] : []);
  const ownersById = await loadRoomAccountabilityBatch(db, rowIds);
  const owners = new Map(inventory.capsulesAll.slice(0, limit).flatMap((room) => {
    const owner = typeof room.id === "string" ? ownersById.get(room.id) : undefined;
    return owner ? [[String(room.capsuleId), owner] as const] : [];
  }));
  return projectAtlas({ rooms, owners, limit, observedAt: options.now ?? new Date() });
}
