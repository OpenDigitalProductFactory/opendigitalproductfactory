type Room = { title: string; backlogItemId?: string | null };
type Db = { backlogItem?: { findMany(args: unknown): Promise<Array<{ itemId: string; title: string }>> } };

/** Resolve only generated ID labels. Human-authored room titles remain authoritative. */
export async function loadWorkroomDisplayTitles(db: Db, rooms: readonly Room[]): Promise<Map<string, string>> {
  const ids = [...new Set(rooms.flatMap(room => room.backlogItemId ? [room.backlogItemId] : []))];
  const items = ids.length && db.backlogItem ? await db.backlogItem.findMany({
    where: { itemId: { in: ids } }, select: { itemId: true, title: true }, take: ids.length,
  }) : [];
  return new Map(items.map(item => [item.itemId, item.title]));
}

export function workroomDisplayTitle(room: Room, titles: ReadonlyMap<string, string>): string {
  if (!room.backlogItemId) return room.title;
  const title = titles.get(room.backlogItemId);
  if (room.title === `Work on ${room.backlogItemId}`) return title || "Request name unavailable";
  if (room.title === `Acceptance: ${room.backlogItemId}`) return title ? `Verify: ${title}` : "Verification request name unavailable";
  return room.title;
}
