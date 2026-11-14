import { describe, expect, it } from "vitest";

import type { RoomMessageAddressing } from "./room-message-addressing";
import {
  compareRoomMessagePosition,
  isRoomMessageForReader,
  planUnreadPage,
  type RoomReader,
  type RoomUnreadCandidate,
} from "./room-read-cursor";

const READER: RoomReader = { agentId: "AGT-ME", gaid: "gaid:priv:dpf.internal:agt-me", roles: ["coordinator"] };

function addressed(over: Partial<RoomMessageAddressing>): { addressing: RoomMessageAddressing } {
  return {
    addressing: {
      agents: [],
      roles: [],
      sessions: [],
      hop: 0,
      senderGaid: null,
      actingUserId: "user-1",
      wake: { state: "woken", at: "2026-11-11T00:00:00.000Z" },
      ...over,
    },
  };
}

function row(n: number, over: Partial<RoomUnreadCandidate> = {}): RoomUnreadCandidate {
  return {
    createdAt: new Date(Date.UTC(2026, 10, 11, 0, 0, n)),
    messageId: `MSG-${String(n).padStart(3, "0")}`,
    senderAgentId: "AGT-OTHER",
    structuredPayload: null,
    ...over,
  };
}

describe("isRoomMessageForReader", () => {
  it("counts a message with no addressing as addressed to the room", () => {
    expect(isRoomMessageForReader(row(1), READER)).toBe(true);
    expect(isRoomMessageForReader(row(1, { senderAgentId: null, structuredPayload: { roomWakeNotice: { kind: "paused-budget" } } }), READER)).toBe(true);
  });

  it("counts a message addressed to this agent, to a role it holds or to its own GAID's session", () => {
    expect(isRoomMessageForReader(row(1, { structuredPayload: addressed({ agents: ["AGT-ME"] }) }), READER)).toBe(true);
    expect(isRoomMessageForReader(row(1, { structuredPayload: addressed({ roles: ["coordinator"] }) }), READER)).toBe(true);
    expect(isRoomMessageForReader(
      row(1, { structuredPayload: addressed({ sessions: ["gaid:priv:dpf.internal:agt-me#session=abc"] }) }),
      READER,
    )).toBe(true);
  });

  it("passes over a message addressed only to someone else, and the reader's own posts", () => {
    expect(isRoomMessageForReader(row(1, { structuredPayload: addressed({ agents: ["AGT-B"] }) }), READER)).toBe(false);
    expect(isRoomMessageForReader(row(1, { structuredPayload: addressed({ roles: ["accountable"] }) }), READER)).toBe(false);
    expect(isRoomMessageForReader(
      row(1, { structuredPayload: addressed({ sessions: ["gaid:priv:dpf.internal:agt-b#session=x"] }) }),
      READER,
    )).toBe(false);
    expect(isRoomMessageForReader(row(1, { senderAgentId: "AGT-ME" }), READER)).toBe(false);
  });
});

describe("compareRoomMessagePosition", () => {
  it("orders by time, then by message id", () => {
    const t = new Date("2026-11-11T00:00:00.000Z");
    expect(compareRoomMessagePosition({ createdAt: t, messageId: "A" }, { createdAt: t, messageId: "B" })).toBeLessThan(0);
    expect(compareRoomMessagePosition({ createdAt: new Date(t.getTime() + 1), messageId: "A" }, { createdAt: t, messageId: "B" })).toBeGreaterThan(0);
    expect(compareRoomMessagePosition({ createdAt: t, messageId: "A" }, { createdAt: t, messageId: "A" })).toBe(0);
  });
});

describe("planUnreadPage", () => {
  it("returns the messages for the reader and consumes through the last one considered", () => {
    const rows = [row(1), row(2, { structuredPayload: addressed({ agents: ["AGT-B"] }) }), row(3)];
    const page = planUnreadPage(rows, READER, 20);
    expect(page.delivered.map((r) => r.messageId)).toEqual(["MSG-001", "MSG-003"]);
    expect(page.consumed?.messageId).toBe("MSG-003");
    expect(page.hasMore).toBe(false);
  });

  it("stops before the message that would overflow the limit, so the next read starts on it", () => {
    const rows = [row(1), row(2, { structuredPayload: addressed({ agents: ["AGT-B"] }) }), row(3), row(4)];
    const page = planUnreadPage(rows, READER, 1);
    expect(page.delivered.map((r) => r.messageId)).toEqual(["MSG-001"]);
    expect(page.consumed?.messageId).toBe("MSG-002");
    expect(page.hasMore).toBe(true);
  });

  it("moves past a full window of messages for others, so a busy room never stalls a reader", () => {
    const others = Array.from({ length: 6 }, (_, i) => row(i + 1, { structuredPayload: addressed({ agents: ["AGT-B"] }) }));
    const page = planUnreadPage(others, READER, 20, 5);
    expect(page.delivered).toEqual([]);
    expect(page.consumed?.messageId).toBe("MSG-005");
    expect(page.hasMore).toBe(true);
  });

  it("consumes nothing in an empty room", () => {
    expect(planUnreadPage([], READER, 20)).toEqual({ delivered: [], consumed: null, hasMore: false });
  });
});
