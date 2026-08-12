import { describe, expect, it, vi } from "vitest";

import {
  loadPublicRestaurantAvailabilityBySlug,
  loadPublicRestaurantAvailabilityBySlugSafe,
  loadRestaurantFloorOperationalView,
} from "./restaurant-floor-loader.server";
import { restaurantSeatingVersion } from "../storefront/restaurant-seating";

const now = new Date("2026-07-31T18:14:00.000Z");
const seatedBooking = {
  id: "booking-seated",
  bookingRef: "BOOK-SEATED",
  customerName: "Morgan Lee",
  customerEmail: "morgan@example.test",
  customerPhone: "555-0001",
  covers: 2,
  demandKind: "reservation",
  dietaryNotes: null,
  status: "seated",
  scheduledAt: new Date("2026-07-31T18:00:00.000Z"),
  durationMinutes: 75,
  createdAt: new Date("2026-07-31T17:00:00.000Z"),
  updatedAt: new Date("2026-07-31T18:00:00.000Z"),
};
const waitingBooking = {
  id: "booking-waiting",
  bookingRef: "WALKIN-14",
  customerName: "Alex Kim",
  customerEmail: "alex@example.test",
  customerPhone: "555-0002",
  covers: 2,
  demandKind: "walk-in",
  dietaryNotes: "nut allergy",
  status: "waiting",
  scheduledAt: now,
  durationMinutes: 60,
  createdAt: new Date("2026-07-31T18:00:00.000Z"),
  updatedAt: new Date("2026-07-31T18:00:00.000Z"),
};
const resources = [
  {
    id: "table-1",
    label: "Table 1",
    status: "active",
    capacity: 2,
    version: 1,
    serviceArea: "Main dining",
    blockedReason: null,
    attributes: {
      shape: "square",
      combinationGroup: "main",
      combinableWith: [],
    },
  },
  {
    id: "table-2",
    label: "Table 2",
    status: "active",
    capacity: 2,
    version: 3,
    serviceArea: "Main dining",
    blockedReason: null,
    attributes: {
      shape: "round",
      combinationGroup: "main",
      combinableWith: [],
    },
  },
];
const allocations = [
  {
    id: "allocation-1",
    resourceId: "table-1",
    startsAt: new Date("2026-07-31T18:00:00.000Z"),
    endsAt: new Date("2026-07-31T19:15:00.000Z"),
    lifecycle: "active",
    version: 2,
    demandRef: "BOOK-SEATED",
    serviceTurn: {
      id: "turn-1",
      turnId: "HT-TURN1",
      stage: "ordered",
      version: 2,
      startedAt: new Date("2026-07-31T18:00:00.000Z"),
      expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
      bookingId: "booking-seated",
    },
  },
];

function database() {
  return {
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue({
        id: "store-1",
        organizationId: "org-1",
        archetype: { archetypeId: "restaurant" },
      }),
    },
    hospitalityResource: {
      findMany: vi.fn().mockResolvedValue(resources),
    },
    hospitalityCapacityAllocation: {
      findMany: vi.fn().mockResolvedValue(allocations),
    },
    bookingHold: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    storefrontBooking: {
      findMany: vi.fn().mockResolvedValue([seatedBooking, waitingBooking]),
    },
    staffingResourceLink: {
      findMany: vi.fn().mockResolvedValue([
        {
          resourceRef: "table-1",
          shift: {
            assignments: [
              {
                id: "assignment-1",
                employeeProfileId: "employee-1",
                lifecycle: "on_site",
              },
            ],
          },
        },
        {
          resourceRef: "table-2",
          shift: {
            assignments: [
              {
                id: "assignment-1",
                employeeProfileId: "employee-1",
                lifecycle: "on_site",
              },
            ],
          },
        },
      ]),
    },
    employeeProfile: {
      findMany: vi.fn().mockResolvedValue([
        { id: "employee-1", displayName: "Jordan Rivera" },
      ]),
    },
  };
}

