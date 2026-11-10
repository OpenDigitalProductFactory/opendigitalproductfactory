import { describe, expect, it, vi } from "vitest";
import {
  COO_BROADCAST_ACK_KIND,
  COO_BROADCAST_ASK_KIND,
  containsDescendants,
  missingCooBroadcastAcks,
  planCooBroadcast,
  planCooBroadcastAck,
} from "./coo-broadcast";

const EDGES = [
  { fromWorkroomId: "root", toWorkroomId: "child", relation: "contains" as const },
  { fromWorkroomId: "child", toWorkroomId: "leaf", relation: "contains" as const },
  { fromWorkroomId: "root", toWorkroomId: "other", relation: "depends-on" as const },
];

describe("COO broadcast-with-ack", () => {
  it("fans out down contains, including the root, and ignores depends-on", () => {
    expect(containsDescendants("root", EDGES).sort()).toEqual(["child", "leaf"]);
    const plan = planCooBroadcast({
      rootRoomId: "root",
      body: "Pause new intake.",
      commandKey: "ask-1",
      edges: EDGES,
    });
    expect(plan.targets.map((row) => row.roomId).sort()).toEqual(["child", "leaf", "root"]);
    expect(plan.dispatchInvoked).toBe(false);
    expect(plan.asks.every((ask) => ask.kind === COO_BROADCAST_ASK_KIND && ask.commandKey === "ask-1")).toBe(true);
  });

  it("records an acknowledgement against the shared command key for one room", () => {
    const ack = planCooBroadcastAck({ roomId: "child", commandKey: "ask-1" });
    expect(ack).toMatchObject({
      kind: COO_BROADCAST_ACK_KIND,
      roomId: "child",
      commandKey: "ask-1",
      dispatchInvoked: false,
    });
  });

  it("reports rooms that were asked and have not acknowledged", () => {
    const plan = planCooBroadcast({
      rootRoomId: "root",
      body: "Status please.",
      commandKey: "ask-2",
      edges: EDGES,
    });
    expect(missingCooBroadcastAcks(plan.asks, [
      { commandKey: "ask-2", roomId: "root" },
    ]).map((row) => row.roomId).sort()).toEqual(["child", "leaf"]);
  });

  it("never invokes a stage dispatcher while planning an ask or an ack", () => {
    const dispatch = vi.fn();
    planCooBroadcast({ rootRoomId: "root", body: "Ask", commandKey: "ask-3", edges: EDGES, dispatch });
    planCooBroadcastAck({ roomId: "root", commandKey: "ask-3", dispatch });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stops a contains cycle instead of walking forever", () => {
    const cyclic = [
      { fromWorkroomId: "a", toWorkroomId: "b", relation: "contains" as const },
      { fromWorkroomId: "b", toWorkroomId: "a", relation: "contains" as const },
    ];
    expect(containsDescendants("a", cyclic)).toEqual(["b"]);
  });
});
