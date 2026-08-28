import { describe, expect, it } from "vitest";

import type { TwinSnapshot } from "@/components/twin";

import { restaurantBusyShiftFixture } from "./__fixtures__/restaurant-busy-shift";
import {
  createVersionedOperationsSnapshot,
  selectOperationsActivity,
  selectOperationsQueues,
  selectOperationsScene,
  selectOperationsSummary,
  toLivingBusinessSnapshot,
} from "./operations-snapshot";

function twinFixture(): TwinSnapshot {
  return {
    capacityChips: [{ key: "open", label: "Tables open", value: 4 }],
    stageFlow: [{ stageKey: "serve", label: "Serve", order: 1, loadBearing: true, observable: true, count: 2 }],
    outcomes: [{ key: "served", label: "Served", value: "12" }],
    outcomesHeading: "Guest outcomes",
    zones: [{ key: "floor", units: [{ key: "t1", label: "Table 1", state: "Available" }] }],
    workItems: [{ key: "b1", label: "Party · Table 2" }],
    queues: [{ key: "waitlist", items: [{ key: "p1", label: "Party of 4" }] }],
    cog: { proposal: "Seat Party of 4 at Table 1" },
    presence: [{ name: "Alex", kind: "human" }],
    feed: [{ key: "f1", actor: { name: "Alex", kind: "human" }, action: "seated a party" }],
    quests: [{ key: "q1", title: "Seat waiting party", detail: "Table 1 fits", intent: "warning" }],
    utility: [{ key: "turns", label: "Turns", value: "3" }],
  };
}

describe("VersionedOperationsSnapshot", () => {
  it("partitions the hot path into bounded selectors and preserves the compatibility shape", () => {
    const twin = twinFixture();
    const snapshot = createVersionedOperationsSnapshot({
      identity: {
        archetypeId: "restaurant",
        archetypeName: "Restaurant",
        template: "FLOOR",
      },
      twin,
      asOf: "2026-07-28T18:00:00.000Z",
      sourceWatermarks: [
        { source: "bookings", observedAt: "2026-07-28T17:59:58.000Z" },
        { source: "resources", observedAt: "2026-07-28T17:59:57.000Z" },
      ],
      degradedSources: [],
      telemetry: { durationMs: 42, queryCount: 9, payloadBytes: 1_024 },
    });

    expect(selectOperationsSummary(snapshot)).toEqual({
      capacityChips: twin.capacityChips,
      stageFlow: twin.stageFlow,
      outcomes: twin.outcomes,
      outcomesHeading: twin.outcomesHeading,
      quests: twin.quests,
      utility: twin.utility,
    });
    expect(selectOperationsScene(snapshot)).toEqual({
      zones: twin.zones,
      workItems: twin.workItems,
    });
    expect(selectOperationsQueues(snapshot)).toEqual({
      queues: twin.queues,
      cog: twin.cog,
      conflicts: [],
    });
    expect(selectOperationsActivity(snapshot)).toEqual({
      presence: twin.presence,
      feed: twin.feed,
    });
    expect(toLivingBusinessSnapshot(snapshot)).toMatchObject({
      live: true,
      archetypeId: "restaurant",
      template: "FLOOR",
      ...twin,
    });
    expect(snapshot.sourceWatermark).toBe("2026-07-28T17:59:57.000Z");
    expect(snapshot.freshness).toBe("current");
  });

  it("derives a stable version from source facts and exposes degraded sources explicitly", () => {
    const input = {
      identity: {
        archetypeId: "restaurant",
        archetypeName: "Restaurant",
        template: "FLOOR" as const,
      },
      twin: twinFixture(),
      asOf: "2026-07-28T18:00:00.000Z",
      sourceWatermarks: [{ source: "bookings", observedAt: "2026-07-28T17:59:58.000Z" }],
      degradedSources: [{ source: "invoices", reason: "query-failed" }],
      telemetry: { durationMs: 10, queryCount: 9, payloadBytes: 512 },
    };

    const first = createVersionedOperationsSnapshot(input);
    const second = createVersionedOperationsSnapshot({ ...input, telemetry: { ...input.telemetry, durationMs: 99 } });
    const changed = createVersionedOperationsSnapshot({
      ...input,
      twin: {
        ...input.twin,
        queues: [{ key: "waitlist", items: [] }],
      },
    });

    expect(first.version).toBe(second.version);
    expect(changed.version).not.toBe(first.version);
    expect(first.freshness).toBe("degraded");
    expect(first.degradedSources).toEqual([{ source: "invoices", reason: "query-failed" }]);
  });

  it("uses the oldest participating watermark for bounded-staleness truth", () => {
    const snapshot = createVersionedOperationsSnapshot({
      identity: {
        archetypeId: "restaurant",
        archetypeName: "Restaurant",
        template: "FLOOR",
      },
      twin: twinFixture(),
      asOf: "2026-07-28T18:00:00.000Z",
      sourceWatermarks: [
        { source: "bookings", observedAt: "2026-07-28T17:59:58.000Z" },
        { source: "resources", observedAt: "2026-07-28T17:58:00.000Z" },
      ],
      degradedSources: [],
      telemetry: { durationMs: 42, queryCount: 9, payloadBytes: 1_024 },
      maxSourceAgeMs: 30_000,
    });

    expect(snapshot.sourceWatermark).toBe("2026-07-28T17:58:00.000Z");
    expect(snapshot.freshness).toBe("stale");
  });

  it("carries the complete restaurant busy-shift pressure fixture through bounded slices", () => {
    const twin = restaurantBusyShiftFixture();
    const snapshot = createVersionedOperationsSnapshot({
      identity: {
        archetypeId: "restaurant",
        archetypeName: "Restaurant",
        template: "FLOOR",
      },
      twin,
      asOf: "2026-07-28T18:21:00.000Z",
      sourceWatermarks: [
        { source: "bookings", observedAt: "2026-07-28T18:20:59.000Z" },
        { source: "resources", observedAt: "2026-07-28T18:20:59.000Z" },
      ],
      degradedSources: [],
      telemetry: { durationMs: 48, queryCount: 10, payloadBytes: 4_096 },
    });

    const units = selectOperationsScene(snapshot).zones.flatMap((zone) => zone.units);
    expect(units.map((unit) => unit.state)).toEqual(
      expect.arrayContaining(["Available", "Seated", "Dirty", "Blocked", "Combined", "Turning soon"]),
    );
    expect(units.find((unit) => unit.state === "Turning soon")?.sublabel).toContain("late");
    expect(units.filter((unit) => unit.owner?.name === "Alex")).toHaveLength(5);
    expect(units.filter((unit) => unit.owner?.name === "Sam")).toHaveLength(1);

    const queues = selectOperationsQueues(snapshot).queues;
    expect(queues.find((queue) => queue.key === "waitlist")?.items).toHaveLength(2);
    expect(queues.find((queue) => queue.key === "reservations")?.items).toHaveLength(1);
    expect(snapshot.queue.cog?.signals).toContain("server imbalance");
  });
});
