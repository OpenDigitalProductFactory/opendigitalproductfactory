import { describe, expect, it, vi } from "vitest";

// BI-F5D58F29 (agent dialog broker item D): the dispatcher turns a message
// addressed to a supervised session into that session's next turn, and leaves
// everything else as B2 planned it.

vi.mock("@/lib/identity/principal-linking", () => ({
  getAgentGaidMap: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `gaid:priv:dpf.internal:${id.toLowerCase()}`]))),
  getAgentIdsForGaids: vi.fn(async () => new Map()),
}));

import type { RoomMessageAddressing } from "@/lib/work-management/room-message-addressing";
import { decodeRoomMessageCursor, encodeRoomMessageCursor } from "@/lib/work-management/room-message-cursor";
import { announceSupervisionLost, dispatchRoomMessage } from "@/lib/work-management/room-message-wake.server";

import { combineSupervisedWake, type SupervisedSessionPort } from "./supervised-turn-delivery";

const NOW = new Date("2026-11-11T05:00:07.000Z");
const ADDRESS = "gaid:priv:dpf.internal:agt-ext-claude#session=thr-1";

type Row = {
  id: string; messageId: string; workItemId: string; senderType: string; senderAgentId: string | null;
  messageType: string; body: string; createdAt: Date; structuredPayload: Record<string, unknown> | null;
};

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
}

function addressing(over: Partial<RoomMessageAddressing> = {}): RoomMessageAddressing {
  return {
    agents: ["AGT-EXT-CLAUDE"], roles: [], sessions: [ADDRESS], hop: 0,
    senderGaid: "gaid:priv:dpf.internal:agt-a", actingUserId: "user-1",
    wake: { state: "pending", at: NOW.toISOString() }, ...over,
  };
}

function row(over: Partial<Row> = {}, addr?: Partial<RoomMessageAddressing>): Row {
  return {
    id: "m1", messageId: "MSG-1", workItemId: "wi-1", senderType: "agent", senderAgentId: "AGT-A", messageType: "comment",
    body: "Please rerun the failing test.", createdAt: NOW,
    structuredPayload: { workroom: { caseKey: "work-capsule%3AWC-1" }, ...(addr === undefined ? {} : { addressing: addressing(addr) }) },
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    runtimeSession: {
      provider: "claude", threadId: "thr-1", tokenId: "tok-1", status: "supervised", openedAt: "2026-11-11T04:00:00.000Z",
      cwd: "/workspace", addressedAs: ADDRESS, actor: { userId: "user-1", agentId: null, principalId: null }, ...over,
    },
  };
}

function harness(opts: {
  messages: Row[];
  executorKind?: string | null;
  workspaceState?: unknown;
  live?: boolean;
  deliver?: SupervisedSessionPort["deliver"];
  participants?: Array<{ principalId: string; roles: string[] }>;
  aliases?: Array<{ principalId: string; aliasValue: string }>;
  /** Another dispatch run decided the message between this run's read and its claim. */
  claimLost?: boolean;
}) {
  const messages = opts.messages;
  const room = { id: "room-1", capsuleId: "WC-1", executorKind: opts.executorKind === undefined ? "claude-desktop" : opts.executorKind, executorRef: "sess-desk", workItemId: "wi-1", workspaceState: opts.workspaceState ?? stored() };
  const db = {
    workItemMessage: {
      findUnique: vi.fn(async ({ where }: { where: { messageId: string } }) => messages.find((m) => m.messageId === where.messageId) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const created = where.createdAt as { gte?: Date; lte?: Date } | undefined;
        const not = (where.messageId as { not?: string } | undefined)?.not;
        return messages
          .filter((m) => m.workItemId === where.workItemId && (!created?.gte || m.createdAt >= created.gte) && (!created?.lte || m.createdAt <= created.lte) && m.messageId !== not)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take ?? messages.length);
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const sp = where.structuredPayload as { path: string[]; equals: unknown } | undefined;
        return messages.filter((m) => m.workItemId === where.workItemId && (!where.messageType || m.messageType === where.messageType)
          && (!sp || readPath(m.structuredPayload, sp.path) === sp.equals)).length;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { structuredPayload: Record<string, unknown> } }) => {
        const found = messages.find((m) => m.id === where.id)!;
        found.structuredPayload = data.structuredPayload;
        return found;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; structuredPayload: { path: string[]; equals: unknown } }; data: { structuredPayload: Record<string, unknown> } }) => {
        const found = messages.find((m) => m.id === where.id && readPath(m.structuredPayload, where.structuredPayload.path) === where.structuredPayload.equals);
        if (!found || opts.claimLost) return { count: 0 };
        found.structuredPayload = data.structuredPayload;
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `n${messages.length}`, messageId: `N-${messages.length}`, senderAgentId: null, createdAt: NOW, ...data } as Row;
        messages.push(created);
        return created;
      }),
    },
    workroom: { findMany: vi.fn(async () => [room]), findUnique: vi.fn(async () => room) },
    workItem: { findUnique: vi.fn(async () => ({ title: "Room title", parentItemId: null })) },
    workroomParticipant: { findMany: vi.fn(async () => opts.participants ?? []) },
    principalAlias: { findMany: vi.fn(async () => opts.aliases ?? []) },
    agent: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  };
  const deliver = vi.fn(opts.deliver ?? (async () => ({ success: true, message: "Turn started." })));
  const supervision: SupervisedSessionPort = { isLive: () => opts.live ?? true, deliver };
  const send = vi.fn(async (_event: unknown) => ({}));
  return { deps: { db, send, now: () => NOW, supervision }, deliver, send, messages };
}

