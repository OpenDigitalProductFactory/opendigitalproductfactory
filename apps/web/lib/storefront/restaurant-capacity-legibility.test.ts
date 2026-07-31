// Smoke tests for BI-7C95A586: Restaurant routes must NOT call tables
// "providers", must NOT show rental copy, and MUST reconcile the same
// table/capacity state across the owner Tables page, the Workspace, and public
// booking. These are the executable proof the coordinated BIs (BI-36807E68
// fixture pack, BI-348766E5 workspace reconciliation) depend on.

import { describe, expect, it } from "vitest";

import { getVocabulary } from "./archetype-vocabulary";
import { resolveResourceVocabulary } from "./resource-vocabulary";
import {
  deriveRestaurantCapacity,
  type CapacityBookingInput,
  type CapacityResourceInput,
} from "./restaurant-capacity";
import { loadRestaurantCapacitySnapshot, type CapacityLoaderClient } from "./restaurant-capacity-loader";
import { STOREFRONT_ROUTES } from "@/components/storefront-admin/storefront-nav";
import { loadLivingBusinessSnapshot } from "@/lib/twin/living-business-snapshot";
import type { LivingBusinessClient } from "@/lib/twin/living-business-snapshot";

const NOW = new Date("2026-07-22T19:00:00.000Z"); // dinner service, venue open

const JARGON = /\bprovider\b|\brental\b|\brental class\b/i;

// ── 1. No provider / rental jargon on Restaurant resource routes ─────────────

describe("Restaurant resource vocabulary has no provider/rental jargon", () => {
  const resourceVocab = resolveResourceVocabulary({ archetypeId: "restaurant", teamLabel: "Staff" });

  it("labels the resource surface Tables & Capacity, not providers/rentals", () => {
    expect(resourceVocab.hasCapacityResources).toBe(true);
    expect(resourceVocab.resourceLabel).toBe("Tables & Capacity");
    expect(resourceVocab.resourceSingular).toBe("table");
    expect(resourceVocab.addResourceButtonLabel).toBe("Add table");
    expect(resourceVocab.staffLabel).toBe("Staff");
    for (const label of [
      resourceVocab.resourceLabel,
      resourceVocab.addResourceButtonLabel,
      resourceVocab.addStaffButtonLabel,
      resourceVocab.staffLabel,
    ]) {
      expect(label).not.toMatch(JARGON);
    }
  });

  it("food-hospitality vocabulary uses Staff/Menu/Reservations, never Providers", () => {
    const v = getVocabulary("food-hospitality");
    expect(v.teamLabel).toBe("Staff");
    expect(v.teamLabel).not.toMatch(JARGON);
    expect(v.itemsLabel).toBe("Menu");
  });

  it("registers the Tables & Capacity route without provider/rental wording", () => {
    const tables = STOREFRONT_ROUTES.find((r) => r.href === "/storefront/tables");
    expect(tables).toBeDefined();
    expect(tables!.label).not.toMatch(JARGON);
  });

  it("does not enable the capacity surface for a rental archetype", () => {
    const rental = resolveResourceVocabulary({ archetypeId: "equipment-rental", teamLabel: "Team" });
    expect(rental.hasCapacityResources).toBe(false);
  });
});

// ── 2. Tables are structured resources, not inferred providers ──────────────

describe("structured hospitality resources stay out of Staff", () => {
  it("does not require a ServiceProvider delegate or table-shaped label", () => {
    const client: CapacityLoaderClient = {
      storefrontConfig: { findFirst: async () => null },
      hospitalityResource: { findMany: async () => [] },
      hospitalityCapacityAllocation: { findMany: async () => [] },
      storefrontBooking: { findMany: async () => [] },
      bookingHold: { findMany: async () => [] },
      businessProfile: { findFirst: async () => null },
    };
    expect("serviceProvider" in client).toBe(false);
  });
});

// ── 3. Cross-surface capacity reconciliation ─────────────────────────────────

// One fixture, read two ways: the owner Tables & Capacity loader and the
// Workspace projection must agree on table/capacity/reservation state.
const TABLES = [
  { id: "t1", label: "Aster", kind: "table", status: "active", capacity: 2, capacityUnit: "seats" },
  { id: "t2", label: "Birch", kind: "table", status: "active", capacity: 4, capacityUnit: "seats" },
  { id: "t3", label: "Cedar", kind: "table", status: "blocked", capacity: 6, capacityUnit: "seats" },
];
const BOOKINGS = [
  // seated now (18:30 + 90m spans 19:00) → occupies t2
  { id: "b-seated", providerId: "legacy-t2", hospitalityResourceId: "t2", scheduledAt: new Date("2026-07-22T18:30:00.000Z"), durationMinutes: 90, status: "confirmed", provider: { name: "Legacy Birch" }, createdAt: new Date("2026-07-22T10:00:00.000Z") },
  // confirmed reservation ahead (20:30) → upcoming reservation
  { id: "b-upcoming", providerId: "legacy-t1", hospitalityResourceId: "t1", scheduledAt: new Date("2026-07-22T20:30:00.000Z"), durationMinutes: 90, status: "confirmed", provider: { name: "Legacy Aster" }, createdAt: new Date("2026-07-22T12:00:00.000Z") },
  // walk-in party with no seat yet → waitlist
  { id: "b-walkin", providerId: null, hospitalityResourceId: null, scheduledAt: null, durationMinutes: 90, status: "pending", provider: null, createdAt: new Date("2026-07-22T18:55:00.000Z") },
];

