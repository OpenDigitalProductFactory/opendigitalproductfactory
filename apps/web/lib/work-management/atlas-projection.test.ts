import { describe, expect, it } from "vitest";
import { projectWorkroomOperatorSummary } from "@/lib/work-capsules/workroom-operator-summary";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import {
  ATLAS_TITLE_MAX,
  projectAtlas,
  projectAtlasRoom,
  type AtlasInventoryRoom,
} from "./atlas-projection";

const owner: EffectiveHumanAccountability = { state: "resolved", principalId: "P-1", source: "organization-owner", inheritedFrom: [] };

function room(overrides: Partial<AtlasInventoryRoom> = {}): AtlasInventoryRoom {
  return {
    capsuleId: "WC-1A2B3C4D",
    title: "Invoice matching tolerance",
    status: "working",
    liveness: "live",
    isLive: true,
    portfolioRole: "manufactureAndDeliver",
    trueLivenessAt: "2026-11-03T17:00:00.000Z",
    drive: null,
    stageKey: null,
    ...overrides,
  };
}

describe("atlas room tuple", () => {
  it("takes its health from the shared operator summary, never its own rule", () => {
    const inputs = [
      room(),
      room({ liveness: "durable-wait" }),
      room({ liveness: "stalled" }),
      room({ isLive: false, liveness: "no-signal" }),
      room({ status: "ready-for-promotion" }),
      room({ isLive: false, liveness: "lease-expired" }),
      room({ drive: { action: "pause", reason: "executor_writeback_unavailable" } }),
    ];
    for (const input of inputs) {
      const expected = projectWorkroomOperatorSummary({ ...input, accountability: owner, drive: input.drive ?? undefined });
      expect(projectAtlasRoom(input, { accountability: owner, accountableDisplayName: "Mark" })).toMatchObject({
        health: expected.health,
        label: expected.label,
      });
    }
  });

  it("names a room with no portfolio as not yet placed rather than dropping it", () => {
    expect(projectAtlasRoom(room({ portfolioRole: null }), undefined).portfolio).toBe("unplaced");
  });

  it("caps long titles so one room cannot swell the whole picture", () => {
    const tuple = projectAtlasRoom(room({ title: "x".repeat(500) }), undefined);
    expect(tuple.title.length).toBeLessThanOrEqual(ATLAS_TITLE_MAX);
    expect(tuple.title.endsWith("…")).toBe(true);
  });

  it("carries the accountable person and the current stage when recorded", () => {
    expect(projectAtlasRoom(room({ stageKey: "implement" }), { accountability: owner, accountableDisplayName: "Mark" }))
      .toMatchObject({ owner: "Mark", stage: "implement", lastSignalAt: "2026-11-03T17:00:00.000Z" });
  });

  it("leaves owner and stage out rather than inventing them", () => {
    const tuple = projectAtlasRoom(room(), undefined);
    expect(tuple).not.toHaveProperty("owner");
    expect(tuple).not.toHaveProperty("stage");
  });
});

describe("atlas projection", () => {
  it("counts every room once by health", () => {
    const atlas = projectAtlas({
      rooms: [room({ capsuleId: "WC-A" }), room({ capsuleId: "WC-B", liveness: "stalled" }), room({ capsuleId: "WC-C", liveness: "paused" })],
      owners: new Map(),
      limit: 10,
      observedAt: new Date("2026-11-03T17:30:00.000Z"),
    });
    expect(atlas.counts).toEqual({ "needs-person": 0, stuck: 1, working: 1, waiting: 1, "no-signal": 0, finished: 0 });
    expect(atlas.total).toBe(3);
    expect(atlas.truncated).toBe(false);
  });

  it("says when the read stopped at its limit instead of implying it saw everything", () => {
    const rooms = Array.from({ length: 6 }, (_, i) => room({ capsuleId: `WC-${i}` }));
    const atlas = projectAtlas({ rooms, owners: new Map(), limit: 5, observedAt: new Date() });
    expect(atlas.rooms).toHaveLength(5);
    expect(atlas.truncated).toBe(true);
  });

  it("keeps 1,000 realistic rooms within the design's size budget", () => {
    const portfolios = ["manufactureAndDeliver", "productsAndServicesSold", "forEmployees", "foundational", null] as const;
    const rooms = Array.from({ length: 1000 }, (_, i) => room({
      capsuleId: `WC-${(0x10000000 + i).toString(16).toUpperCase()}`,
      title: `Work Atlas room number ${i} with a realistic title`,
      portfolioRole: portfolios[i % portfolios.length],
      stageKey: i % 3 === 0 ? "implement" : null,
    }));
    const owners = new Map(rooms.map((r) => [r.capsuleId, { accountability: owner, accountableDisplayName: "Mark Bodman" }]));
    const atlas = projectAtlas({ rooms, owners, limit: 2000, observedAt: new Date() });
    const bytesPerRoom = Buffer.byteLength(JSON.stringify(atlas.rooms)) / rooms.length;
    // Readable keys plus an 80-character title cost about 240 bytes; 1,000 rooms stay near 250 KB.
    expect(bytesPerRoom).toBeLessThan(250);
  });
});
