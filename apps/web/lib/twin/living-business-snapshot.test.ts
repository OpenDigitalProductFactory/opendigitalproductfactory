import { describe, expect, it } from "vitest";

import {
  bookingsToQueueItems,
  bookingsToWorkItems,
  buildQuests,
  financeToUtility,
  humanizeWait,
  liveCapacityChips,
  loadLivingBusinessSnapshot,
  longestWaitMs,
  proposeCogAllocation,
  resourceUnits,
  rosterToPresence,
  statusIntent,
  type LivingBusinessClient,
} from "./living-business-snapshot";
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
    } as unknown as LivingBusinessClient;

    const snap = await loadLivingBusinessSnapshot({ db, now: NOW });
    expect(snap).not.toBeNull();
    expect(snap!.live).toBe(true);
    // presence carries both the human and the AI coworker
    expect(snap!.presence.some((p) => p.kind === "ai")).toBe(true);
    expect(snap!.presence.some((p) => p.kind === "human")).toBe(true);
    // finance is real
    expect(snap!.utility.find((m) => m.key === "bills")!.value).toContain("£500");
    // a pending booking becomes queue demand + a cog proposal
    expect(snap!.queues[0].items.length).toBeGreaterThan(0);
    expect(snap!.cog).toBeTruthy();
    // capacity chips are real counts
    expect(snap!.capacityChips.find((c) => c.key === "ai")!.value).toBe(1);
  });
});