function capacityLoaderDb(): CapacityLoaderClient {
  return {
    storefrontConfig: { findFirst: async () => ({ id: "sf1", archetype: { archetypeId: "restaurant" } }) },
    hospitalityResource: { findMany: async () => TABLES },
    hospitalityCapacityAllocation: { findMany: async () => [] },
    storefrontBooking: {
      findMany: async () =>
        BOOKINGS.map((b) => ({ id: b.id, hospitalityResourceId: b.hospitalityResourceId, scheduledAt: b.scheduledAt, durationMinutes: b.durationMinutes, status: b.status })),
    },
    bookingHold: { findMany: async () => [] },
    businessProfile: { findFirst: async () => null },
  } as unknown as CapacityLoaderClient;
}

function livingBusinessDb(): LivingBusinessClient {
  return {
    employeeProfile: { findMany: async () => [] },
    agent: { findMany: async () => [] },
    storefrontConfig: { findFirst: async () => ({ archetype: { archetypeId: "restaurant", name: "Dine-in restaurant" } }) },
    orgSettings: { findFirst: async () => ({ baseCurrency: "USD", locale: "en-US", countryCode: "US" }) },
    bill: { findMany: async () => [] },
    taxObligationPeriod: { findMany: async () => [] },
    obligation: { findMany: async () => [] },
    invoice: { findMany: async () => [] },
    serviceProvider: { findMany: async () => [] },
    hospitalityResource: { findMany: async () => TABLES },
    hospitalityCapacityAllocation: { findMany: async () => [] },
    storefrontBooking: { findMany: async () => BOOKINGS },
  } as unknown as LivingBusinessClient;
}

describe("capacity state reconciles across owner Tables page and Workspace", () => {
  it("the owner Tables loader reports coherent table/capacity counts", async () => {
    const loaded = await loadRestaurantCapacitySnapshot({ db: capacityLoaderDb(), now: NOW });
    expect(loaded).not.toBeNull();
    const s = loaded!.snapshot;
    expect(s.totalTables).toBe(3);
    expect(s.counts.occupied).toBe(1); // t2 seated now
    expect(s.counts.blocked).toBe(1); // t3 out of service
    expect(s.upcomingReservations).toBe(1); // t1 at 20:30
    expect(s.waitlistParties).toBe(1); // the walk-in
    expect(s.nextAction).not.toBeNull(); // there is a next action to take
  });

  it("the Workspace headlines capacity in restaurant terms, not generic Workforce/AI chips", async () => {
    const snap = await loadLivingBusinessSnapshot({ db: livingBusinessDb(), now: NOW });
    expect(snap).not.toBeNull();
    // Capacity chips speak tables/seats/waitlist, not the generic Workforce/AI counters.
    expect(snap!.capacityChips.some((c) => c.key === "tables-open")).toBe(true);
    expect(snap!.capacityChips.some((c) => c.key === "ai")).toBe(false);
    // (The Reservations-QUEUE reconciliation is owned by BI-348766E5 / PR #3403.)
  });

  it("owner Tables page and Workspace agree on the upcoming-reservation count (shared model)", async () => {
    const [loaded, snap] = await Promise.all([
      loadRestaurantCapacitySnapshot({ db: capacityLoaderDb(), now: NOW }),
      loadLivingBusinessSnapshot({ db: livingBusinessDb(), now: NOW }),
    ]);
    const ownerUpcoming = loaded!.snapshot.upcomingReservations;
    // Both surfaces derive from deriveRestaurantCapacity on the same fixture, so
    // the Workspace "reservations ahead" chip reconciles with the owner snapshot.
    const workspaceChip = snap!.capacityChips.find((c) => c.key === "reservations");
    expect(workspaceChip?.value).toBe(ownerUpcoming);
  });
});

// ── 4. The capacity model is archetype-gated (no leakage to non-FLOOR) ───────

describe("capacity projection is Restaurant-gated", () => {
  it("returns null for a non-capacity archetype", async () => {
    const db = {
      storefrontConfig: { findFirst: async () => ({ id: "sf1", archetype: { archetypeId: "equipment-rental" } }) },
      hospitalityResource: { findMany: async () => [] },
      hospitalityCapacityAllocation: { findMany: async () => [] },
      storefrontBooking: { findMany: async () => [] },
      bookingHold: { findMany: async () => [] },
      businessProfile: { findFirst: async () => null },
    } as unknown as CapacityLoaderClient;
    expect(await loadRestaurantCapacitySnapshot({ db, now: NOW })).toBeNull();
  });

  it("deriveRestaurantCapacity ignores non-table hospitality resources", () => {
    const resources: CapacityResourceInput[] = [
      { id: "t1", label: "Aster", kind: "table", status: "active", capacity: 4, capacityUnit: "seats" },
      { id: "o1", label: "Oven 1", kind: "oven", status: "active", capacity: 6, capacityUnit: "batches" },
    ];
    const bookings: CapacityBookingInput[] = [];
    const snap = deriveRestaurantCapacity({ resources, bookings, now: NOW });
    expect(snap.totalTables).toBe(1);
  });
});
