import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
type Room = { title: string; backlogItemId?: string | null };
export type WorkroomTitleDb = { backlogItem?: { findMany(args: unknown): Promise<Array<{
  itemId: string; title: string; sensitivity: string; scopeKind: string | null;
  digitalProduct?: { productId: string } | null;
}>> } };

/** Resolve only generated ID labels. Human-authored room titles remain authoritative. */
export async function loadWorkroomDisplayTitles(db: WorkroomTitleDb, rooms: readonly Room[]): Promise<Map<string, string>> {
  const ids = [...new Set(rooms.flatMap(room => room.backlogItemId ? [room.backlogItemId] : []))];
  const items = ids.length && db.backlogItem ? await db.backlogItem.findMany({
    where: { itemId: { in: ids } }, select: { itemId: true, title: true, sensitivity: true, scopeKind: true,
      digitalProduct: { select: { productId: true } } }, take: ids.length,
  }) : [];
  // Area inventory metadata does not confer access to private request content.
  // Only publicly classified request names enrich generated room labels.
  return new Map(items.filter(item => effectiveBacklogSensitivity({ ...item,
    digitalProductId: item.digitalProduct?.productId ?? null }) === "public")
    .map(item => [item.itemId, item.title]));
}

export function workroomDisplayTitle(room: Room, titles: ReadonlyMap<string, string>): string {
  if (!room.backlogItemId) return room.title;
  const title = titles.get(room.backlogItemId);
  if (room.title === `Work on ${room.backlogItemId}`) return title || "Request name unavailable";
  if (room.title === `Acceptance: ${room.backlogItemId}`) return title ? `Verify: ${title}` : "Verification request name unavailable";
  return room.title;
}
