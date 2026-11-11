import { describe, expect, it } from "vitest";

import {
  computeRoomMessageHop,
  oneShotCronAt,
  parseAddressedTo,
  planRoomWake,
  readRoomMessageAddressing,
  roomWakeEventId,
  roomWakeWindow,
  type RoomMessageAddressing,
} from "./room-message-addressing";
import { isOneShotCron } from "@/lib/operate/cron-next-run";

function addressing(over: Partial<RoomMessageAddressing> = {}): RoomMessageAddressing {
  return {
    agents: ["AGT-B"],
    roles: [],
    sessions: [],
    hop: 0,
    senderGaid: null,
    actingUserId: "user-1",
    wake: { state: "pending", at: "2026-11-11T00:00:00.000Z" },
    ...over,
  };
}

const base = {
  senderAgentId: "AGT-A",
  roleAgents: {},
  coordinatorAgentIds: ["AGT-COORD"],
  executor: null,
  wakesLastHour: 0,
};

describe("parseAddressedTo", () => {
  it("splits agent ids, GAIDs, roles and session refs", () => {
    const parsed = parseAddressedTo([
      "AGT-WS-REVIEW",
      "gaid:priv:dpf.internal:agt-181",
      "Coordinator",
      "gaid:priv:dpf.internal:agt-ext-claude#session=abc",
      "not valid!",
    ]);
    expect(parsed.agentRefs).toEqual(["AGT-WS-REVIEW"]);
    expect(parsed.gaids).toEqual(["gaid:priv:dpf.internal:agt-181", "gaid:priv:dpf.internal:agt-ext-claude"]);
    expect(parsed.roles).toEqual(["coordinator"]);
    expect(parsed.sessions).toEqual(["gaid:priv:dpf.internal:agt-ext-claude#session=abc"]);
    expect(parsed.invalid).toEqual(["not valid!"]);
  });

  it("treats a missing list as nothing addressed", () => {
    expect(parseAddressedTo(undefined)).toEqual({ agentRefs: [], gaids: [], roles: [], sessions: [], invalid: [] });
  });
});

describe("computeRoomMessageHop", () => {
  it("starts a human message at hop 0", () => {
    expect(computeRoomMessageHop({ senderType: "user", recent: [{ addressing: addressing({ hop: 5 }) }] })).toBe(0);
  });

  it("puts an agent reply one hop past the newest message addressed to it", () => {
    const recent = [
      { addressing: addressing({ agents: ["AGT-C"], hop: 7 }) },
      { addressing: addressing({ agents: ["AGT-A"], hop: 3 }) },
      { addressing: addressing({ agents: ["AGT-A"], hop: 1 }) },
    ];
    expect(computeRoomMessageHop({ senderType: "agent", senderAgentId: "AGT-A", recent })).toBe(4);
  });

  it("starts an agent at hop 0 when nothing was addressed to it", () => {
    expect(computeRoomMessageHop({ senderType: "agent", senderAgentId: "AGT-A", recent: [{ addressing: null }] })).toBe(0);
  });
});

describe("planRoomWake", () => {
  it("wakes the addressed coworkers, never the sender", () => {
    const plan = planRoomWake({ ...base, addressing: addressing({ agents: ["AGT-A", "AGT-B"] }) });
    expect(plan).toMatchObject({ kind: "wake", agents: ["AGT-B"], reason: "addressed" });
  });

  it("resolves addressed roles to the agents holding them", () => {
    const plan = planRoomWake({
      ...base,
      addressing: addressing({ agents: [], roles: ["coordinator"] }),
      roleAgents: { coordinator: ["AGT-COORD"] },
    });
    expect(plan).toMatchObject({ kind: "wake", agents: ["AGT-COORD"] });
  });

  it("holds the wake for a room an external executor is working (AC-2)", () => {
    const plan = planRoomWake({ ...base, addressing: addressing(), executor: { kind: "claude-desktop", ref: "sess-1" } });
    expect(plan.kind).toBe("hold");
    expect(plan.detail).toContain("claude-desktop");
  });

  it("never schedules a platform task for an external client agent", () => {
    const external = new Set(["AGT-EXT-CLAUDE"]);
    const only = planRoomWake({ ...base, externalAgentIds: external, addressing: addressing({ agents: ["AGT-EXT-CLAUDE"] }) });
    expect(only.kind).toBe("hold");
    expect(only.detail).toContain("AGT-EXT-CLAUDE");
    const mixed = planRoomWake({ ...base, externalAgentIds: external, addressing: addressing({ agents: ["AGT-EXT-CLAUDE", "AGT-B"] }) });
    expect(mixed).toMatchObject({ kind: "wake", agents: ["AGT-B"] });
  });

  it("dispatches into a Build Studio room as it would an unclaimed one", () => {
    const plan = planRoomWake({ ...base, addressing: addressing(), executor: { kind: "build-studio", ref: null } });
    expect(plan.kind).toBe("wake");
  });

  it("wakes the coordinator, not the addressee, at the hop limit (AC-4)", () => {
    const plan = planRoomWake({ ...base, addressing: addressing({ hop: 8 }) });
    expect(plan).toMatchObject({ kind: "wake", agents: ["AGT-COORD"], reason: "hop-limit" });
  });

  it("stops the exchange at the hop limit when no coworker coordinates the room", () => {
    const plan = planRoomWake({ ...base, coordinatorAgentIds: [], addressing: addressing({ hop: 9 }) });
    expect(plan.kind).toBe("none");
    expect(plan.detail).toContain("hop limit");
  });

  it("pauses at the room's hourly wake budget (AC-4)", () => {
    const plan = planRoomWake({ ...base, addressing: addressing(), wakesLastHour: 30 });
    expect(plan.kind).toBe("pause");
  });
});

describe("wake windows", () => {
  it("gives every wake for one recipient in one 15-second window the same id", () => {
    const a = new Date("2026-11-11T00:00:01.000Z");
    const b = new Date("2026-11-11T00:00:14.000Z");
    const c = new Date("2026-11-11T00:00:16.000Z");
    expect(roomWakeEventId("wi", "AGT-B", a)).toBe(roomWakeEventId("wi", "AGT-B", b));
    expect(roomWakeEventId("wi", "AGT-B", a)).not.toBe(roomWakeEventId("wi", "AGT-B", c));
    expect(roomWakeWindow(a).closesAt.toISOString()).toBe("2026-11-11T00:00:15.000Z");
  });

  it("builds a cron the scheduler treats as one-shot", () => {
    expect(isOneShotCron(oneShotCronAt(new Date("2026-11-11T04:05:00.000Z")))).toBe(true);
  });
});

describe("readRoomMessageAddressing", () => {
  it("round-trips what the writer stores and ignores messages without it", () => {
    const stored = addressing({ roles: ["accountable"], hop: 2, senderGaid: "gaid:priv:dpf.internal:agt-a" });
    expect(readRoomMessageAddressing({ addressing: stored })).toEqual(stored);
    expect(readRoomMessageAddressing({ mentionedAgentIds: ["AGT-B"] })).toBeNull();
    expect(readRoomMessageAddressing(null)).toBeNull();
  });
});
