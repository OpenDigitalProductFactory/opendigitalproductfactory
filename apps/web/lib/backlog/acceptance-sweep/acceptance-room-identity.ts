// The identity of an item's acceptance steward room (BI-C1781121, BI-099A0BA3):
// one room per item, keyed and named from the item id alone, so the sweep that
// creates it and the checks that later trust it derive the same room.

export function acceptanceRoomKey(itemId: string): string {
  return `acceptance:${itemId}`;
}

/** Stable, human-quotable room id: one room per item. */
export function acceptanceRoomCapsuleId(itemId: string): string {
  return `WC-ACC-${itemId.replace(/^BI-/i, "").toUpperCase()}`;
}

/** The Workroom source every acceptance steward room is created with. */
export const ACCEPTANCE_ROOM_SOURCE = "scheduled-steward";
