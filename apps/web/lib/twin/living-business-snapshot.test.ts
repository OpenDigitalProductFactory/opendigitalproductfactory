import { describe, expect, it } from "vitest";

import {
  bookingsToQueueItems,
  bookingsToWorkItems,
  buildQuests,
  financeToUtility,
  humanizeWait,
  isReservationQueueKey,
  isUpcomingReservation,
  liveCapacityChips,
  loadLivingBusinessSnapshot,
  longestWaitMs,
  proposeCogAllocation,
  reservationsToQueueItems,
  resourceUnits,
  rosterToPresence,
  statusIntent,
  type LivingBusinessClient,
} from "./living-business-snapshot";
import { loadVersionedOperationsSnapshot } from "./operations-loader";
import type { WorkforceMember } from "@/lib/workforce/workforce-roster";

const NOW = new Date("2026-07-15T09:00:00Z");
const member = (over: Partial<WorkforceMember>): WorkforceMember => ({
  kind: "human",
  id: "E-1",
  displayName: "Alex",
  status: "active",
  role: "Manager",
  group: null,
  agentNeeds: null,
  ...over,
});

describe("living-business-snapshot — pure helpers", () => {
  it("rosterToPresence puts AI coworkers first and marks kind", () => {
    const out = rosterToPresence([
      member({ id: "E-1", displayName: "Alex", kind: "human" }),
      member({ id: "AGT-1", displayName: "Aria", kind: "agent", role: "operate" }),
    ]);
    expect(out[0]).toMatchObject({ name: "Aria", kind: "ai", focus: "operate" });
    expect(out[1]).toMatchObject({ name: "Alex", kind: "human" });
  });

  it("rosterToPresence drops archived/inactive members", () => {
    const out = rosterToPresence([member({ status: "archived" }), member({ id: "E-2", displayName: "Bo" })]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Bo");
  });

  it("resourceUnits prefers providers, else the workforce", () => {
    const providers = [{ id: "P-1", name: "Bay A", isActive: true }];
    const fromProviders = resourceUnits(providers, [member({})]);
    expect(fromProviders[0]).toMatchObject({ label: "Bay A", state: "Available", intent: "success" });

    const fromRoster = resourceUnits([], [member({ displayName: "Aria", kind: "agent", status: "active" })]);
    expect(fromRoster[0]).toMatchObject({ label: "Aria", owner: { name: "Aria", kind: "ai" } });
  });

  it("financeToUtility reflects real finance state and escalates tax intent", () => {
    const meters = financeToUtility({
      billsDueCount: 2,
      billsDueAmount: 1240,
      currency: "GBP",
      nextTaxDueDays: 5,
      complianceOpenCount: 0,
      coworkerGaps: 1,
    });
    const bills = meters.find((m) => m.key === "bills")!;
    const tax = meters.find((m) => m.key === "tax")!;
    expect(bills.value).toContain("£1,240");
    expect(bills.intent).toBe("warning");
    expect(tax.value).toBe("5 days");
    expect(tax.intent).toBe("danger"); // <= 7 days
    expect(meters.find((m) => m.key === "compliance")!.value).toBe("All clear");
  });

  it("financeToUtility shows calm states when nothing is due", () => {
    const meters = financeToUtility({
      billsDueCount: 0,
      billsDueAmount: 0,
      currency: null,
      nextTaxDueDays: null,
      complianceOpenCount: 0,
      coworkerGaps: 0,
    });
    expect(meters.find((m) => m.key === "bills")!.value).toBe("None due");
    expect(meters.find((m) => m.key === "tax")!.value).toBe("Up to date");
  });

  it("buildQuests only raises real attention signals", () => {
    expect(buildQuests({ billsDueCount: 0, nextTaxDueDays: null, unassignedCount: 0 })).toHaveLength(0);
    const q = buildQuests({ billsDueCount: 1, nextTaxDueDays: 3, unassignedCount: 2 });
    expect(q.map((x) => x.key).sort()).toEqual(["bills", "tax", "unassigned"]);
    expect(q.find((x) => x.key === "tax")!.intent).toBe("danger");
  });

  it("bookings map to queue (pending/unassigned) and work items (in flight)", () => {
    const bookings = [
      {
        id: "b1",
        scheduledAt: new Date("2026-07-18T09:00:00Z"), // 3 days AFTER NOW → upcoming
        createdAt: new Date("2026-07-15T06:00:00Z"),
        status: "pending",
        provider: null,
      },
      {
        id: "b2",
        scheduledAt: new Date("2026-07-16T09:00:00Z"),
        createdAt: new Date("2026-07-14T09:00:00Z"),
        status: "confirmed",
        provider: { name: "Dr Lee" },
      },
    ];
    const queue = bookingsToQueueItems(bookings, NOW);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ key: "b1", label: "Unassigned" });
    // An upcoming reservation reads as time-until its slot, not an age-based wait.
    expect(queue[0].meta).toBe("booked for 07-18");
    expect(queue[0].waiting).toBe("in 3d");

    const work = bookingsToWorkItems(bookings, "appointment");
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ owner: { name: "Dr Lee", kind: "human" } });
    expect(work[0].label).toContain("Appointment");
  });

  it("a passed-but-unfulfilled reservation reads as overdue, not a multi-day wait", () => {
    const bookings = [
      {
        id: "stale",
        scheduledAt: new Date("2026-07-13T18:00:00Z"), // 2 days BEFORE NOW
        createdAt: new Date("2026-07-10T09:00:00Z"), // created 5 days ago
        status: "pending",
        provider: null,
      },
    ];
    const queue = bookingsToQueueItems(bookings, NOW);
    expect(queue[0].meta).toBe("overdue · was 07-13");
    // Crucially: NO "5d" wait chip — it is not waiting, it is overdue.
    expect(queue[0].waiting).toBeUndefined();
  });

  it("walk-in (no scheduled slot) is a genuine live queue wait", () => {
    const bookings = [
      { id: "w", scheduledAt: null, createdAt: new Date("2026-07-15T06:00:00Z"), status: "pending", provider: null },
    ];
    const queue = bookingsToQueueItems(bookings, NOW);
    expect(queue[0].meta).toBe("awaiting schedule");
    expect(queue[0].waiting).toBe("3h");
  });

  it("reservationsToQueueItems surfaces upcoming reservations soonest-first (BI-348766E5)", () => {
    const bookings = [
      { id: "later", scheduledAt: new Date("2026-07-20T19:00:00Z"), createdAt: new Date("2026-07-15T09:00:00Z"), status: "confirmed", provider: { name: "Table 5" } },
      { id: "soon", scheduledAt: new Date("2026-07-16T19:00:00Z"), createdAt: new Date("2026-07-15T09:00:00Z"), status: "pending", provider: null },
      { id: "past", scheduledAt: new Date("2026-07-14T19:00:00Z"), createdAt: new Date("2026-07-13T09:00:00Z"), status: "pending", provider: null },
      { id: "gone", scheduledAt: new Date("2026-07-18T19:00:00Z"), createdAt: new Date("2026-07-15T09:00:00Z"), status: "cancelled", provider: null },
    ];
    const queue = reservationsToQueueItems(bookings, NOW);
    // Only future, non-cancelled bookings; soonest first; a cancelled one is excluded.
    expect(queue.map((q) => q.key)).toEqual(["soon", "later"]);
    expect(queue[0]).toMatchObject({ label: "Reservation", meta: "booked for 07-16" });
    expect(queue[1].label).toBe("With Table 5");
  });

  it("isUpcomingReservation excludes past, cancelled and completed bookings", () => {
    expect(isUpcomingReservation({ id: "a", scheduledAt: new Date("2026-07-20T09:00:00Z"), createdAt: null, status: "pending", provider: null }, NOW)).toBe(true);
    expect(isUpcomingReservation({ id: "b", scheduledAt: new Date("2026-07-10T09:00:00Z"), createdAt: null, status: "pending", provider: null }, NOW)).toBe(false);
    expect(isUpcomingReservation({ id: "c", scheduledAt: new Date("2026-07-20T09:00:00Z"), createdAt: null, status: "cancelled", provider: null }, NOW)).toBe(false);
    expect(isUpcomingReservation({ id: "d", scheduledAt: null, createdAt: null, status: "pending", provider: null }, NOW)).toBe(false);
  });

  it("isReservationQueueKey matches the FLOOR/YARD reservations queue keys", () => {
    expect(isReservationQueueKey("reservations")).toBe(true);
    expect(isReservationQueueKey("waitlist")).toBe(false);
    expect(isReservationQueueKey("dispatch")).toBe(false);
  });

  it("longestWaitMs ignores scheduled reservations — only walk-ins wait", () => {
    const reservations = [
      { id: "r1", scheduledAt: new Date("2026-07-18T09:00:00Z"), createdAt: new Date("2026-07-12T09:00:00Z"), status: "pending", provider: null },
      { id: "r2", scheduledAt: new Date("2026-07-13T09:00:00Z"), createdAt: new Date("2026-07-11T09:00:00Z"), status: "pending", provider: null },
    ];
    // All scheduled (upcoming or overdue) → no headline wait, so the chip drops.
    expect(longestWaitMs(reservations, NOW)).toBe(0);
  });

  it("humanizeWait + longestWaitMs surface the queue's flow metric", () => {
    expect(humanizeWait(8 * 60_000)).toBe("8m");
    expect(humanizeWait(3 * 3_600_000)).toBe("3h");
    expect(humanizeWait(2 * 86_400_000)).toBe("2d");
    const bookings = [
      { id: "a", scheduledAt: null, createdAt: new Date("2026-07-14T09:00:00Z"), status: "pending", provider: null },
      { id: "b", scheduledAt: null, createdAt: new Date("2026-07-15T06:00:00Z"), status: "pending", provider: null },
    ];
    // longest wait = the older item (1 day before NOW)
    expect(longestWaitMs(bookings, NOW)).toBe(86_400_000);
    const chips = liveCapacityChips({ teamTotal: 3, aiCount: 1, openDemand: 2, billsDueCount: 0, longestWaitMs: 86_400_000 });
    expect(chips[0]).toMatchObject({ key: "wait", value: "24h" });
  });

  it("proposeCogAllocation names the longest-waiting item and least-loaded provider", () => {
    const bookings = [
      { id: "old", scheduledAt: null, createdAt: new Date("2026-07-14T09:00:00Z"), status: "pending", provider: null },
      { id: "new", scheduledAt: null, createdAt: new Date("2026-07-15T08:00:00Z"), status: "pending", provider: null },
      // Dr Lee already carries an in-flight booking → higher load than Dr Fox.
      { id: "busy", scheduledAt: null, createdAt: null, status: "confirmed", provider: { name: "Dr Lee" } },
    ];
    const providers = [
      { id: "p1", name: "Dr Lee", isActive: true },
      { id: "p2", name: "Dr Fox", isActive: true },
    ];
    const cog = proposeCogAllocation(bookings, providers, [], "appointment", "provider", ["skill", "availability"], NOW);
    expect(cog).toBeTruthy();
    expect(cog!.proposal).toContain("Dr Fox"); // lowest load wins
    expect(cog!.proposal).toContain("appointment");
    expect(cog!.confirmLabel).toBe("Assign appointment");
    expect(cog!.signals).toEqual(["skill", "availability"]);
  });

  it("proposeCogAllocation falls back to an active AI coworker when no providers exist", () => {
    const bookings = [{ id: "x", scheduledAt: null, createdAt: new Date("2026-07-14T09:00:00Z"), status: "pending", provider: null }];
    const cog = proposeCogAllocation(
      bookings,
      [],
      [member({ id: "AGT-1", displayName: "Aria", kind: "agent", status: "active" })],
      "case",
      "reviewer",
      ["workload"],
      NOW,
    );
    expect(cog!.proposal).toContain("Aria");
  });

  it("proposeCogAllocation stays silent when there is nothing to allocate", () => {
    expect(proposeCogAllocation([], [], [], "job", "tech", ["skill"], NOW)).toBeUndefined();
  });

  it("liveCapacityChips are all real counts", () => {
    const chips = liveCapacityChips({ teamTotal: 5, aiCount: 2, openDemand: 3, billsDueCount: 0 });
    expect(chips.find((c) => c.key === "ai")!.value).toBe(2);
    expect(chips.find((c) => c.key === "bills")!.intent).toBe("success");
  });

  it("statusIntent classifies common states", () => {
    expect(statusIntent("active")).toBe("success");
    expect(statusIntent("pending")).toBe("info");
    expect(statusIntent("overdue")).toBe("danger");
    expect(statusIntent("review")).toBe("warning");
  });
});

