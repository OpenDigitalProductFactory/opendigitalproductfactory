import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity/principal-linking", () => ({
  getAgentGaidMap: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `gaid:priv:dpf.internal:${id.toLowerCase()}`]))),
  getAgentIdsForGaids: vi.fn(async (gaids: string[]) =>
    new Map(gaids.filter((g) => g.endsWith(":agt-b")).map((g) => [g, "AGT-B"]))),
}));

import type { RoomMessageAddressing } from "./room-message-addressing";
import {
  dispatchRoomMessage,
  prepareRoomAddressing,
  publishRoomMessagePosted,
  runRoomWake,
  sweepPendingRoomWakes,
  type RoomWakeRequestedEvent,
} from "./room-message-wake.server";

const NOW = new Date("2026-11-11T05:00:07.000Z");

type Row = {
  id: string;
  messageId: string;
  workItemId: string;
  senderAgentId: string | null;
  messageType?: string;
  createdAt: Date;
  structuredPayload: Record<string, unknown> | null;
};

function addressing(over: Partial<RoomMessageAddressing> = {}): RoomMessageAddressing {
  return {
    agents: ["AGT-B"],
    roles: [],
    sessions: [],
    hop: 0,
    senderGaid: "gaid:priv:dpf.internal:agt-a",
    actingUserId: "user-1",
    wake: { state: "pending", at: NOW.toISOString() },
    ...over,
  };
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  if (where.workItemId && where.workItemId !== row.workItemId) return false;
  if (where.messageType && where.messageType !== row.messageType) return false;
  const created = where.createdAt as { gte?: Date; lte?: Date } | undefined;
  if (created?.gte && row.createdAt < created.gte) return false;
  if (created?.lte && row.createdAt > created.lte) return false;
  const sp = where.structuredPayload as { path: string[]; equals?: unknown } | undefined;
  if (sp && readPath(row.structuredPayload, sp.path) !== sp.equals) return false;
  return true;
}

function fakeDb(opts: {
  messages: Row[];
  room?: { id: string; capsuleId: string; executorKind: string | null; executorRef: string | null } | null;
  rooms?: Array<{ id: string; capsuleId: string; workItemId: string; status: string; updatedAt: Date; executorKind: string | null; executorRef: string | null }>;
  participants?: Array<{ principalId: string; roles: string[] }>;
  agentAliases?: Array<{ principalId: string; aliasValue: string }>;
}) {
  const messages = opts.messages;
  const tasks = new Map<string, Record<string, unknown>>();
  const db = {
    workItemMessage: {
      findUnique: vi.fn(async ({ where }: { where: { messageId: string } }) => messages.find((m) => m.messageId === where.messageId) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => messages.filter((m) => matches(m, where))),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => messages.filter((m) => matches(m, where)).length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { structuredPayload: Record<string, unknown> } }) => {
        const row = messages.find((m) => m.id === where.id)!;
        row.structuredPayload = data.structuredPayload;
        return row;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `n${messages.length}`, messageId: `N-${messages.length}`, senderAgentId: null, createdAt: NOW, ...data } as Row;
        messages.push(row);
        return row;
      }),
    },
    workroom: {
      findFirst: vi.fn(async (args: { where: { workItemId: string; status?: { notIn: string[] } } }) => {
        if (!opts.rooms) return opts.room ?? null;
        const closed = args.where.status?.notIn ?? [];
        return opts.rooms
          .filter((r) => r.workItemId === args.where.workItemId && !closed.includes(r.status))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
      }),
    },
    workItem: { findUnique: vi.fn(async () => ({ title: "Room title", parentItemId: null })) },
    workroomParticipant: { findMany: vi.fn(async () => opts.participants ?? []) },
    principalAlias: { findMany: vi.fn(async () => opts.agentAliases ?? []) },
    agent: {
      findUnique: vi.fn(async ({ where }: { where: { agentId: string } }) => ({ agentId: where.agentId, status: "active" })),
      findMany: vi.fn(async ({ where }: { where: { agentId: { in: string[] } } }) =>
        where.agentId.in.filter((id) => id.startsWith("AGT-")).map((agentId) => ({ agentId }))),
    },
    user: { findUnique: vi.fn(async () => ({ id: "user-1" })) },
    scheduledAgentTask: {
      upsert: vi.fn(async ({ where, create }: { where: { taskId: string }; create: Record<string, unknown> }) => {
        tasks.set(where.taskId, create);
        return create;
      }),
    },
  };
  return { db, tasks, messages };
}

function message(over: Partial<Row> = {}, addr: Partial<RoomMessageAddressing> = {}): Row {
  return {
    id: "m1",
    messageId: "MSG-1",
    workItemId: "wi-1",
    senderAgentId: "AGT-A",
    messageType: "comment",
    createdAt: NOW,
    structuredPayload: { workroom: { caseKey: "backlog-item:BI-1" }, addressing: addressing(addr) },
    ...over,
  };
}

