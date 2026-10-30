// BI-8DE5429B (WWMD DI-139981F74A44): a room's outcome is the outcome of the
// backlog item it carries, read when the room is read, so it never drifts
// from the item. An explicit boundary claim still wins (room-boundary.ts);
// a room with no bound item, or whose item has no outcome yet, keeps its own
// objective.

export type RoomItemOutcomeClient = {
  backlogItem?: { findFirst?(args: unknown): Promise<{ outcome: string | null } | null> };
};

/** The bound item's outcome, or null. Bindings carry either the semantic id or the row id. */
export async function loadRoomItemOutcome(
  client: RoomItemOutcomeClient,
  backlogItemId: string | null | undefined,
): Promise<string | null> {
  const ref = backlogItemId?.trim();
  if (!ref || !client.backlogItem?.findFirst) return null;
  const item = await client.backlogItem.findFirst({
    where: { OR: [{ itemId: ref }, { id: ref }] },
    select: { outcome: true },
  });
  const outcome = item?.outcome?.trim();
  return outcome ? outcome : null;
}

/** The outcome a room shows when no boundary claim states one. */
export function roomOutcome(input: { itemOutcome: string | null; objective: string | null | undefined }): string | null {
  return input.itemOutcome ?? (input.objective?.trim() || null);
}
