// BI-3C837677: room reads page by an opaque (createdAt, messageId) cursor.
// messageId is unique, so it breaks createdAt ties and no message is skipped or
// repeated across pages. Shared by read_room_messages and the room wake
// (BI-31C1FDEC), which hands a woken coworker the cursor to read from.

export type RoomMessageCursor = { createdAt: Date; messageId: string };

export function encodeRoomMessageCursor(row: { createdAt: Date; messageId: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.messageId })).toString("base64url");
}

export function decodeRoomMessageCursor(value: string): RoomMessageCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string" || parsed.id.length === 0) return null;
    const createdAt = new Date(parsed.t);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, messageId: parsed.id };
  } catch {
    return null;
  }
}
