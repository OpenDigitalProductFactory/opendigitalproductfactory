// BI-31E0C874 (agent dialog broker B2b, design 2026-11-11-room-read-cursor):
// what a room reader has not yet been handed. Pure: the server module loads the
// rows and the stored position, and moves the position by compare-and-set.
//
// "For me" is a message addressed to the room (no addressing), to this agent,
// to a role it holds, or to a session of its own GAID, that it did not send.

import { readRoomMessageAddressing, type RoomAddressRole } from "./room-message-addressing";
import type { RoomMessageCursor } from "./room-message-cursor";

/** How many messages one unread read considers. Bounds a read in a room full of other agents' traffic. */
export const ROOM_UNREAD_SCAN_WINDOW = 200;

export interface RoomReader {
  agentId: string;
  gaid: string | null;
  /** Roles this reader holds on a live Workroom of the room. */
  roles: ReadonlyArray<RoomAddressRole>;
}

export interface RoomUnreadCandidate {
  createdAt: Date;
  messageId: string;
  senderAgentId: string | null;
  structuredPayload: unknown;
}

/** Order two positions as the paging cursor does: createdAt, then messageId. */
export function compareRoomMessagePosition(a: RoomMessageCursor, b: RoomMessageCursor): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0;
}

export function isRoomMessageForReader(
  message: Pick<RoomUnreadCandidate, "senderAgentId" | "structuredPayload">,
  reader: RoomReader,
): boolean {
  if (message.senderAgentId === reader.agentId) return false;
  const addressing = readRoomMessageAddressing(message.structuredPayload);
  if (!addressing) return true;
  if (addressing.agents.includes(reader.agentId)) return true;
  if (addressing.roles.some((role) => reader.roles.includes(role))) return true;
  if (reader.gaid && addressing.sessions.some((session) => session.split("#")[0] === reader.gaid)) return true;
  return false;
}

export interface UnreadPage<T extends RoomUnreadCandidate> {
  delivered: T[];
  /** The last message considered. The cursor moves here, so messages for others never stall a reader. */
  consumed: RoomMessageCursor | null;
  hasMore: boolean;
}

/**
 * Pick one page from messages past the reader's position, oldest first.
 * `fetched` may hold one row beyond the scan window, which only says more remain.
 * The page stops before a message for the reader that would overflow `limit`,
 * so that message is the first one the next read returns.
 */
export function planUnreadPage<T extends RoomUnreadCandidate>(
  fetched: ReadonlyArray<T>,
  reader: RoomReader,
  limit: number,
  scanWindow = ROOM_UNREAD_SCAN_WINDOW,
): UnreadPage<T> {
  const window = fetched.slice(0, scanWindow);
  const delivered: T[] = [];
  let consumed: RoomMessageCursor | null = null;
  let index = 0;
  for (; index < window.length; index += 1) {
    const row = window[index]!;
    if (isRoomMessageForReader(row, reader)) {
      if (delivered.length >= limit) break;
      delivered.push(row);
    }
    consumed = { createdAt: row.createdAt, messageId: row.messageId };
  }
  return { delivered, consumed, hasMore: index < window.length || fetched.length > scanWindow };
}
