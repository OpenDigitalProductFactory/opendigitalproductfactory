import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { createRoomUpdateFanout, type RoomUpdateFanoutDeps } from "./room-update-fanout.server";

const NOW = new Date("2026-11-12T00:00:10.000Z");
const URI = "dpf://rooms/backlog-item%3ABI-1/messages";
const CHILD_URI = "dpf://rooms/backlog-item%3ABI-2/messages";
const auth = (tokenId: string) => ({ tokenId, userId: "user-1", agentId: "AGT-EXT-CLAUDE", scope: "read", capability: "read", scopes: ["work_room_read"] });
const notice = (workItemId = "wi-1", messageId = "m-1") => JSON.stringify({ workItemId, messageId, createdAt: "2026-11-12T00:00:09.000Z" });

function harness() {
  let onPayload: ((payload: string) => void) | null = null;
  let onDown: (() => void) | null = null;
  const db = {
    workItem: { findUnique: vi.fn().mockResolvedValue({ parentItemId: null }) },
    mcpResourceSubscription: {
      findMany: vi.fn().mockResolvedValue([{ subscriberKey: "family:fam-1", uri: URI, workItemId: "wi-1" }]),
    },
    workItemMessage: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const listen = vi.fn(async (payload: (p: string) => void, down: () => void) => {
    onPayload = payload;
    onDown = down;
    return () => {};
  });
  const deps: RoomUpdateFanoutDeps = {
    db,
    now: () => NOW,
    admitted: vi.fn().mockResolvedValue(true),
    listen,
    reconnectDelayMs: () => 0,
  };
  const fanout = createRoomUpdateFanout(deps);
  return {
    fanout,
    deps,
    db,
    listen,
    emit: async (payload: string) => {
      onPayload?.(payload);
      await fanout.idle();
    },
    drop: () => onDown?.(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("room update fan-out (BI-ED52AB82)", () => {
  it("opens one shared listener for all streams in the process", async () => {
    const h = harness();
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: vi.fn(() => true) });
    h.fanout.register({ subscriberKey: "family:fam-2", auth: auth("tok-2"), deliver: vi.fn(() => true) });
    await h.fanout.idle();
    expect(h.listen).toHaveBeenCalledTimes(1);
  });

  it("tells an admitted subscriber its room changed, with the room URI and nothing else", async () => {
    const h = harness();
    const deliver = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver });
    await h.fanout.idle();
    await h.emit(notice());
    expect(h.db.mcpResourceSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workItemId: { in: ["wi-1"] }, subscriberKey: { in: ["family:fam-1"] }, expiresAt: { gt: NOW } },
    }));
    expect(h.deps.admitted).toHaveBeenCalledWith(auth("tok-1"), ["wi-1"]);
    expect(deliver).toHaveBeenCalledWith(URI, new Date("2026-11-12T00:00:09.000Z"));
  });

  it("sends nothing to a subscriber that is no longer admitted (AC-3)", async () => {
    const h = harness();
    (h.deps.admitted as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const deliver = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver });
    await h.fanout.idle();
    await h.emit(notice());
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers each notification on only one of a subscriber's streams (MCP: MUST NOT broadcast)", async () => {
    const h = harness();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: first });
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: second });
    await h.fanout.idle();
    await h.emit(notice("wi-1", "m-1"));
    await h.emit(notice("wi-1", "m-2"));
    expect(first.mock.calls.length + second.mock.calls.length).toBe(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("moves to another stream when the chosen one has closed", async () => {
    const h = harness();
    const closed = vi.fn(() => false);
    const open = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: closed });
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: open });
    await h.fanout.idle();
    await h.emit(notice());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("tells a parent room's subscriber about a child room message, checking both rooms", async () => {
    const h = harness();
    h.db.workItem.findUnique.mockResolvedValue({ parentItemId: "wi-1" });
    const deliver = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver });
    await h.fanout.idle();
    await h.emit(notice("wi-2"));
    expect(h.db.mcpResourceSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workItemId: { in: ["wi-2", "wi-1"] } }),
    }));
    expect(h.deps.admitted).toHaveBeenCalledWith(auth("tok-1"), ["wi-1", "wi-2"]);
    expect(deliver).toHaveBeenCalledWith(URI, expect.any(Date));
  });

  it("does no work for a notice when no stream is open in this process", async () => {
    const h = harness();
    const unregister = h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: vi.fn(() => true) });
    await h.fanout.idle();
    unregister();
    await h.emit(notice());
    expect(h.db.mcpResourceSubscription.findMany).not.toHaveBeenCalled();
  });

  it("ignores a malformed notice", async () => {
    const h = harness();
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver: vi.fn(() => true) });
    await h.fanout.idle();
    await h.emit("not json");
    expect(h.db.workItem.findUnique).not.toHaveBeenCalled();
  });

  it("replays one update per subscribed room that changed since a reconnecting stream's watermark (AC-2)", async () => {
    const h = harness();
    h.db.mcpResourceSubscription.findMany.mockResolvedValue([
      { subscriberKey: "family:fam-1", uri: URI, workItemId: "wi-1" },
      { subscriberKey: "family:fam-1", uri: CHILD_URI, workItemId: "wi-9" },
    ]);
    h.db.workItemMessage.findMany.mockResolvedValue([
      { workItemId: "wi-1", createdAt: new Date("2026-11-12T00:00:05.000Z"), workItem: { parentItemId: null } },
      { workItemId: "wi-1", createdAt: new Date("2026-11-12T00:00:04.000Z"), workItem: { parentItemId: null } },
    ]);
    const deliver = vi.fn(() => true);
    const handle = { subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver };
    h.fanout.register(handle);
    await h.fanout.replay(handle, new Date("2026-11-12T00:00:01.000Z"));
    expect(h.db.workItemMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gt: new Date("2026-11-12T00:00:01.000Z") } }),
    }));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(URI, new Date("2026-11-12T00:00:05.000Z"));
  });

  it("reconnects a dropped listener and catches up on what it missed", async () => {
    const h = harness();
    const deliver = vi.fn(() => true);
    h.fanout.register({ subscriberKey: "family:fam-1", auth: auth("tok-1"), deliver });
    await h.fanout.idle();
    await h.emit(notice());
    h.db.workItemMessage.findMany.mockResolvedValue([
      { workItemId: "wi-1", createdAt: new Date("2026-11-12T00:00:09.500Z"), workItem: { parentItemId: null } },
    ]);
    h.drop();
    await vi.waitFor(() => expect(h.listen).toHaveBeenCalledTimes(2));
    await h.fanout.idle();
    expect(h.db.workItemMessage.findMany).toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
