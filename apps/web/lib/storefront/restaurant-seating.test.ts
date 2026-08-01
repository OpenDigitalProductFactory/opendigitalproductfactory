import { describe, expect, it } from "vitest";

import {
  evaluateRestaurantSeating,
  findRestaurantSeatingAlternatives,
  restaurantSeatingVersion,
  type RestaurantSeatingAllocationFact,
  type RestaurantSeatingResourceFact,
} from "./restaurant-seating";

const startsAt = new Date("2026-07-31T18:00:00.000Z");
const endsAt = new Date("2026-07-31T19:15:00.000Z");

function table(
  id: string,
  overrides: Partial<RestaurantSeatingResourceFact> = {},
): RestaurantSeatingResourceFact {
  return {
    id,
    label: id.toUpperCase(),
    status: "active",
    capacity: 2,
    version: 1,
    attributes: {
      shape: "square",
      combinationGroup: "main",
      combinableWith: [],
    },
    ...overrides,
  };
}

describe("restaurant seating decision", () => {
  it("accepts one compatible open table", () => {
    expect(
      evaluateRestaurantSeating({
        covers: 2,
        resources: [table("t1")],
        allocations: [],
        startsAt,
        endsAt,
      }),
    ).toEqual({ ok: true, capacity: 2 });
  });

  it("accepts combined tables only when their structural contract agrees", () => {
    expect(
      evaluateRestaurantSeating({
        covers: 4,
        resources: [table("t1"), table("t2")],
        allocations: [],
        startsAt,
        endsAt,
      }),
    ).toEqual({ ok: true, capacity: 4 });

    expect(
      evaluateRestaurantSeating({
        covers: 4,
        resources: [
          table("t1", {
            attributes: {
              shape: "square",
              combinationGroup: "main",
              combinableWith: [],
            },
          }),
          table("t2", {
            attributes: {
              shape: "square",
              combinationGroup: "patio",
              combinableWith: [],
            },
          }),
        ],
        allocations: [],
        startsAt,
        endsAt,
      }),
    ).toEqual({
      ok: false,
      reasonCode: "tables-not-combinable",
      message: "The selected tables are not configured to combine.",
    });
  });

  it("rejects blocked, undersized, and already-allocated tables", () => {
    expect(
      evaluateRestaurantSeating({
        covers: 2,
        resources: [table("t1", { status: "blocked" })],
        allocations: [],
        startsAt,
        endsAt,
      }),
    ).toMatchObject({ ok: false, reasonCode: "table-unavailable" });

    expect(
      evaluateRestaurantSeating({
        covers: 3,
        resources: [table("t1")],
        allocations: [],
        startsAt,
        endsAt,
      }),
    ).toMatchObject({ ok: false, reasonCode: "insufficient-capacity" });

    const allocation: RestaurantSeatingAllocationFact = {
      id: "allocation-1",
      resourceId: "t1",
      startsAt: new Date("2026-07-31T17:30:00.000Z"),
      endsAt: new Date("2026-07-31T18:30:00.000Z"),
      lifecycle: "active",
      version: 3,
    };
    expect(
      evaluateRestaurantSeating({
        covers: 2,
        resources: [table("t1")],
        allocations: [allocation],
        startsAt,
        endsAt,
      }),
    ).toMatchObject({ ok: false, reasonCode: "table-conflict" });
  });

  it("allows the same demand to activate its existing reservation allocation", () => {
    expect(
      evaluateRestaurantSeating({
        covers: 2,
        resources: [table("t1")],
        allocations: [
          {
            id: "allocation-1",
            resourceId: "t1",
            startsAt,
            endsAt,
            lifecycle: "reserved",
            version: 1,
            demandRef: "BOOK-1",
          },
        ],
        startsAt,
        endsAt,
        demandRef: "BOOK-1",
      }),
    ).toEqual({ ok: true, capacity: 2 });
  });

  it("derives a stable concurrency token independent of query order", () => {
    const input = {
      demand: {
        id: "booking-1",
        updatedAt: new Date("2026-07-31T17:55:00.000Z"),
        status: "waiting",
      },
      resources: [table("t2", { version: 4 }), table("t1", { version: 2 })],
      allocations: [
        {
          id: "a2",
          resourceId: "t2",
          startsAt,
          endsAt,
          lifecycle: "reserved" as const,
          version: 1,
        },
        {
          id: "a1",
          resourceId: "t1",
          startsAt,
          endsAt,
          lifecycle: "active" as const,
          version: 3,
        },
      ],
    };

    expect(restaurantSeatingVersion(input)).toBe(
      restaurantSeatingVersion({
        ...input,
        resources: [...input.resources].reverse(),
        allocations: [...input.allocations].reverse(),
      }),
    );
    expect(
      restaurantSeatingVersion({
        ...input,
        resources: [table("t2", { version: 5 }), table("t1", { version: 2 })],
      }),
    ).not.toBe(restaurantSeatingVersion(input));
  });

  it("returns the smallest currently valid single or combined alternatives", () => {
    const alternatives = findRestaurantSeatingAlternatives({
      covers: 4,
      resources: [
        table("t1", { capacity: 2, attributes: { combinationGroup: "a" } }),
        table("t2", { capacity: 2, attributes: { combinationGroup: "a" } }),
        table("t3", {
          capacity: 4,
          label: "Table 3",
          attributes: { shape: "round" },
        }),
        table("t4", {
          capacity: 6,
          label: "Table 4",
          attributes: { shape: "round" },
        }),
        table("t5", {
          capacity: 4,
          label: "Occupied",
          attributes: { shape: "round" },
        }),
      ],
      allocations: [
        {
          id: "occupied",
          resourceId: "t5",
          startsAt,
          endsAt,
          lifecycle: "active",
          version: 1,
          demandRef: "OTHER",
        },
      ],
      startsAt,
      endsAt,
      demandRef: "BOOK-1",
      excludeResourceIds: ["t3"],
      limit: 3,
    });

    expect(alternatives).toEqual([
      { resourceIds: ["t1", "t2"], label: "T1 + T2" },
      { resourceIds: ["t4"], label: "Table 4" },
    ]);
  });
});
