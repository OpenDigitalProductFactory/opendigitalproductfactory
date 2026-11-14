// BI-31E0C874 (agent dialog broker B2b, design 2026-11-11-room-read-cursor §3–§5):
// each room participant's read position, kept on its WorkItemPresence row for
// the room. A room outlives its Workrooms, so the position belongs to the room's
// work item, not to one claim of it.
//
// The position is the authority of record (broker spec §6.1): every wake, push
// or supervised turn only makes a reader look sooner; an "unread for me" read
// returns what it has not yet been handed and moves the position forward.

import { ROOM_ADDRESS_ROLES, type RoomAddressRole } from "./room-message-addressing";
import type { RoomMessageCursor } from "./room-message-cursor";
import {
  ROOM_UNREAD_SCAN_WINDOW,
  planUnreadPage,
  type RoomReader,
  type RoomUnreadCandidate,
} from "./room-read-cursor";

// Structural: the server passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const CLOSED_ROOM_STATUSES = ["abandoned", "archived"];
const COMPARE_AND_SET_ATTEMPTS = 3;

export type RoomPrincipalType = "agent" | "user";

export interface RoomPresenceKey {
  workItemId: string;
  principalType: RoomPrincipalType;
  principalId: string;
}

async function defaultDb(): Promise<Db> {
  return (await import("@dpf/db")).prisma;
}

function presenceWhere(key: RoomPresenceKey) {
  return {
    workItemId_principalType_principalId: {
      workItemId: key.workItemId,
      principalType: key.principalType,
      principalId: key.principalId,
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

/** The stored position, and whether the presence row exists at all. */
export async function loadStoredRoomReadCursor(
  key: RoomPresenceKey,
  db?: Db,
): Promise<{ exists: boolean; cursor: RoomMessageCursor | null }> {
  const client = db ?? await defaultDb();
  const row: { readCursorAt: Date | null; readCursorMessageId: string | null } | null = await client.workItemPresence.findUnique({
    where: presenceWhere(key),
    select: { readCursorAt: true, readCursorMessageId: true },
  });
  if (!row) return { exists: false, cursor: null };
  return {
    exists: true,
    cursor: row.readCursorAt && row.readCursorMessageId
      ? { createdAt: row.readCursorAt, messageId: row.readCursorMessageId }
      : null,
  };
}

function strictlyAfter(cursor: RoomMessageCursor) {
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, messageId: { gt: cursor.messageId } },
    ],
  };
}

/**
 * Move a reader's position forward to `to`, never back. A channel that hands
 * message text to a reader (a supervised turn, item D) calls this with the
 * newest message it handed over. Creates the presence row when there is none.
 * Returns whether the stored position moved.
 */