describe("loadLivingBusinessSnapshot — loader", () => {
  const emptyRoster = { employeeProfile: { findMany: async () => [] }, agent: { findMany: async () => [] } };

  it("returns null when no org is configured", async () => {
    const db = {
      ...emptyRoster,
      storefrontConfig: { findFirst: async () => null },
      bill: { findMany: async () => [] },
      taxObligationPeriod: { findMany: async () => [] },
      obligation: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
      storefrontBooking: { findMany: async () => [] },
      serviceProvider: { findMany: async () => [] },
      hospitalityResource: { findMany: async () => [] },
      hospitalityCapacityAllocation: { findMany: async () => [] },
    } as unknown as LivingBusinessClient;
    expect(await loadLivingBusinessSnapshot({ db, now: NOW })).toBeNull();
  });

  it("projects a live snapshot for a configured food-hospitality org", async () => {
    const db = {
      employeeProfile: {
        findMany: async () => [
          {
            id: "E-1",
            displayName: "Sam",
            status: "active",
            position: { title: "Server" },
            department: { name: "Floor" },
          },
        ],
      },
      agent: {
        findMany: async () => [
          {
            agentId: "AGT-HOST",
            name: "AI host",
            status: "active",
            valueStream: "operate",
            humanSupervisorId: null,
            portfolioId: null,
            hitlTierDefault: "tier2",
            lifecycleStage: "active",
            executionConfig: null,
            _count: { toolGrants: 0, skills: 0 },
            coworkerNeeds: [],
          },
        ],
      },
      storefrontConfig: {
        findFirst: async () => ({ archetype: { archetypeId: "restaurant", name: "Dine-in restaurant" } }),
      },
      // Org is US → the twin renders USD regardless of any legacy GBP-denominated
      // bill row (currency comes from OrgSettings, not the bill).
      orgSettings: { findFirst: async () => ({ baseCurrency: "USD", locale: "en-US", countryCode: "US" }) },
      bill: { findMany: async () => [{ amountDue: 500, dueDate: NOW, status: "open", currency: "GBP" }] },
      taxObligationPeriod: { findMany: async () => [{ dueDate: new Date("2026-07-20T00:00:00Z"), status: "open", filedAt: null }] },
      obligation: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
      storefrontBooking: {
        findMany: async () => [
          {
            id: "bk1",
            scheduledAt: new Date("2026-07-15T18:00:00Z"),
            createdAt: new Date("2026-07-15T07:00:00Z"),
            status: "pending",
            provider: null,
          },
        ],
      },
      serviceProvider: { findMany: async () => [] },
      hospitalityResource: { findMany: async () => [] },
      hospitalityCapacityAllocation: { findMany: async () => [] },
    } as unknown as LivingBusinessClient;

    const snap = await loadLivingBusinessSnapshot({ db, now: NOW });
    expect(snap).not.toBeNull();
    expect(snap!.live).toBe(true);
    // presence carries both the human and the AI coworker
    expect(snap!.presence.some((p) => p.kind === "ai")).toBe(true);
    expect(snap!.presence.some((p) => p.kind === "human")).toBe(true);
    // finance renders the ORG currency (USD), not the legacy GBP bill row
    expect(snap!.utility.find((m) => m.key === "bills")!.value).toContain("$500");
    // an upcoming pending booking becomes RESERVATIONS-queue demand (BI-348766E5:
    // the restaurant Reservations queue is populated, not hardcoded-empty) + a cog proposal
    const reservationsQueue = snap!.queues.find((q) => isReservationQueueKey(q.key));
    expect(reservationsQueue).toBeTruthy();
    expect(reservationsQueue!.items.length).toBeGreaterThan(0);
    expect(snap!.cog).toBeTruthy();
    // A restaurant (FLOOR) headlines capacity in its own words — tables/seats/
    // waitlist — not the archetype-agnostic Workforce/AI counters (BI-7C95A586).
    expect(snap!.capacityChips.some((c) => c.key === "tables-open")).toBe(true);
    expect(snap!.capacityChips.some((c) => c.key === "ai")).toBe(false);

    const ticks = [1_000, 1_042];
    const operations = await loadVersionedOperationsSnapshot({
      db,
      now: NOW,
      clock: () => ticks.shift() ?? 1_042,
    });
    expect(operations).not.toBeNull();
    expect(operations!.identity).toMatchObject({ archetypeId: "restaurant", template: "FLOOR" });
    expect(operations!.telemetry).toMatchObject({ durationMs: 42, queryCount: 12 });
    expect(operations!.telemetry.payloadBytes).toBe(
      new TextEncoder().encode(JSON.stringify(operations)).byteLength,
    );
    expect(operations!.freshness).toBe("current");

    const localeFailing = await loadVersionedOperationsSnapshot({
      db: {
        ...db,
        orgSettings: {
          findFirst: async () => {
            throw new Error("locale source unavailable");
          },
        },
      } as unknown as LivingBusinessClient,
      now: NOW,
    });
    expect(localeFailing!.degradedSources).toContainEqual({
      source: "locale",
      reason: "query-failed",
    });
    expect(localeFailing!.freshness).toBe("degraded");
  });

  it("projects pet-rescue mission outcomes from donation and adoption records", async () => {
    const db = {
      ...emptyRoster,
      storefrontConfig: {
        findFirst: async () => ({
          id: "sf-rescue",
          timezone: "America/Chicago",
          archetype: { archetypeId: "pet-rescue", name: "Pet rescue" },
        }),
      },
      orgSettings: {
        findFirst: async () => ({
          baseCurrency: "USD",
          locale: "en-US",
          countryCode: "US",
        }),
      },
      bill: { findMany: async () => [] },
      taxObligationPeriod: { findMany: async () => [] },
      obligation: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
      storefrontBooking: { findMany: async () => [] },
      serviceProvider: { findMany: async () => [] },
      hospitalityResource: { findMany: async () => [] },
      hospitalityCapacityAllocation: { findMany: async () => [] },
      storefrontDonation: {
        findMany: async () => [
          { amount: 200, currency: "USD" },
          { amount: 75, currency: "USD" },
        ],
      },
      adoptableAnimal: {
        count: async () => 2,
        groupBy: async () => [
          { status: "hold", _count: { _all: 3 } },
          { status: "available", _count: { _all: 1 } },
          { status: "adopted", _count: { _all: 2 } },
        ],
      },
    } as unknown as LivingBusinessClient;

    const snapshot = await loadLivingBusinessSnapshot({ db, now: NOW });

    expect(snapshot?.outcomesHeading).toBe("Mission impact");
    expect(snapshot?.outcomes?.map((outcome) => outcome.label)).toEqual([
      "Animals in care",
      "Kennels",
      "Donations received",
      "Animals placed",
      "Fosters active",
    ]);
    expect(snapshot?.outcomes?.[0]?.value).toBe("4 animals");
    expect(snapshot?.outcomes?.[0]?.hint).toBe("3 on hold · 1 available");
    expect(snapshot?.outcomes?.[1]?.value).toBe("Not recorded");
    expect(snapshot?.outcomes?.[2]?.value).toContain("$275");
    expect(snapshot?.outcomes?.[3]?.value).toBe("2 animals");
    expect(snapshot?.outcomes?.[4]).toMatchObject({
      value: "Unavailable",
      hint: "No foster record source yet",
    });
  });

  it("keeps a restaurant busy-shift snapshot bounded to the operational read contract", async () => {
    const bookings = Array.from({ length: 24 }, (_, index) => ({
      id: `booking-${index + 1}`,
      providerId: index < 12 ? `table-${(index % 12) + 1}` : null,
      hospitalityResourceId:
        index < 12 ? `table-${(index % 12) + 1}` : null,
      scheduledAt: new Date(NOW.getTime() + index * 5 * 60_000),
      createdAt: new Date(NOW.getTime() - (index + 1) * 60_000),
      status: index < 12 ? "confirmed" : "pending",
      provider: index < 12 ? { name: `Table ${(index % 12) + 1}` } : null,
    }));
    const resources = Array.from({ length: 12 }, (_, index) => ({
      id: `table-${index + 1}`,
      label: `Table ${index + 1}`,
      kind: "table",
      status: "active",
      capacity: 4,
      capacityUnit: "seats",
    }));
    const db = {
      ...emptyRoster,
      storefrontConfig: {
        findFirst: async () => ({
          archetype: { archetypeId: "restaurant", name: "Dine-in restaurant" },
        }),
      },
      orgSettings: {
        findFirst: async () => ({
          baseCurrency: "USD",
          locale: "en-US",
          countryCode: "US",
        }),
      },
      bill: { findMany: async () => [] },
      taxObligationPeriod: { findMany: async () => [] },
      obligation: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
      storefrontBooking: { findMany: async () => bookings },
      serviceProvider: { findMany: async () => [] },
      hospitalityResource: { findMany: async () => resources },
      hospitalityCapacityAllocation: {
        findMany: async () =>
          bookings.slice(0, 12).map((booking) => ({
            id: `allocation-${booking.id}`,
            resourceId: booking.hospitalityResourceId,
            startsAt: booking.scheduledAt,
            endsAt: new Date(booking.scheduledAt.getTime() + 90 * 60_000),
            lifecycle: "active",
          })),
      },
    } as unknown as LivingBusinessClient;

    const operations = await loadVersionedOperationsSnapshot({ db, now: NOW });

    expect(operations).not.toBeNull();
    expect(operations!.identity).toMatchObject({ archetypeId: "restaurant", template: "FLOOR" });
    expect(operations!.scene.zones.flatMap((zone) => zone.units)).toHaveLength(12);
    // The complete physical floor stays visible, while repeated demand rows are
    // intentionally bounded for decision-speed and payload stability.
    expect(operations!.scene.workItems).toHaveLength(5);
    expect(operations!.queue.queues.flatMap((queue) => queue.items)).toHaveLength(6);
    expect(operations!.telemetry.queryCount).toBe(12);
    expect(operations!.telemetry.payloadBytes).toBeLessThan(100_000);
  });
});
