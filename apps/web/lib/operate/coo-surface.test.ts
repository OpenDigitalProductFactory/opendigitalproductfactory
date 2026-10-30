import { describe, expect, it } from "vitest";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "@dpf/validators/workroom/receipts";
import {
  ICS_SPAN_OF_CONTROL_MAX,
  lastCompletingReceiptAtFromDriveActivities,
  nextWakeAt,
  projectCooSurface,
  ticksSinceAdvance,
  type CooRoomInput,
} from "./coo-surface";

const NOW = new Date("2026-10-26T13:07:00.000Z");

const actor = (principalId: string, agentId?: string) => ({
  principalId,
  displayName: principalId,
  kind: agentId ? "agent" as const : "person" as const,
  agentId: agentId ?? null,
});

function room(partial: Partial<CooRoomInput> & Pick<CooRoomInput, "roomId">): CooRoomInput {
  return {
    title: partial.roomId,
    ownerPrincipalId: null,
    ownerDisplayName: null,
    ownerSource: "none",
    lastCycleKey: null,
    lastAction: null,
    lastReason: null,
    lastCompletingReceiptAt: null,
    paused: false,
    doNotWake: false,
    coordinators: [],
    ...partial,
  };
}

describe("COO surface projection", () => {
  it("keeps an unresolvable room unowned and never invents a stall recipient", () => {
    const result = projectCooSurface({
      rooms: [room({ roomId: "WC-OPEN" })],
      edges: [],
      agents: [],
      humanRoles: [],
      asks: [],
      acks: [],
      now: NOW,
    });
    expect(result.unowned.map((row) => row.roomId)).toEqual(["WC-OPEN"]);
    expect(result.rooms[0]).toMatchObject({
      roomId: "WC-OPEN",
      ownerPrincipalId: null,
      ownerIsSuggestion: false,
      stallRecipientPrincipalId: null,
    });
  });

  it("surfaces last cycle, last action, and ticks since a completing receipt", () => {
    const result = projectCooSurface({
      rooms: [room({
        roomId: "WC-RUN",
        ownerPrincipalId: "PRN-owner",
        ownerDisplayName: "Dana",
        ownerSource: "explicit-room",
        lastCycleKey: "shape@1:2026-10-26",
        lastAction: "dispatch_agent",
        lastReason: "agent_stage",
        lastCompletingReceiptAt: "2026-10-26T12:22:00.000Z",
        coordinators: [actor("PRN-owner")],
      })],
      edges: [],
      agents: [],
      humanRoles: [],
      asks: [],
      acks: [],
      now: NOW,
    });
    expect(result.rooms[0]).toMatchObject({
      lastCycleKey: "shape@1:2026-10-26",
      lastAction: "dispatch_agent",
      ticksSinceAdvance: 3,
      ownerPrincipalId: "PRN-owner",
      ownerIsSuggestion: false,
    });
  });

  it("counts workload against the ICS span of 7 and flags the eighth room", () => {
    expect(ICS_SPAN_OF_CONTROL_MAX).toBe(7);
    const rooms = Array.from({ length: 8 }, (_, i) => room({
      roomId: `WC-${i}`,
      ownerPrincipalId: "PRN-busy",
      ownerDisplayName: "Busy",
      ownerSource: "explicit-room",
    }));
    const result = projectCooSurface({ rooms, edges: [], agents: [], humanRoles: [], asks: [], acks: [], now: NOW });
    expect(result.rooms.every((row) => row.spanOfControl === 8 && row.overSpan)).toBe(true);
    expect(result.overSpanOwners).toEqual([{ principalId: "PRN-busy", displayName: "Busy", roomCount: 8 }]);
  });

  it("leaves next wake unknown when the room is paused or must not wake", () => {
    const paused = projectCooSurface({
      rooms: [room({ roomId: "WC-PAUSE", lastAction: "pause", paused: true })],
      edges: [], agents: [], humanRoles: [], asks: [], acks: [], now: NOW,
    });
    const sleeping = projectCooSurface({
      rooms: [room({ roomId: "WC-SLEEP", lastAction: "do_not_wake", doNotWake: true })],
      edges: [], agents: [], humanRoles: [], asks: [], acks: [], now: NOW,
    });
    expect(paused.rooms[0]!.nextWakeAt).toBeNull();
    expect(paused.paused.map((row) => row.roomId)).toEqual(["WC-PAUSE"]);
    expect(sleeping.rooms[0]!.nextWakeAt).toBeNull();
    expect(sleeping.paused).toEqual([]);
  });

  it("schedules the next 15-minute cadence boundary for a wakeable room", () => {
    expect(nextWakeAt(NOW, "dispatch_agent")?.toISOString()).toBe("2026-10-26T13:15:00.000Z");
    expect(nextWakeAt(NOW, "pause")).toBeNull();
    expect(nextWakeAt(NOW, "do_not_wake")).toBeNull();
  });

  it("walks the recorded escalation path and never pages a derived owner", () => {
    const result = projectCooSurface({
      rooms: [
        room({
          roomId: "child",
          ownerPrincipalId: "PRN-derived",
          ownerDisplayName: "Suggested",
          ownerSource: "organization-owner",
          coordinators: [actor("specialist", "AGT-101")],
        }),
        room({
          roomId: "parent",
          ownerPrincipalId: "PRN-human",
          ownerDisplayName: "Recorded human",
          ownerSource: "explicit-room",
          coordinators: [actor("PRN-human")],
        }),
      ],
      edges: [{ fromWorkroomId: "parent", toWorkroomId: "child", relation: "contains" }],
      agents: [
        { agentId: "AGT-101", displayName: "Specialist", escalatesTo: "HR-000" },
      ],
      humanRoles: [{
        roleId: "HR-000",
        displayName: "Accountable owner",
        holders: [actor("PRN-human")],
      }],
      asks: [],
      acks: [],
      now: NOW,
    });
    const child = result.rooms.find((row) => row.roomId === "child")!;
    expect(child.ownerIsSuggestion).toBe(true);
    expect(child.stallRecipientPrincipalId).toBe("PRN-human");
    expect(child.escalationLabel).toContain("PRN-human");
    expect(child.actionHref).toContain("work-capsule%3Achild");
  });

  it("reports missing broadcast acknowledgements without treating an ask as done", () => {
    const result = projectCooSurface({
      rooms: [room({ roomId: "WC-A" }), room({ roomId: "WC-B" })],
      edges: [],
      agents: [],
      humanRoles: [],
      asks: [
        { commandKey: "ask-1", roomId: "WC-A", recordedAt: NOW.toISOString() },
        { commandKey: "ask-1", roomId: "WC-B", recordedAt: NOW.toISOString() },
      ],
      acks: [{ commandKey: "ask-1", roomId: "WC-A", recordedAt: NOW.toISOString() }],
      now: NOW,
    });
    expect(result.missingAcks).toEqual([{ commandKey: "ask-1", roomId: "WC-B" }]);
    expect(result.rooms.find((row) => row.roomId === "WC-B")!.missingAckCount).toBe(1);
  });
});

describe("ticks since a completing drive receipt", () => {
  it("is unknown when no completing receipt exists", () => {
    expect(ticksSinceAdvance(NOW, null)).toBeNull();
    expect(lastCompletingReceiptAtFromDriveActivities([
      { recordedAt: NOW, payload: { receipts: [{ stageKey: "a", kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND }] } },
    ])).toBeNull();
  });

  it("uses the first appearance of the latest completing receipt, not later ticks that only repeat it", () => {
    const first = new Date("2026-10-26T12:00:00.000Z");
    const later = new Date("2026-10-26T12:45:00.000Z");
    const at = lastCompletingReceiptAtFromDriveActivities([
      { recordedAt: first, payload: { receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }] } },
      { recordedAt: later, payload: { receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }] } },
    ]);
    expect(at?.toISOString()).toBe(first.toISOString());
    expect(ticksSinceAdvance(NOW, at)).toBe(4);
  });
});