export async function advanceRoomReadCursor(
  args: RoomPresenceKey & { to: RoomMessageCursor; label?: string | null },
  db?: Db,
): Promise<boolean> {
  const client = db ?? await defaultDb();
  const data = { readCursorAt: args.to.createdAt, readCursorMessageId: args.to.messageId };
  const existing = await loadStoredRoomReadCursor(args, client);
  if (!existing.exists) {
    try {
      await client.workItemPresence.create({
        data: {
          workItemId: args.workItemId,
          principalType: args.principalType,
          principalId: args.principalId,
          displayLabel: args.label?.trim() || null,
          ...data,
        },
      });
      return true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  const moved: { count: number } = await client.workItemPresence.updateMany({
    where: {
      workItemId: args.workItemId,
      principalType: args.principalType,
      principalId: args.principalId,
      OR: [
        { readCursorAt: null },
        { readCursorAt: { lt: args.to.createdAt } },
        { readCursorAt: args.to.createdAt, readCursorMessageId: { lt: args.to.messageId } },
      ],
    },
    data,
  });
  return moved.count > 0;
}

/** Roles this principal holds on the room's live Workrooms, for role-addressed messages. */
async function loadReaderRoles(db: Db, workItemId: string, principalId: string): Promise<RoomAddressRole[]> {
  const rows: Array<{ roles: string[] }> = await db.workroomParticipant.findMany({
    where: {
      lifecycle: "active",
      principal: { principalId },
      workroom: { workItemId, archivedAt: null, status: { notIn: CLOSED_ROOM_STATUSES } },
    },
    select: { roles: true },
  });
  const held = new Set(rows.flatMap((row) => row.roles));
  return ROOM_ADDRESS_ROLES.filter((role) => held.has(role));
}

const UNREAD_SELECT = {
  messageId: true,
  senderType: true,
  senderUserId: true,
  senderAgentId: true,
  messageType: true,
  body: true,
  createdAt: true,
  structuredPayload: true,
} as const;

export type UnreadRoomMessage = RoomUnreadCandidate & {
  senderType: string;
  senderUserId: string | null;
  messageType: string;
  body: string;
};

export type UnreadRoomReadResult =
  | { ok: true; messages: UnreadRoomMessage[]; hasMore: boolean; readCursor: RoomMessageCursor | null }
  | { ok: false; reason: "conflict" };

/**
 * The "unread for me" read (design §4). Starts at the stored position, else
 * at the reader's own newest post in the room, else at the start. Returns, oldest
 * first, the messages for this reader, and moves the position by compare-and-set
 * to the last message considered: a concurrent read that moved it first makes
 * this one start again, so no successful read returns a message twice.
 */
export async function readUnreadRoomMessages(
  args: {
    /** The room's own work item: the position is kept against it. */
    roomWorkItemId: string;
    /** The room and the child rooms this reader is admitted to. */
    workItemIds: string[];
    agentId: string;
    principalId: string;
    gaid: string | null;
    limit: number;
    label?: string | null;
  },
  db?: Db,
): Promise<UnreadRoomReadResult> {
  const client = db ?? await defaultDb();
  const key: RoomPresenceKey = { workItemId: args.roomWorkItemId, principalType: "agent", principalId: args.principalId };
  const reader: RoomReader = {
    agentId: args.agentId,
    gaid: args.gaid,
    roles: await loadReaderRoles(client, args.roomWorkItemId, args.principalId),
  };

  for (let attempt = 0; attempt < COMPARE_AND_SET_ATTEMPTS; attempt += 1) {
    const stored = await loadStoredRoomReadCursor(key, client);
    let start = stored.cursor;
    if (!start) {
      const ownLast: { createdAt: Date; messageId: string } | null = await client.workItemMessage.findFirst({
        where: { workItemId: { in: args.workItemIds }, senderAgentId: args.agentId },
        orderBy: [{ createdAt: "desc" }, { messageId: "desc" }],
        select: { createdAt: true, messageId: true },
      });
      start = ownLast ? { createdAt: ownLast.createdAt, messageId: ownLast.messageId } : null;
    }

    const fetched: UnreadRoomMessage[] = await client.workItemMessage.findMany({
      where: { workItemId: { in: args.workItemIds }, ...(start ? strictlyAfter(start) : {}) },
      orderBy: [{ createdAt: "asc" }, { messageId: "asc" }],
      take: ROOM_UNREAD_SCAN_WINDOW + 1,
      select: UNREAD_SELECT,
    });
    const page = planUnreadPage(fetched, reader, args.limit);
    if (!page.consumed) return { ok: true, messages: [], hasMore: false, readCursor: start };

    const next = { readCursorAt: page.consumed.createdAt, readCursorMessageId: page.consumed.messageId };
    if (!stored.exists) {
      try {
        await client.workItemPresence.create({
          data: { ...key, displayLabel: args.label?.trim() || null, ...next },
        });
        return { ok: true, messages: page.delivered, hasMore: page.hasMore, readCursor: page.consumed };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        continue;
      }
    }
    const swapped: { count: number } = await client.workItemPresence.updateMany({
      where: {
        workItemId: key.workItemId,
        principalType: key.principalType,
        principalId: key.principalId,
        readCursorAt: stored.cursor?.createdAt ?? null,
        readCursorMessageId: stored.cursor?.messageId ?? null,
      },
      data: next,
    });
    if (swapped.count === 1) {
      return { ok: true, messages: page.delivered, hasMore: page.hasMore, readCursor: page.consumed };
    }
  }
  return { ok: false, reason: "conflict" };
}
