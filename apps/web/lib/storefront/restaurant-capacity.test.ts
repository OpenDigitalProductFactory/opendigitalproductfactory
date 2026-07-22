import { describe, expect, it } from "vitest";

import {
  classifyStorefrontResource,
  seatsFromName,
  deriveRestaurantCapacity,
  readinessHeadline,
  capacityStateIntent,
  type CapacityResourceInput,
  type CapacityBookingInput,
  type ServicePeriod,
} from "./restaurant-capacity";

const NOW = new Date("2026-07-22T19:00:00.000Z");

const DINNER: ServicePeriod = {
  key: "dinner",
  label: "dinner service",
  startsAt: new Date("2026-07-22T18:00:00.000Z"),
  endsAt: new Date("2026-07-22T22:00:00.000Z"),
};

function resource(over: Partial<CapacityResourceInput> & { id: string; name: string }): CapacityResourceInput {
  return { isActive: true, ...over };
}
function booking(over: Partial<CapacityBookingInput> & { id: string }): CapacityBookingInput {
  return { providerId: null, scheduledAt: null, durationMinutes: 90, status: "confirmed", ...over };
}

describe("classifyStorefrontResource", () => {
  it("classifies table-shaped provider names as tables, people as staff", () => {
    expect(classifyStorefrontResource({ name: "Table 4" })).toBe("table");
    expect(classifyStorefrontResource({ name: "T-12" })).toBe("table");
    expect(classifyStorefrontResource({ name: "Window Seat 2" })).toBe("table");
    expect(classifyStorefrontResource({ name: "Table for 6" })).toBe("table");
    expect(classifyStorefrontResource({ name: "Patio 3" })).toBe("table");
    expect(classifyStorefrontResource({ name: "Alex Rivera" })).toBe("staff");
    expect(classifyStorefrontResource({ name: "Digital Product Factory" })).toBe("staff");
  });

  it("honors an explicit resourceKind hint over the heuristic", () => {
    expect(classifyStorefrontResource({ name: "Alex Rivera", resourceKind: "table" })).toBe("table");
    expect(classifyStorefrontResource({ name: "Table 4", resourceKind: "staff" })).toBe("staff");
  });
});

describe("seatsFromName", () => {
  it("extracts seat counts where the label exposes them", () => {
    expect(seatsFromName("Table for 4")).toBe(4);
    expect(seatsFromName("Booth (seats 6)")).toBe(6);
    expect(seatsFromName("Table 4")).toBeNull(); // an identifier, not a seat count
    expect(seatsFromName("Alex")).toBeNull();
  });
});

describe("deriveRestaurantCapacity", () => {
  it("yields a coherent empty snapshot with a setup next-action when no tables exist", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "sp1", name: "Digital Product Factory" })],
      bookings: [],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.totalTables).toBe(0);
    expect(snap.readiness).toBe("not-ready");
    expect(snap.nextAction?.href).toBe("/storefront/tables");
    expect(readinessHeadline(snap)).toMatch(/no tables/i);
  });

  it("folds seated bookings into occupied / turning-soon and counts availability", () => {
    const tables = [
      resource({ id: "t1", name: "Table 1" }),
      resource({ id: "t2", name: "Table 2" }),
      resource({ id: "t3", name: "Table 3" }),
      resource({ id: "t4", name: "Table 4", isActive: false }), // blocked
      resource({ id: "alex", name: "Alex Rivera" }), // staff — not a table
    ];
    const bookings = [
      // seated now, frees in 60m → occupied
      booking({ id: "b1", providerId: "t1", scheduledAt: new Date("2026-07-22T18:30:00.000Z"), durationMinutes: 90 }),
      // seated now, frees in 10m → turning-soon
      booking({ id: "b2", providerId: "t2", scheduledAt: new Date("2026-07-22T18:00:00.000Z"), durationMinutes: 70 }),
      // future reservation → does not seat t3 now, counts as upcoming
      booking({ id: "b3", providerId: "t3", scheduledAt: new Date("2026-07-22T20:30:00.000Z"), durationMinutes: 90 }),
    ];
    const snap = deriveRestaurantCapacity({ resources: tables, bookings, now: NOW, nextPeriod: DINNER });

    expect(snap.totalTables).toBe(4); // Alex excluded
    expect(snap.counts.occupied).toBe(1);
    expect(snap.counts["turning-soon"]).toBe(1);
    expect(snap.counts.blocked).toBe(1);
    expect(snap.counts.available).toBe(1); // t3 free now
    expect(snap.upcomingReservations).toBe(1);
    expect(snap.tables.find((t) => t.key === "t2")?.freeInMinutes).toBe(10);
  });

  it("counts walk-in waitlist parties and surfaces a seat next-action", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", name: "Table 1" })],
      bookings: [
        booking({ id: "w1", providerId: null, scheduledAt: null, status: "pending" }),
        booking({ id: "w2", providerId: null, scheduledAt: null, status: "pending" }),
      ],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.waitlistParties).toBe(2);
    expect(snap.pendingReservations).toBe(2);
    // pending reservations take priority in the next action
    expect(snap.nextAction?.label).toMatch(/confirm 2 reservations/i);
    expect(snap.nextAction?.href).toBe("/storefront/inbox");
    expect(snap.readiness).toBe("attention");
  });

  it("reports ready when tables are open and nothing needs the owner", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", name: "Table for 2" }), resource({ id: "t2", name: "Table for 4" })],
      bookings: [],
      now: NOW,
      nextPeriod: DINNER,
    });
    expect(snap.readiness).toBe("ready");
    expect(snap.nextAction).toBeNull();
    expect(snap.seatsTotal).toBe(6);
    expect(readinessHeadline(snap)).toMatch(/ready for dinner service/i);
  });

  it("reports closed when there is no service period", () => {
    const snap = deriveRestaurantCapacity({
      resources: [resource({ id: "t1", name: "Table 1" })],
      bookings: [],
      now: NOW,
      nextPeriod: null,
    });
    expect(snap.readiness).toBe("closed");
  });

  it("never throws on an empty install", () => {
    const snap = deriveRestaurantCapacity({ resources: [], bookings: [], now: NOW });
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
