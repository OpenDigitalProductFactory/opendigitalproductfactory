import { describe, expect, it, vi } from "vitest";

import type { RoomMessageAddressing } from "./room-message-addressing";
import type { RoomMessageCursor } from "./room-message-cursor";
import { advanceRoomReadCursor, loadStoredRoomReadCursor, readUnreadRoomMessages } from "./room-read-cursor.server";

type Msg = {
  messageId: string;
  workItemId: string;
  senderType: string;
  senderUserId: string | null;
  senderAgentId: string | null;
  messageType: string;
  body: string;
  createdAt: Date;
  structuredPayload: unknown;
};

type Presence = {
  workItemId: string;
  principalType: string;
  principalId: string;
  displayLabel: string | null;
  readCursorAt: Date | null;
  readCursorMessageId: string | null;
};

const BASE = Date.UTC(2026, 10, 11, 0, 0, 0);

function addressedTo(agents: string[]): { addressing: RoomMessageAddressing } {
  return {
    addressing: {
      agents,
      roles: [],
      sessions: [],
      hop: 0,
      senderGaid: null,
      actingUserId: "user-1",
      wake: { state: "woken", at: new Date(BASE).toISOString() },
    },
  };
}

function msg(n: number, over: Partial<Msg> = {}): Msg {
  return {
    messageId: `MSG-${String(n).padStart(3, "0")}`,
    workItemId: "room",
    senderType: "agent",
    senderUserId: null,
    senderAgentId: "AGT-OTHER",
    messageType: "comment",
    body: `message ${n}`,
    createdAt: new Date(BASE + n * 1000),
    structuredPayload: null,
    ...over,
  };
}

function cmp(a: RoomMessageCursor, b: RoomMessageCursor): number {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  return t !== 0 ? t : a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0;
}

type Where = Record<string, unknown>;

function messageMatches(m: Msg, where: Where): boolean {
  const ids = (where.workItemId as { in: string[] }).in;
  if (!ids.includes(m.workItemId)) return false;
  if (where.senderAgentId !== undefined && m.senderAgentId !== where.senderAgentId) return false;
  const or = where.OR as Array<Where> | undefined;
  if (or) {
    const after = or[0]!.createdAt as { gt: Date };
    const tie = or[1]!;
    const tieId = (tie.messageId as { gt: string }).gt;
    return m.createdAt > after.gt || (m.createdAt.getTime() === (tie.createdAt as Date).getTime() && m.messageId > tieId);
  }
  return true;
}

function sameDate(a: Date | null, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  return b instanceof Date && a.getTime() === b.getTime();
}

function presenceMatches(p: Presence, where: Where): boolean {
  if (p.workItemId !== where.workItemId || p.principalType !== where.principalType || p.principalId !== where.principalId) return false;
  if ("readCursorAt" in where && !sameDate(p.readCursorAt, where.readCursorAt)) return false;
  if ("readCursorMessageId" in where && p.readCursorMessageId !== where.readCursorMessageId) return false;
  const or = where.OR as Array<Where> | undefined;
  if (or) {
    return or.some((clause) => {
      if (clause.readCursorAt === null) return p.readCursorAt === null;
      if (clause.readCursorAt && typeof clause.readCursorAt === "object" && "lt" in (clause.readCursorAt as object)) {
        return p.readCursorAt !== null && p.readCursorAt < (clause.readCursorAt as { lt: Date }).lt;
      }
      return sameDate(p.readCursorAt, clause.readCursorAt)
        && p.readCursorMessageId !== null
        && p.readCursorMessageId < (clause.readCursorMessageId as { lt: string }).lt;
    });
  }
  return true;
}

function fakeDb(opts: { messages: Msg[]; presence?: Presence[]; roles?: string[] }) {
  const presence = opts.presence ?? [];
  const key = (w: Where) => (w.workItemId_principalType_principalId as Where);
  const db = {
    workItemMessage: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        const rows = opts.messages.filter((m) => messageMatches(m, where)).sort((a, b) => -cmp(a, b));
        return rows[0] ?? null;
      }),
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
        opts.messages.filter((m) => messageMatches(m, where)).sort(cmp).slice(0, take)),
    },
    workItemPresence: {
      findUnique: vi.fn(async ({ where }: { where: Where }) => {
        const k = key(where);
        return presence.find((p) => p.workItemId === k.workItemId && p.principalType === k.principalType && p.principalId === k.principalId) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Presence }) => {
        if (presence.some((p) => p.workItemId === data.workItemId && p.principalType === data.principalType && p.principalId === data.principalId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row: Presence = { ...data };
        presence.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Presence> }) => {
        const hits = presence.filter((p) => presenceMatches(p, where));
        hits.forEach((p) => Object.assign(p, data));
        return { count: hits.length };
      }),
    },
    workroomParticipant: { findMany: vi.fn(async () => (opts.roles ? [{ roles: opts.roles }] : [])) },
  };
  return { db, presence };
}

const READ = {
  roomWorkItemId: "room",
  workItemIds: ["room"],
  agentId: "AGT-ME",
  principalId: "PRN-me",
  gaid: "gaid:priv:dpf.internal:agt-me",
  limit: 20,
};

function ids(result: Awaited<ReturnType<typeof readUnreadRoomMessages>>): string[] {
  if (!result.ok) throw new Error("conflict");
  return result.messages.map((m) => m.messageId);
}