const wakeOf = (m: Row) => readPath(m.structuredPayload, ["addressing", "wake"]) as { state: string; detail?: string; woken?: string[] };

describe("a message addressed to a supervised session (AC-ADB-12)", () => {
  it("becomes the session's next turn, even in a room an external executor holds, and dispatches no coworker", async () => {
    const h = harness({ messages: [row({}, {})] });
    const result = await dispatchRoomMessage("MSG-1", h.deps);
    expect(result).toEqual({ messageId: "MSG-1", plan: "turn", woken: [ADDRESS] });
    expect(h.deliver).toHaveBeenCalledTimes(1);
    const call = h.deliver.mock.calls[0]![0];
    expect(call.capsuleId).toBe("WC-1");
    expect(call.prompt).toContain("Please rerun the failing test.");
    expect(call.prompt).toContain("gaid:priv:dpf.internal:agt-a");
    expect(decodeRoomMessageCursor(call.deliveredCursor)).toEqual({ createdAt: NOW, messageId: "MSG-1" });
    expect(h.send).not.toHaveBeenCalled();
    expect(wakeOf(h.messages[0]!)).toMatchObject({ state: "woken", woken: [ADDRESS] });
  });

  it("folds the room-wide messages since the session's cursor into the turn", async () => {
    const before = row({ id: "m0", messageId: "MSG-0", body: "already handed over", createdAt: new Date(NOW.getTime() - 9_000) });
    const roomWide = row({ id: "m2", messageId: "MSG-2", body: "fyi the build is red", senderType: "user", senderAgentId: null, createdAt: new Date(NOW.getTime() - 3_000) });
    const h = harness({
      messages: [before, roomWide, row({}, {})],
      workspaceState: stored({ deliveredCursor: encodeRoomMessageCursor(before) }),
    });
    await dispatchRoomMessage("MSG-1", h.deps);
    const prompt = h.deliver.mock.calls[0]![0].prompt;
    expect(prompt).toContain("fyi the build is red");
    expect(prompt).not.toContain("already handed over");
  });

  it("is not delivered by a run that loses the claim to a concurrent one", async () => {
    const h = harness({ messages: [row({}, {})], claimLost: true });
    await expect(dispatchRoomMessage("MSG-1", h.deps)).resolves.toMatchObject({ plan: "skipped" });
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it("is delivered once: a retried dispatch decides nothing twice", async () => {
    const h = harness({ messages: [row({}, {})] });
    await dispatchRoomMessage("MSG-1", h.deps);
    await expect(dispatchRoomMessage("MSG-1", h.deps)).resolves.toMatchObject({ plan: "skipped" });
    expect(h.deliver).toHaveBeenCalledTimes(1);
  });
});

describe("a message the platform cannot turn into a turn stays held", () => {
  it("when the named session is not supervised in this portal", async () => {
    const h = harness({ messages: [row({}, {})], live: false });
    const result = await dispatchRoomMessage("MSG-1", h.deps);
    expect(result.plan).toBe("hold");
    expect(h.deliver).not.toHaveBeenCalled();
    expect(wakeOf(h.messages[0]!)).toMatchObject({ state: "held-for-executor", detail: expect.stringContaining("waits on the cursor") });
  });

  it("when supervision was lost (AC-ADB-13)", async () => {
    const h = harness({ messages: [row({}, {})], workspaceState: stored({ status: "supervision-lost", lostReason: "no codex runtime" }) });
    await dispatchRoomMessage("MSG-1", h.deps);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(wakeOf(h.messages[0]!)).toMatchObject({ state: "held-for-executor", detail: expect.stringContaining("no codex runtime") });
  });

  it("when the qualifier names a desktop session nobody supervises", async () => {
    const h = harness({ messages: [row({}, { sessions: ["gaid:priv:dpf.internal:agt-ext-claude#session=desktop-9"] })] });
    await dispatchRoomMessage("MSG-1", h.deps);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(wakeOf(h.messages[0]!).state).toBe("held-for-executor");
  });

  it("when the turn cannot start, saying why", async () => {
    const h = harness({ messages: [row({}, {})], deliver: async () => ({ success: false, message: "no live runtime session" }) });
    const result = await dispatchRoomMessage("MSG-1", h.deps);
    expect(result).toMatchObject({ plan: "hold", woken: [] });
    expect(wakeOf(h.messages[0]!)).toMatchObject({ state: "held-for-executor", detail: expect.stringContaining("no live runtime session") });
  });

  it("past the room's hourly wake budget", async () => {
    const spent = Array.from({ length: 30 }, (_, i) => row({ id: `w${i}`, messageId: `W-${i}`, createdAt: new Date(NOW.getTime() - 60_000) }, { wake: { state: "woken", at: "" } }));
    const h = harness({ messages: [...spent, row({}, {})] });
    await dispatchRoomMessage("MSG-1", h.deps);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(wakeOf(h.messages.at(-1)!).state).toBe("paused-budget");
  });
});

it("never dispatches a platform coworker onto a room an external executor holds, supervised or not (BI-A659C3BD)", async () => {
  const h = harness({ messages: [row({}, { agents: ["AGT-B"], sessions: [] })] });
  const result = await dispatchRoomMessage("MSG-1", h.deps);
  expect(result.plan).toBe("hold");
  expect(h.deliver).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});

describe("announceSupervisionLost (AC-ADB-13)", () => {
  it("says so in the room and wakes the room's coworker coordinator", async () => {
    const h = harness({ messages: [], executorKind: null, participants: [{ principalId: "PRN-C", roles: ["coordinator"] }], aliases: [{ principalId: "PRN-C", aliasValue: "AGT-COORD" }] });
    await announceSupervisionLost({ capsuleId: "WC-1", reason: "no codex runtime", actingUserId: "user-1", addressedAs: ADDRESS, wakeCoordinator: true }, h.deps);
    const notice = h.messages.find((m) => m.messageType === "room-wake-notice")!;
    expect(notice.body).toContain("no codex runtime");
    expect(readPath(notice.structuredPayload, ["roomWakeNotice", "kind"])).toBe("supervision-lost");
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      name: "room/wake.requested",
      data: expect.objectContaining({ agentId: "AGT-COORD", workItemId: "wi-1", actingUserId: "user-1", messageId: notice.messageId, caseKey: "work-capsule%3AWC-1" }),
    }));
  });

  it("gives no platform coworker a task in a room an external executor holds (BI-A659C3BD)", async () => {
    const h = harness({ messages: [], executorKind: "claude-desktop", participants: [{ principalId: "PRN-C", roles: ["coordinator"] }], aliases: [{ principalId: "PRN-C", aliasValue: "AGT-COORD" }] });
    await announceSupervisionLost({ capsuleId: "WC-1", reason: "open failed", actingUserId: "user-1", addressedAs: ADDRESS, wakeCoordinator: true }, h.deps);
    expect(h.messages.filter((m) => m.messageType === "room-wake-notice")).toHaveLength(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("only tells the room about a session long silent", async () => {
    const h = harness({ messages: [], executorKind: null, participants: [{ principalId: "PRN-C", roles: ["coordinator"] }], aliases: [{ principalId: "PRN-C", aliasValue: "AGT-COORD" }] });
    await announceSupervisionLost({ capsuleId: "WC-1", reason: "silent", actingUserId: "user-1", addressedAs: ADDRESS, wakeCoordinator: false }, h.deps);
    expect(h.messages).toHaveLength(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});

// BI-8747A73D: a coworker that cannot post is refused (cannot-reply). The
// supervised-session outcome on the same message must not erase that refusal.
describe("combineSupervisedWake with a cannot-reply refusal", () => {
  const refuse = { kind: "refuse", state: "cannot-reply", detail: "AGT-B cannot reply here: it lacks the work_room_write grant, which the coworker's owner grants. No reply turn was started." } as const;

  it("keeps the refusal when the session is held", () => {
    const combined = combineSupervisedWake(refuse, { kind: "held", detail: "The session is not live." });
    expect(combined.plan).toBe("refuse");
    expect(combined.wake.state).toBe("cannot-reply");
    expect(combined.wake.detail).toContain("work_room_write");
    expect(combined.wake.detail).toContain("The session is not live.");
    expect(combined.woken).toEqual([]);
  });

  it("keeps the refusal's reason when the session takes the turn", () => {
    const combined = combineSupervisedWake(refuse, { kind: "delivered", addressedAs: ADDRESS });
    expect(combined.plan).toBe("turn");
    expect(combined.wake.state).toBe("woken");
    expect(combined.wake.detail).toContain("work_room_write");
    expect(combined.woken).toEqual([ADDRESS]);
  });
});
