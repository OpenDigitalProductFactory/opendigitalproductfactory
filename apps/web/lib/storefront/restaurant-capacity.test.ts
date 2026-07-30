import { describe, expect, it } from "vitest";

import {
  capacityStateIntent,
  deriveRestaurantCapacity,
  readinessHeadline,
  type CapacityBookingInput,
  type CapacityResourceInput,
  type ServicePeriod,
} from "./restaurant-capacity";

const NOW = new Date("2026-07-22T19:00:00.000Z");

const DINNER: ServicePeriod = {
  key: "dinner",
  label: "dinner service",
  startsAt: new Date("2026-07-22T18:00:00.000Z"),
  endsAt: new Date("2026-07-22T22:00:00.000Z"),
};

function resource(
  over: Partial<CapacityResourceInput> & { id: string; label: string },
): CapacityResourceInput {
  return {
    kind: "table",
    status: "active",
    capacity: 4,
    capacityUnit: "seats",
    ...over,
  };
}

function booking(
  over: Partial<CapacityBookingInput> & { id: string },
): CapacityBookingInput {
  return {
    hospitalityResourceId: null,
    scheduledAt: null,
    durationMinutes: 90,
    status: "confirmed",
    ...over,
  };
}

describe("deriveRestaurantCapacity", () => {
  it("yields a coherent empty snapshot with a setup next-action when no tables exist", () => {
    const snap = deriveRestaurantCapacity({
      resources: [],
      bookings: [],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.totalTables).toBe(0);
    expect(snap.readiness).toBe("not-ready");
    expect(snap.nextAction?.href).toBe("/storefront/tables");
    expect(readinessHeadline(snap)).toMatch(/no tables/i);
  });

  it("uses structured resource kind, status, and capacity without label inference", () => {
    const tables = [
      resource({ id: "t1", label: "Aster" }),
      resource({ id: "t2", label: "Birch" }),
      resource({ id: "t3", label: "Cedar" }),
      resource({ id: "t4", label: "Dogwood", status: "blocked" }),
      resource({
        id: "oven-1",
        label: "Oven 1",
        kind: "oven",
        capacityUnit: "batches",
      }),
    ];
    const bookings = [
      booking({
        id: "b1",
        hospitalityResourceId: "t1",
        scheduledAt: new Date("2026-07-22T18:30:00.000Z"),
      }),
      booking({
        id: "b2",
        hospitalityResourceId: "t2",
        scheduledAt: new Date("2026-07-22T18:00:00.000Z"),
        durationMinutes: 70,
      }),
      booking({
        id: "b3",
        hospitalityResourceId: "t3",
        scheduledAt: new Date("2026-07-22T20:30:00.000Z"),
      }),
    ];
    const snap = deriveRestaurantCapacity({
      resources: tables,
      bookings,
      now: NOW,
      nextPeriod: DINNER,
    });

    expect(snap.totalTables).toBe(4);
    expect(snap.counts.occupied).toBe(1);
    expect(snap.counts["turning-soon"]).toBe(1);
    expect(snap.counts.blocked).toBe(1);
    expect(snap.counts.available).toBe(1);
    expect(snap.upcomingReservations).toBe(1);
    expect(snap.tables.find((table) => table.key === "t2")?.freeInMinutes).toBe(10);
    expect(snap.tables.map((table) => table.label)).toEqual([
      "Aster",
      "Birch",
      "Cedar",
      "Dogwood",
    ]);
  });

  it("counts waitlist parties and prioritizes pending reservation action", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", label: "Aster" })],
      bookings: [
        booking({ id: "w1", status: "pending" }),
        booking({ id: "w2", status: "pending" }),
      ],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.waitlistParties).toBe(2);
    expect(snap.pendingReservations).toBe(2);
    expect(snap.nextAction?.label).toMatch(/confirm 2 reservations/i);
    expect(snap.nextAction?.href).toBe("/storefront/inbox");
    expect(snap.readiness).toBe("attention");
  });

  it("uses structured seat capacity rather than parsing the label", () => {
    const snap = deriveRestaurantCapacity({
      resources: [
        resource({ id: "t1", label: "Aster", capacity: 2 }),
        resource({ id: "t2", label: "Birch", capacity: 4 }),
      ],
      bookings: [],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.readiness).toBe("ready");
    expect(snap.nextAction).toBeNull();
    expect(snap.seatsTotal).toBe(6);
    expect(readinessHeadline(snap)).toMatch(/ready for dinner service/i);
  });

  it("uses the structured allocation ledger as capacity-consumption authority", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", label: "Aster" })],
      bookings: [],
      allocations: [
        {
          id: "allocation-1",
          resourceId: "t1",
          startsAt: new Date("2026-07-22T18:00:00.000Z"),
          endsAt: new Date("2026-07-22T19:30:00.000Z"),
          lifecycle: "active",
        },
      ],
      now: NOW,
      nextPeriod: DINNER,
    });

    expect(snap.tables[0]).toMatchObject({
      label: "Aster",
      state: "occupied",
    });
  });

  it("honors structured recurring availability and dated blocks", () => {
    const snap = deriveRestaurantCapacity({
      resources: [
        resource({
          id: "t1",
          label: "Aster",
          availability: [
            {
              kind: "available",
              days: [3],
              startTime: "17:00",
              endTime: "22:00",
              date: null,
            },
          ],
        }),
        resource({
          id: "t2",
          label: "Birch",
          availability: [
            {
              kind: "blocked",
              days: [],
              startTime: "18:00",
              endTime: "20:00",
              date: new Date("2026-07-22T00:00:00.000Z"),
            },
          ],
        }),
      ],
      bookings: [],
      now: NOW,
      nextPeriod: DINNER,
    });

    expect(snap.tables.find((table) => table.key === "t1")?.state).toBe(
      "available",
    );
    expect(snap.tables.find((table) => table.key === "t2")?.state).toBe(
      "blocked",
    );
  });

  it("reports closed when there is no service period", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", label: "Aster" })],
      bookings: [],
      now: NOW,
      nextPeriod: null,
    });
    expect(snap.readiness).toBe("closed");
  });

  it("never throws on an empty install", () => {
    const snap = deriveRestaurantCapacity({
      resources: [],
      bookings: [],
      now: NOW,
    });
    expect(snap.totalTables).toBe(0);
    expect(snap.tables).toEqual([]);
  });
});

describe("capacityStateIntent", () => {
  it("maps states to report-kit intents", () => {
    expect(capacityStateIntent("available")).toBe("success");
    expect(capacityStateIntent("occupied")).toBe("info");
    expect(capacityStateIntent("turning-soon")).toBe("warning");
    expect(capacityStateIntent("blocked")).toBe("danger");
  });
});