describe("readUnreadRoomMessages", () => {
  it("returns each message for the reader exactly once over two reads, and never one addressed only to another agent (AC-RRC-01)", async () => {
    const { db, presence } = fakeDb({
      messages: [msg(1), msg(2, { structuredPayload: addressedTo(["AGT-ME"]) }), msg(3, { structuredPayload: addressedTo(["AGT-B"]) })],
    });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-001", "MSG-002"]);
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual([]);
    expect(presence[0]).toMatchObject({ principalType: "agent", principalId: "PRN-me", readCursorMessageId: "MSG-003" });
  });

  it("after a gap returns everything posted since the last read, oldest first, paging with hasMore (AC-RRC-02)", async () => {
    const messages = [msg(1)];
    const { db } = fakeDb({ messages });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-001"]);
    messages.push(msg(2), msg(3, { structuredPayload: addressedTo(["AGT-ME"]) }), msg(4));
    const first = await readUnreadRoomMessages({ ...READ, limit: 2 }, db);
    expect(ids(first)).toEqual(["MSG-002", "MSG-003"]);
    expect(first.ok && first.hasMore).toBe(true);
    const second = await readUnreadRoomMessages({ ...READ, limit: 2 }, db);
    expect(ids(second)).toEqual(["MSG-004"]);
    expect(second.ok && second.hasMore).toBe(false);
  });

  it("counts a role the reader holds on a live Workroom", async () => {
    const { db } = fakeDb({
      messages: [msg(1, { structuredPayload: { addressing: { ...addressedTo([]).addressing, roles: ["coordinator"] } } })],
      roles: ["coordinator", "contributor"],
    });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-001"]);
  });

  it("starts at the reader's own newest post when it has no stored position", async () => {
    const { db } = fakeDb({ messages: [msg(1), msg(2, { senderAgentId: "AGT-ME" }), msg(3)] });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-003"]);
  });

  it("starts at the beginning of the room for a reader that has never posted or read", async () => {
    const { db } = fakeDb({ messages: [msg(1), msg(2)] });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-001", "MSG-002"]);
  });

  it("writes nothing when there is nothing past the position", async () => {
    const { db, presence } = fakeDb({ messages: [] });
    const result = await readUnreadRoomMessages(READ, db);
    expect(result).toEqual({ ok: true, messages: [], hasMore: false, readCursor: null });
    expect(presence).toEqual([]);
  });

  it("starts again when a concurrent read moved the position first, so no message is returned twice (AC-RRC-04)", async () => {
    const messages = [msg(1), msg(2)];
    const { db, presence } = fakeDb({
      messages,
      presence: [{ workItemId: "room", principalType: "agent", principalId: "PRN-me", displayLabel: null, readCursorAt: null, readCursorMessageId: null }],
    });
    const realFindMany = db.workItemMessage.findMany.getMockImplementation()!;
    // The first scan races a concurrent read that consumes MSG-001.
    db.workItemMessage.findMany.mockImplementationOnce(async (args) => {
      const rows = await realFindMany(args);
      presence[0]!.readCursorAt = messages[0]!.createdAt;
      presence[0]!.readCursorMessageId = "MSG-001";
      return rows;
    });
    expect(ids(await readUnreadRoomMessages(READ, db))).toEqual(["MSG-002"]);
    expect(presence[0]!.readCursorMessageId).toBe("MSG-002");
  });

  it("answers conflict after three lost compare-and-sets, and returns nothing", async () => {
    const { db } = fakeDb({
      messages: [msg(1)],
      presence: [{ workItemId: "room", principalType: "agent", principalId: "PRN-me", displayLabel: null, readCursorAt: null, readCursorMessageId: null }],
    });
    db.workItemPresence.updateMany.mockResolvedValue({ count: 0 });
    expect(await readUnreadRoomMessages(READ, db)).toEqual({ ok: false, reason: "conflict" });
    expect(db.workItemPresence.updateMany).toHaveBeenCalledTimes(3);
  });
});

describe("advanceRoomReadCursor", () => {
  const key = { workItemId: "room", principalType: "agent" as const, principalId: "PRN-me" };

  it("creates the presence row with the position when there is none", async () => {
    const { db } = fakeDb({ messages: [] });
    expect(await advanceRoomReadCursor({ ...key, to: { createdAt: new Date(BASE + 5000), messageId: "MSG-005" } }, db)).toBe(true);
    expect((await loadStoredRoomReadCursor(key, db)).cursor?.messageId).toBe("MSG-005");
  });

  it("moves forward and never back (AC-RRC-04)", async () => {
    const { db } = fakeDb({ messages: [] });
    await advanceRoomReadCursor({ ...key, to: { createdAt: new Date(BASE + 5000), messageId: "MSG-005" } }, db);
    expect(await advanceRoomReadCursor({ ...key, to: { createdAt: new Date(BASE + 3000), messageId: "MSG-003" } }, db)).toBe(false);
    expect(await advanceRoomReadCursor({ ...key, to: { createdAt: new Date(BASE + 5000), messageId: "MSG-006" } }, db)).toBe(true);
    expect((await loadStoredRoomReadCursor(key, db)).cursor?.messageId).toBe("MSG-006");
  });
});
