import { describe, expect, it } from "vitest";

import {
  buildWardBoard,
  reconcileAgainstPopulation,
  summarizeKennelCapacity,
  UNGROUPED_AREA,
  type KennelRow,
  type OccupancyRow,
} from "./ward-occupancy";

function kennel(over: Partial<KennelRow> & Pick<KennelRow, "id" | "label">): KennelRow {
  return {
    serviceArea: "Dog ward",
    capacity: 1,
    blockedReason: null,
    lifecycle: "active",
    ...over,
  };
}

function occupancy(over: Partial<OccupancyRow> & Pick<OccupancyRow, "resourceId" | "demandRef">): OccupancyRow {
  return { startsAt: new Date("2026-09-01T08:00:00Z"), releasedAt: null, ...over };
}

describe("buildWardBoard", () => {
  it("places each animal in its kennel and counts what is free", () => {
    const board = buildWardBoard({
      kennels: [
        kennel({ id: "k1", label: "D1" }),
        kennel({ id: "k2", label: "D2" }),
        kennel({ id: "k3", label: "D3" }),
      ],
      occupancy: [occupancy({ resourceId: "k1", demandRef: "animal-ranger" })],
      animalNames: new Map([["animal-ranger", "Ranger"]]),
    });

    expect(board.totalUnits).toBe(3);
    expect(board.occupied).toBe(1);
    expect(board.free).toBe(2);
    const d1 = board.zones[0]?.units.find((unit) => unit.label === "D1");
    expect(d1?.animalName).toBe("Ranger");
    expect(d1?.state).toBe("occupied");
    expect(board.zones[0]?.units.find((unit) => unit.label === "D2")?.state).toBe("free");
  });

  it("treats a released allocation as history, not as an occupant", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "D1" })],
      occupancy: [
        occupancy({
          resourceId: "k1",
          demandRef: "animal-scout",
          releasedAt: new Date("2026-09-01T17:00:00Z"),
        }),
      ],
      animalNames: new Map([["animal-scout", "Scout"]]),
    });

    expect(board.occupied).toBe(0);
    expect(board.free).toBe(1);
    // Scout is still in care but no longer housed — that must be visible.
    expect(board.unplaced).toEqual([{ animalRef: "animal-scout", name: "Scout" }]);
  });

  it("keeps an out-of-service unit out of the free count", () => {
    const board = buildWardBoard({
      kennels: [
        kennel({ id: "k1", label: "D1", blockedReason: "Deep clean after parvo" }),
        kennel({ id: "k2", label: "D2" }),
      ],
      occupancy: [],
      animalNames: new Map(),
    });

    expect(board.free).toBe(1);
    expect(board.outOfService).toBe(1);
    const blocked = board.zones[0]?.units.find((unit) => unit.label === "D1");
    expect(blocked?.state).toBe("out-of-service");
    expect(blocked?.blockedReason).toBe("Deep clean after parvo");
  });

  it("names animals in care that have no kennel recorded", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "D1" })],
      occupancy: [occupancy({ resourceId: "k1", demandRef: "a1" })],
      animalNames: new Map([
        ["a1", "Ranger"],
        ["a2", "Saffron"],
        ["a3", "Pip"],
      ]),
    });

    expect(board.occupied).toBe(1);
    expect(board.unplaced.map((row) => row.name).sort()).toEqual(["Pip", "Saffron"]);
  });

  it("does not name a ghost when the occupant's animal row is gone", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "D1" })],
      occupancy: [occupancy({ resourceId: "k1", demandRef: "deleted-animal" })],
      animalNames: new Map(),
    });

    const unit = board.zones[0]?.units[0];
    expect(unit?.animalName).toBeNull();
    expect(unit?.state).toBe("free");
    expect(board.occupied).toBe(0);
  });

  it("groups by the shelter's own area names and orders units naturally", () => {
    const board = buildWardBoard({
      kennels: [
        kennel({ id: "k10", label: "D10", serviceArea: "Dog ward" }),
        kennel({ id: "k2", label: "D2", serviceArea: "Dog ward" }),
        kennel({ id: "c1", label: "C1", serviceArea: "Cat room" }),
      ],
      occupancy: [],
      animalNames: new Map(),
    });

    expect(board.zones.map((zone) => zone.area)).toEqual(["Cat room", "Dog ward"]);
    // D2 before D10 — a shelter counts its runs, it does not sort them as text.
    expect(board.zones[1]?.units.map((unit) => unit.label)).toEqual(["D2", "D10"]);
  });

  it("gives ungrouped housing a readable area rather than an empty heading", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "1", serviceArea: null })],
      occupancy: [],
      animalNames: new Map(),
    });

    expect(board.zones[0]?.area).toBe(UNGROUPED_AREA);
  });

  it("shows the most recent occupant when a unit holds two open allocations, and strands the other", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "D1" })],
      occupancy: [
        occupancy({ resourceId: "k1", demandRef: "a1", startsAt: new Date("2026-09-01T08:00:00Z") }),
        occupancy({ resourceId: "k1", demandRef: "a2", startsAt: new Date("2026-09-01T12:00:00Z") }),
      ],
      animalNames: new Map([
        ["a1", "Ranger"],
        ["a2", "Willow"],
      ]),
    });

    expect(board.zones[0]?.units[0]?.animalName).toBe("Willow");
    // The double booking is not hidden: Ranger surfaces as unplaced.
    expect(board.unplaced).toEqual([{ animalRef: "a1", name: "Ranger" }]);
  });
});

describe("summarizeKennelCapacity", () => {
  it("answers how many kennels are free", () => {
    const board = buildWardBoard({
      kennels: [
        kennel({ id: "k1", label: "D1" }),
        kennel({ id: "k2", label: "D2" }),
        kennel({ id: "k3", label: "D3", blockedReason: "Repair" }),
      ],
      occupancy: [occupancy({ resourceId: "k1", demandRef: "a1" })],
      animalNames: new Map([["a1", "Ranger"]]),
    });

    expect(summarizeKennelCapacity(board)).toEqual({
      total: 3,
      free: 1,
      occupied: 1,
      outOfService: 1,
    });
  });

  it("distinguishes a shelter with no housing recorded from one with none free", () => {
    const empty = buildWardBoard({ kennels: [], occupancy: [], animalNames: new Map() });
    expect(summarizeKennelCapacity(empty)).toBeNull();
    expect(summarizeKennelCapacity(null)).toBeNull();
  });
});

describe("reconcileAgainstPopulation", () => {
  it("reports placed against the population the cockpit already counts", () => {
    const board = buildWardBoard({
      kennels: [kennel({ id: "k1", label: "D1" })],
      occupancy: [occupancy({ resourceId: "k1", demandRef: "a1" })],
      animalNames: new Map([
        ["a1", "Ranger"],
        ["a2", "Saffron"],
      ]),
    });

    expect(
      reconcileAgainstPopulation(board, { total: 2, onHold: 1, available: 1, pending: 0 }),
    ).toEqual({ placed: 1, unplaced: 1, inCare: 2 });
  });

  it("reconciles nothing when either side is unreadable", () => {
    expect(reconcileAgainstPopulation(null, { total: 2, onHold: 0, available: 2, pending: 0 })).toBeNull();
    const board = buildWardBoard({ kennels: [], occupancy: [], animalNames: new Map() });
    expect(reconcileAgainstPopulation(board, null)).toBeNull();
  });
});
