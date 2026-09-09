import { describe, expect, it } from "vitest";

import {
  AnchorFailureBackoff,
  convergeWorkroomAnchors,
  type UnanchoredRoom,
  type WorkroomAnchorConvergerPorts,
} from "./workroom-anchor-converger";

// The three classes measured on the live install (BI-A5EEB5D1): a room whose
// backlog item already has a WorkItem, one whose backlog item has none, and one
// with no backlog item at all. All three must end up anchored, through the one
// canonical helper, without any of them being special-cased here.
function fakePorts(rooms: UnanchoredRoom[], opts: { failOn?: string } = {}) {
  const workItems = new Map<string, string>([["backlog-item:BI-HAS", "wi-existing"]]);
  const anchored = new Map<string, string>();
  let minted = 0;
  const ports: WorkroomAnchorConvergerPorts = {
    listUnanchoredRooms: async (limit) => rooms.slice(0, limit),
    findWorkItemBySource: async (sourceType, sourceId) => {
      const id = workItems.get(`${sourceType}:${sourceId}`);
      return id ? { id } : null;
    },
    resolveCanonicalQueueId: async () => "queue-anchor",
    createWorkItem: async (data) => {
      const id = `wi-new-${++minted}`;
      workItems.set(`${data.sourceType}:${data.sourceId}`, id);
      return { id };
    },
    setCapsuleWorkItem: async (capsuleId, workItemId) => {
      if (capsuleId === opts.failOn) throw new Error(`refused ${capsuleId}`);
      anchored.set(capsuleId, workItemId);
    },
  };
  return { ports, anchored, workItems };
}

describe("convergeWorkroomAnchors", () => {
  it("anchors all three measured classes through the canonical helper", async () => {
    const { ports, anchored, workItems } = fakePorts([
      { capsuleId: "WC-HAS", backlogItemId: "BI-HAS", title: "has a WorkItem" },
      { capsuleId: "WC-NONE", backlogItemId: "BI-NONE", title: "backlog item, no WorkItem" },
      { capsuleId: "WC-ADHOC", backlogItemId: null, title: "no backlog item" },
    ]);

    const result = await convergeWorkroomAnchors({ ports });

    expect(result).toMatchObject({ candidates: 3, anchored: 3, created: 2, failed: [] });
    // Linked to the existing case, not a second one for the same work.
    expect(anchored.get("WC-HAS")).toBe("wi-existing");
    // The backlog item's case was minted, and the room shares it.
    expect(anchored.get("WC-NONE")).toBe(workItems.get("backlog-item:BI-NONE"));
    // An ad-hoc room gets a stable capsule-keyed case, so the loader's
    // convention query resolves it.
    expect(anchored.get("WC-ADHOC")).toBe(workItems.get("work-capsule:WC-ADHOC"));
  });

  it("reports a room it could not anchor and carries on with the rest", async () => {
    const { ports, anchored } = fakePorts(
      [
        { capsuleId: "WC-BAD", backlogItemId: null, title: "bad" },
        { capsuleId: "WC-OK", backlogItemId: null, title: "ok" },
      ],
      { failOn: "WC-BAD" },
    );

    const result = await convergeWorkroomAnchors({ ports });

    expect(result.anchored).toBe(1);
    expect(result.failed).toEqual([{ capsuleId: "WC-BAD", reason: "refused WC-BAD" }]);
    expect(anchored.has("WC-OK")).toBe(true);
  });

  it("is bounded by the batch so a tick never sweeps the whole estate", async () => {
    const rooms = Array.from({ length: 5 }, (_, i) => ({
      capsuleId: `WC-${i}`,
      backlogItemId: null,
      title: `room ${i}`,
    }));
    const { ports } = fakePorts(rooms);

    const result = await convergeWorkroomAnchors({ ports, batch: 2 });

    expect(result.candidates).toBe(2);
    expect(result.anchored).toBe(2);
  });

  it("does nothing, and says so, when every room is already anchored", async () => {
    const { ports } = fakePorts([]);
    expect(await convergeWorkroomAnchors({ ports })).toEqual({
      candidates: 0,
      anchored: 0,
      created: 0,
      failed: [],
    });
  });

  it("backs off a room that failed, so an unfixable row is not hammered every tick", async () => {
    const rooms = [
      { capsuleId: "WC-STUCK", backlogItemId: null, title: "stuck" },
      { capsuleId: "WC-FINE", backlogItemId: null, title: "fine" },
    ];
    const { ports } = fakePorts(rooms, { failOn: "WC-STUCK" });
    const backoff = new AnchorFailureBackoff(1000);

    const first = await convergeWorkroomAnchors({ ports, backoff, now: 0 });
    expect(first.failed.map((f) => f.capsuleId)).toEqual(["WC-STUCK"]);

    // Next tick, inside the window: the stuck room is not even a candidate.
    const second = await convergeWorkroomAnchors({ ports, backoff, now: 500 });
    expect(second.candidates).toBe(1);
    expect(second.failed).toEqual([]);

    // After the window it is retried once more, and backs off again.
    const third = await convergeWorkroomAnchors({ ports, backoff, now: 1500 });
    expect(third.failed.map((f) => f.capsuleId)).toEqual(["WC-STUCK"]);
  });
});
