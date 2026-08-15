import { describe, expect, it } from "vitest";

import { buildRestaurantDemoFloorPlan } from "./restaurant-demo-floor";

const bookings = Array.from({ length: 9 }, (_, index) => ({
  id: `booking-${index}`,
  bookingRef: `demo-restaurant-bk-${index}`,
}));
const employees = [
  { id: "employee-floor", displayName: "Chloe Tan", role: "Floor Manager" },
  { id: "employee-leo", displayName: "Leo Marchetti", role: "Server" },
  { id: "employee-maya", displayName: "Maya Okafor", role: "Server" },
];

describe("buildRestaurantDemoFloorPlan", () => {
  it("authors realistic areas, capacities, shapes, and a combinable pair", () => {
    const plan = buildRestaurantDemoFloorPlan({
      bookings,
      employees,
      now: new Date("2026-08-08T18:00:00.000Z"),
      timezone: "America/Chicago",
    });

    expect(new Set(plan.tables.map((table) => table.serviceArea))).toEqual(
      new Set(["Main dining", "Window room", "Patio"]),
    );
    expect(plan.tables.map((table) => table.capacity)).toEqual([
      4, 4, 2, 4, 4, 4, 2, 4, 6,
    ]);
    expect(plan.tables.find((table) => table.key === "table-4")).toMatchObject({
      status: "blocked",
      blockedReason: "Chair repair",
    });
    expect(plan.tables.find((table) => table.key === "table-5")?.attributes)
      .toMatchObject({ combinationGroup: "banquet-a", combinableWith: ["table-6"] });
  });

  it("carries the full host-stand busy shift without seeding sensitive guest notes", () => {
    const plan = buildRestaurantDemoFloorPlan({
      bookings,
      employees,
      now: new Date("2026-08-08T18:00:00.000Z"),
      timezone: "America/Chicago",
    });

    expect(plan.bookings[0]).toMatchObject({
      demandKind: "walk-in",
      covers: 3,
      status: "waiting",
      createdAt: new Date("2026-08-08T17:46:00.000Z"),
    });
    expect(plan.bookings[1]).toMatchObject({
      demandKind: "reservation",
      covers: 4,
      status: "confirmed",
      scheduledAt: new Date("2026-08-08T18:09:00.000Z"),
    });
    expect(plan.turns.map((turn) => turn.stage)).toEqual([
      "ordered",
      "dirty",
      "ordered",
      "paid",
      "seated",
    ]);
    expect(plan.turns.find((turn) => turn.bookingId === "booking-4")?.tableKeys)
      .toEqual(["table-5", "table-6"]);
    expect(plan.bookings.every((booking) => booking.dietaryNotes === null)).toBe(true);
  });

  it("creates two published server sections with every table assigned once", () => {
    const now = new Date("2026-08-08T18:00:00.000Z");
    const plan = buildRestaurantDemoFloorPlan({
      bookings,
      employees,
      now,
      timezone: "America/Chicago",
    });

    expect(plan.serverSections).toHaveLength(2);
    expect(plan.serverSections.map((section) => section.employeeId)).toEqual([
      "employee-leo",
      "employee-maya",
    ]);
    expect(plan.serverSections.flatMap((section) => section.tableKeys).sort())
      .toEqual(plan.tables.map((table) => table.key).sort());
    expect(
      plan.serverSections.every(
        (section) => section.endAt.getTime() - now.getTime() > 365 * 24 * 60 * 60_000,
      ),
    ).toBe(true);
  });
});