describe("restaurant floor operational loader", () => {
  it("joins turns, tables, waiting demand, and canonical staffing", async () => {
    const view = await loadRestaurantFloorOperationalView(database(), {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
    });

    expect(view.floor.tables).toEqual([
      expect.objectContaining({
        id: "table-1",
        state: "ordered",
        party: { id: "booking-seated", name: "Morgan Lee", covers: 2 },
        turn: {
          id: "turn-1",
          turnId: "HT-TURN1",
          stage: "ordered",
          version: 2,
        },
        server: expect.objectContaining({
          id: "assignment-1",
          name: "Jordan Rivera",
          tableCount: 2,
        }),
      }),
      expect.objectContaining({
        id: "table-2",
        state: "available",
      }),
    ]);
    expect(view.floor.demand).toEqual([
      expect.objectContaining({
        id: "booking-waiting",
        kind: "walk-in",
        waitedMinutes: 14,
        hasDietaryNote: true,
        compatibleTableIds: ["table-2"],
      }),
    ]);
    expect(view.commands).toEqual([
      {
        demandId: "booking-waiting",
        options: [
          {
            resourceIds: ["table-2"],
            label: "Table 2",
            interval: {
              startsAt: "2026-07-31T18:14:00.000Z",
              endsAt: "2026-07-31T19:14:00.000Z",
            },
            expectedVersion: restaurantSeatingVersion({
              demand: waitingBooking,
              resources: [resources[1]],
              allocations: [],
            }),
          },
        ],
      },
    ]);
    expect(view.moves).toEqual([
      {
        demandId: "booking-seated",
        serviceTurnId: "turn-1",
        expectedTurnVersion: 2,
        options: [
          expect.objectContaining({
            resourceIds: ["table-2"],
            label: "Table 2",
          }),
        ],
      },
    ]);
  });

  it("excludes a later reservation from the immediate seating version", async () => {
    const db = database();
    db.hospitalityCapacityAllocation.findMany.mockResolvedValue([
      {
        id: "allocation-later",
        resourceId: "table-2",
        startsAt: new Date("2026-07-31T20:00:00.000Z"),
        endsAt: new Date("2026-07-31T21:00:00.000Z"),
        lifecycle: "reserved",
        version: 1,
        demandRef: "BOOK-LATER",
        serviceTurn: null,
      },
    ]);

    const view = await loadRestaurantFloorOperationalView(db, {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
    });

    const tableTwo = view.commands
      .find((candidate) => candidate.demandId === "booking-waiting")
      ?.options.find((option) => option.resourceIds.join(",") === "table-2");
    expect(tableTwo?.expectedVersion).toBe(restaurantSeatingVersion({
      demand: waitingBooking,
      resources: [resources[1]],
      allocations: [],
    }));
  });

  it("keeps active-turn booking context outside the ordinary demand horizon", async () => {
    const db = database();
    db.storefrontBooking.findMany.mockImplementation(
      async (args: unknown) =>
        JSON.stringify(args).includes("hospitalityServiceTurn")
          ? [
              {
                ...seatedBooking,
                scheduledAt: new Date("2026-07-28T18:00:00.000Z"),
              },
              waitingBooking,
            ]
          : [waitingBooking],
    );

    const view = await loadRestaurantFloorOperationalView(db, {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
    });

    expect(view.floor.tables[0]).toEqual(
      expect.objectContaining({
        party: { id: "booking-seated", name: "Morgan Lee", covers: 2 },
      }),
    );
    expect(view.moves).toEqual([
      expect.objectContaining({
        demandId: "booking-seated",
        serviceTurnId: "turn-1",
        options: [expect.objectContaining({ resourceIds: ["table-2"] })],
      }),
    ]);
  });

  it("reports the bounded read count, elapsed time, and exact payload size", async () => {
    const ticks = [100, 112.5];
    const view = await loadRestaurantFloorOperationalView(database(), {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
      clock: () => ticks.shift() ?? 112.5,
    });

    expect(view.telemetry).toEqual({
      durationMs: 12.5,
      queryCount: 6,
      payloadBytes: new TextEncoder().encode(JSON.stringify(view)).byteLength,
    });
  });

  it("emits one versioned command option for a recommended table pair", async () => {
    const db = database();
    db.hospitalityCapacityAllocation.findMany.mockResolvedValue([]);
    db.storefrontBooking.findMany.mockResolvedValue([
      { ...waitingBooking, covers: 4 },
    ]);

    const view = await loadRestaurantFloorOperationalView(db, {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
    });

    expect(view.commands).toEqual([
      {
        demandId: "booking-waiting",
        options: [
          expect.objectContaining({
            resourceIds: ["table-1", "table-2"],
            label: "Table 1 + Table 2",
          }),
        ],
      },
    ]);
  });

  it("surfaces a late confirmed reservation and the capacity it still holds", async () => {
    const db = database();
    db.storefrontBooking.findMany.mockResolvedValue([
      {
        ...waitingBooking,
        id: "booking-late",
        bookingRef: "BOOK-LATE",
        customerName: "Taylor Morgan",
        demandKind: "reservation",
        status: "confirmed",
        scheduledAt: new Date("2026-07-31T18:04:00.000Z"),
      },
    ]);
    db.hospitalityCapacityAllocation.findMany.mockResolvedValue([
      {
        id: "allocation-late",
        resourceId: "table-2",
        startsAt: new Date("2026-07-31T18:04:00.000Z"),
        endsAt: new Date("2026-07-31T19:04:00.000Z"),
        lifecycle: "reserved",
        version: 1,
        demandRef: "BOOK-LATE",
        serviceTurn: null,
      },
    ]);

    const view = await loadRestaurantFloorOperationalView(db, {
      organizationId: "org-1",
      storefrontId: "store-1",
      now,
    });

    expect(view.reservationWatch).toEqual([
      {
        id: "booking-late",
        name: "Taylor Morgan",
        covers: 2,
        scheduledAt: "2026-07-31T18:04:00.000Z",
        lateMinutes: 10,
        state: "late",
        tableLabels: ["Table 2"],
      },
    ]);
  });

  it("loads an allow-listed public snapshot by slug without exposing operator facts", async () => {
    const availability = await loadPublicRestaurantAvailabilityBySlug(
      database(),
      { slug: "demo-restaurant", now },
    );

    expect(availability?.summary).toEqual({
      totalTables: 2,
      availableNow: 1,
      availableSoon: 1,
    });
    const serialized = JSON.stringify(availability);
    for (const privateFact of [
      "Morgan Lee",
      "morgan@example.test",
      "Jordan Rivera",
      "assignment-1",
      "BOOK-SEATED",
      "table-1",
    ]) {
      expect(serialized).not.toContain(privateFact);
    }
  });

  it("does not expose a floor snapshot for another archetype", async () => {
    const db = database();
    db.storefrontConfig.findFirst.mockResolvedValue({
      id: "store-1",
      organizationId: "org-1",
      archetype: { archetypeId: "consultancy" },
    });

    await expect(
      loadPublicRestaurantAvailabilityBySlug(db, {
        slug: "consultancy",
        now,
      }),
    ).resolves.toBeNull();
    expect(db.hospitalityResource.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when the optional public snapshot cannot be loaded", async () => {
    const db = database();
    db.storefrontConfig.findFirst.mockRejectedValue(
      new Error("database temporarily unavailable"),
    );

    await expect(
      loadPublicRestaurantAvailabilityBySlugSafe(db, {
        slug: "demo-restaurant",
        now,
      }),
    ).resolves.toBeNull();
  });
});