describe("publishRoomMessagePosted", () => {
  it("sends room/message.posted idempotent on the message id and leaves the wake pending", async () => {
    const { db, messages } = fakeDb({ messages: [message()] });
    const send = vi.fn(async (_event: unknown) => ({}));
    expect(await publishRoomMessagePosted("MSG-1", { db, send, now: () => NOW })).toBe(true);
    expect(send).toHaveBeenCalledWith({ name: "room/message.posted", id: "room-message-posted:MSG-1", data: { messageId: "MSG-1" } });
    expect(readPath(messages[0]!.structuredPayload, ["addressing", "wake", "state"])).toBe("pending");
  });

  it("never fails the post when the job engine is down (AC-3)", async () => {
    const { db } = fakeDb({ messages: [message()] });
    const send = vi.fn(async (_event: unknown) => { throw new Error("engine stopped"); });
    expect(await publishRoomMessagePosted("MSG-1", { db, send, now: () => NOW })).toBe(false);
  });
});

describe("sweepPendingRoomWakes (AC-3)", () => {
  it("re-sends a wake left pending by an outage, with a fresh event id", async () => {
    const old = message({ createdAt: new Date(NOW.getTime() - 60_000) });
    const { db } = fakeDb({ messages: [old] });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await sweepPendingRoomWakes({ db, send, now: () => NOW });
    expect(result).toEqual({ republished: 1, pending: 1 });
    expect(send.mock.calls[0]![0]).toMatchObject({ name: "room/message.posted", id: `room-message-posted:MSG-1:sweep-${NOW.getTime()}` });
  });

  it("leaves a message that was just posted to its own publish", async () => {
    const { db } = fakeDb({ messages: [message({ createdAt: new Date(NOW.getTime() - 5_000) })] });
    const send = vi.fn(async (_event: unknown) => ({}));
    expect(await sweepPendingRoomWakes({ db, send, now: () => NOW })).toEqual({ republished: 0, pending: 0 });
  });

  it("delivers the wake once: a decided message is never dispatched again", async () => {
    const { db } = fakeDb({ messages: [message()] });
    const send = vi.fn(async (_event: unknown) => ({}));
    const first = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    const second = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    expect(first.plan).toBe("wake");
    expect(second.plan).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchRoomMessage", () => {
  it("requests one coalescing wake per addressed in-platform coworker (AC-1)", async () => {
    const { db, messages } = fakeDb({ messages: [message()] });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    expect(result).toEqual({ messageId: "MSG-1", plan: "wake", woken: ["AGT-B"] });
    const event = send.mock.calls[0]![0] as unknown as { name: string; id: string; data: RoomWakeRequestedEvent };
    expect(event.name).toBe("room/wake.requested");
    expect(event.id).toBe(`room-wake:wi-1:AGT-B:${Math.floor(NOW.getTime() / 15_000)}`);
    expect(event.data).toMatchObject({
      workItemId: "wi-1",
      agentId: "AGT-B",
      laneKey: "wi-1:AGT-B",
      actingUserId: "user-1",
      caseKey: "backlog-item:BI-1",
      closesAt: "2026-11-11T05:00:15.000Z",
    });
    expect(readPath(messages[0]!.structuredPayload, ["addressing", "wake", "state"])).toBe("woken");
  });

  it("dispatches nothing onto a room an external executor is working (AC-2)", async () => {
    const { db, messages } = fakeDb({
      messages: [message()],
      room: { id: "room-1", capsuleId: "WC-1", executorKind: "claude-desktop", executorRef: "sess-1" },
    });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    expect(result.plan).toBe("hold");
    expect(send).not.toHaveBeenCalled();
    expect(readPath(messages[0]!.structuredPayload, ["addressing", "wake", "state"])).toBe("held-for-executor");
  });

  it("decides against the item's live room, not a closed room left without archivedAt", async () => {
    const { db, messages } = fakeDb({
      messages: [message()],
      rooms: [
        { id: "old", capsuleId: "WC-OLD", workItemId: "wi-1", status: "archived", updatedAt: new Date(NOW.getTime() + 1_000), executorKind: "claude-desktop", executorRef: "sess-old" },
        { id: "live", capsuleId: "WC-LIVE", workItemId: "wi-1", status: "ready", updatedAt: NOW, executorKind: null, executorRef: null },
      ],
    });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    expect(result.plan).toBe("wake");
    expect(db.workroom.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { workItemId: "wi-1", archivedAt: null, status: { notIn: ["abandoned", "archived"] } },
      orderBy: { updatedAt: "desc" },
    });
    expect(readPath(messages[0]!.structuredPayload, ["addressing", "wake", "state"])).toBe("woken");
  });

  it("wakes the coordinator at the hop limit and says why in the room (AC-4)", async () => {
    const { db, messages } = fakeDb({
      messages: [message({}, { hop: 8 })],
      room: { id: "room-1", capsuleId: "WC-1", executorKind: null, executorRef: null },
      participants: [{ principalId: "PRN-C", roles: ["coordinator"] }],
      agentAliases: [{ principalId: "PRN-C", aliasValue: "AGT-COORD" }],
    });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW });
    expect(result).toMatchObject({ plan: "wake", woken: ["AGT-COORD"] });
    const notice = messages.find((m) => m.messageType === "room-wake-notice");
    expect(notice?.structuredPayload).toMatchObject({ roomWakeNotice: { kind: "hop-limit" } });
  });

  it("pauses at the hourly budget, says so once, and wakes no one (AC-4)", async () => {
    const earlier = Array.from({ length: 30 }, (_, i) => message(
      { id: `w${i}`, messageId: `W-${i}`, createdAt: new Date(NOW.getTime() - 60_000) },
      { wake: { state: "woken", at: NOW.toISOString() } },
    ));
    const { db, messages } = fakeDb({ messages: [...earlier, message(), message({ id: "m2", messageId: "MSG-2" })] });
    const send = vi.fn(async (_event: unknown) => ({}));
    expect((await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW })).plan).toBe("pause");
    expect((await dispatchRoomMessage("MSG-2", { db, send, now: () => NOW })).plan).toBe("pause");
    expect(send).not.toHaveBeenCalled();
    expect(messages.filter((m) => m.messageType === "room-wake-notice")).toHaveLength(1);
  });

  it("never schedules a platform task for an external client agent", async () => {
    const { db } = fakeDb({ messages: [message({}, { agents: ["AGT-EXT-CODEX"] })] });
    const send = vi.fn(async (_event: unknown) => ({}));
    expect((await dispatchRoomMessage("MSG-1", { db, send, now: () => NOW })).plan).toBe("hold");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runRoomWake", () => {
  const event: RoomWakeRequestedEvent = {
    workItemId: "wi-1",
    agentId: "AGT-B",
    laneKey: "wi-1:AGT-B",
    actingUserId: "user-1",
    caseKey: "backlog-item:BI-1",
    title: "Room title",
    messageId: "MSG-1",
    closesAt: NOW.toISOString(),
  };

  it("schedules a one-shot reply task under the poster's authority and asks for it to run now (AC-1)", async () => {
    const { db, tasks } = fakeDb({ messages: [] });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await runRoomWake(event, { db, send, now: () => NOW });
    expect(result).toEqual({ outcome: "requested", taskId: "room-reply-wi-1-AGT-B" });
    expect(send).toHaveBeenCalledWith({
      name: "agent/task.run-now",
      id: `run-now:room-reply-wi-1-AGT-B:${NOW.getTime()}`,
      data: { taskId: "room-reply-wi-1-AGT-B" },
    });
    const task = tasks.get("room-reply-wi-1-AGT-B")!;
    expect(task).toMatchObject({ agentId: "AGT-B", ownerUserId: "user-1", schedule: "0 5 11 11 *", isActive: true, nextRunAt: NOW });
    expect(String(task.prompt)).toContain("backlog-item:BI-1");
  });

  it("skips a wake it cannot reply to, scheduling nothing", async () => {
    const { db, tasks } = fakeDb({ messages: [] });
    const send = vi.fn(async (_event: unknown) => ({}));
    const result = await runRoomWake({ ...event, caseKey: null }, { db, send, now: () => NOW });
    expect(result.outcome).toBe("skipped");
    expect(tasks.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("prepareRoomAddressing", () => {
  it("resolves GAIDs and @mentions, and records the sender's GAID and hop", async () => {
    const { db } = fakeDb({ messages: [] });
    const prepared = await prepareRoomAddressing(
      { workItemId: "wi-1", sender: { type: "agent", id: "AGT-A" }, actingUserId: "user-1", addressedTo: ["gaid:priv:dpf.internal:agt-b", "coordinator"] },
      { db, now: () => NOW },
    );
    if (prepared.refused) throw new Error(prepared.message);
    expect(prepared.build(["AGT-C"])).toMatchObject({
      agents: ["AGT-B", "AGT-C"],
      roles: ["coordinator"],
      hop: 0,
      senderGaid: "gaid:priv:dpf.internal:agt-a",
      actingUserId: "user-1",
      wake: { state: "pending" },
    });
  });

  it("refuses a GAID no local coworker has: a remote GAID is provenance, not an address", async () => {
    const { db } = fakeDb({ messages: [] });
    const prepared = await prepareRoomAddressing(
      { workItemId: "wi-1", sender: { type: "user", id: "user-1" }, actingUserId: "user-1", addressedTo: ["gaid:priv:other.install:agt-z"] },
      { db, now: () => NOW },
    );
    expect(prepared.refused).toBe(true);
  });

  it("stores nothing when nothing is addressed", async () => {
    const { db } = fakeDb({ messages: [] });
    const prepared = await prepareRoomAddressing(
      { workItemId: "wi-1", sender: { type: "user", id: "user-1" }, actingUserId: "user-1", addressedTo: undefined },
      { db, now: () => NOW },
    );
    expect(!prepared.refused && prepared.build([])).toBeNull();
  });
});
