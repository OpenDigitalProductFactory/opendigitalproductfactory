import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveDemoBusiness } from "./demo-business";
import {
  planDemoLoad,
  demoTeardownSpec,
  isSafeToLoadDemo,
  DEMO_REF_PREFIX,
} from "./demo-business-load";

const ITEM_IDS = ["item-a", "item-b", "item-c"];

function expectCapacitySafe(bookings: ReturnType<typeof planDemoLoad>["bookings"]) {
  const assigned = bookings.filter(b => b.providerId && b.durationMinutes > 0);
  for (let i = 0; i < assigned.length; i++) {
    for (const other of assigned.slice(i + 1)) {
      const booking = assigned[i];
      if (booking.providerId !== other.providerId) continue;
      const overlap = booking.scheduledInMinutes < other.scheduledInMinutes + other.durationMinutes
        && other.scheduledInMinutes < booking.scheduledInMinutes + booking.durationMinutes;
      expect(overlap, `${booking.bookingRef} overlaps ${other.bookingRef}`).toBe(false);
    }
  }
}

describe("planDemoLoad", () => {
  it("loads the software demo without conflicting provider reservations", () => {
    const archetype = ALL_ARCHETYPES.find(a => a.archetypeId === "software-platform")!;
    const demo = deriveDemoBusiness(archetype);
    const before = structuredClone(demo);
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });
    expect(plan.bookings).toHaveLength(demo.demand.length);
    expectCapacitySafe(plan.bookings);
    demo.demand.forEach((item, index) => {
      const booking = plan.bookings[index];
      expect(booking.bookingRef).toBe(`demo-software-platform-bk-${index}`);
      expect(booking.providerId).toBe(item.assignedResourceKey
        ? `demo-software-platform-prov-${item.assignedResourceKey}` : undefined);
      expect(booking.createdMinutesAgo).toBe(item.waitingMinutes);
    });
    expect(demo).toEqual(before);
    expect(planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS })).toEqual(plan);
  });

  it.each([1, 30, 120])("respects provider capacity and past/future states across the catalog at %i minutes", duration => {
    for (const archetype of ALL_ARCHETYPES) {
      const plan = planDemoLoad(deriveDemoBusiness(archetype), {
        storefrontId: "sf-1", itemIds: ITEM_IDS, defaultDurationMinutes: duration,
      });
      expectCapacitySafe(plan.bookings);
      for (const booking of plan.bookings) {
        expect(booking.durationMinutes).toBe(duration);
        if (booking.status === "completed") {
          expect(booking.scheduledInMinutes + duration).toBeLessThanOrEqual(0);
        } else expect(booking.scheduledInMinutes).toBeGreaterThan(0);
      }
    }
  });

  it("keeps adjacent and independently assigned reservations at their preferred times", () => {
    const demo = deriveDemoBusiness(ALL_ARCHETYPES.find(a => a.archetypeId === "software-platform")!);
    const base = demo.demand[0];
    const resource = demo.resources[0].key;
    demo.demand = Array.from({ length: 7 }, (_, i) => ({ ...base, key: `boundary-${i}`,
      stageKey: "deliver", queueKey: undefined, assignedResourceKey: i === 0 || i === 6 ? resource : undefined }));
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });
    expectCapacitySafe(plan.bookings);
    expect(plan.bookings.map(b => b.scheduledInMinutes)).toEqual([5, 10, 15, 20, 25, 30, 35]);
    expect(plan.bookings.slice(1, 6).every(b => !b.providerId)).toBe(true);
    demo.demand[1].assignedResourceKey = demo.resources[1].key;
    const independent = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });
    expectCapacitySafe(independent.bookings);
    expect(independent.bookings[1].scheduledInMinutes).toBe(10);
  });

  it("keeps long completed bookings wholly in the past, including unassigned work", () => {
    const demo = deriveDemoBusiness(ALL_ARCHETYPES.find(a => a.archetypeId === "software-platform")!);
    const base = demo.demand[0];
    demo.demand = [0, 1, 2].map(i => ({ ...base, key: `past-${i}`, stageKey: "settle", queueKey: undefined,
      assignedResourceKey: i === 0 ? undefined : demo.resources[0].key }));
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS, defaultDurationMinutes: 120 });
    for (const booking of plan.bookings) expect(booking.scheduledInMinutes + booking.durationMinutes).toBeLessThanOrEqual(0);
    expectCapacitySafe(plan.bookings);
    expect(plan.bookings.every(b => b.status === "completed")).toBe(true);
  });

  it("maps every archetype onto a reversible, demo-tagged plan", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });

      // Every business ref carries the demo prefix (reversible teardown).
      for (const p of plan.providers) expect(p.providerId.startsWith(DEMO_REF_PREFIX)).toBe(true);
      for (const s of plan.suppliers) expect(s.supplierId.startsWith(DEMO_REF_PREFIX)).toBe(true);
      for (const b of plan.bills) expect(b.billRef.startsWith(DEMO_REF_PREFIX)).toBe(true);
      for (const bk of plan.bookings) expect(bk.bookingRef.startsWith(DEMO_REF_PREFIX)).toBe(true);
      for (const e of plan.employees) expect(e.employeeRef.startsWith(DEMO_REF_PREFIX)).toBe(true);

      // Bookings attach to a provided item and, when assigned, to a demo provider.
      const providerRefs = new Set(plan.providers.map((p) => p.providerId));
      for (const bk of plan.bookings) {
        expect(ITEM_IDS).toContain(bk.itemId);
        if (bk.providerId) expect(providerRefs.has(bk.providerId)).toBe(true);
        expect(bk.customerEmail).toContain("@");
      }

      // Bills reference a supplier the plan also creates (FK-safe).
      const supplierRefs = new Set(plan.suppliers.map((s) => s.supplierId));
      for (const b of plan.bills) expect(supplierRefs.has(b.supplierId)).toBe(true);

      // One booking per demand item; one employee per human worker.
      expect(plan.bookings).toHaveLength(demo.demand.length);
      expect(plan.employees).toHaveLength(demo.workforce.filter((w) => w.kind === "human").length);
      expect(plan.providers).toHaveLength(demo.resources.length);
    }
  });

  it("maps queue state → booking status and preserves wait-time", () => {
    const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === "dental-practice") ?? ALL_ARCHETYPES[0];
    const demo = deriveDemoBusiness(archetype);
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });

    demo.demand.forEach((item, i) => {
      const bk = plan.bookings[i];
      expect(bk.createdMinutesAgo).toBe(item.waitingMinutes);
      if (item.queueKey) expect(bk.status).toBe("pending");
      else if (item.stageKey === "settle") expect(bk.status).toBe("completed");
      else expect(bk.status).toBe("confirmed");
    });

    // A pending booking's wait-time is the queue age; it is scheduled in the future.
    const pending = plan.bookings.filter((b) => b.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
    for (const b of pending) {
      expect(b.createdMinutesAgo).toBeGreaterThanOrEqual(1);
      expect(b.scheduledInMinutes).toBeGreaterThan(0);
    }
  });

  it("carries the currency and reuses one supplier ref across bills", () => {
    const demo = deriveDemoBusiness(ALL_ARCHETYPES[0], { flavor: { currency: "USD" } });
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });
    expect(plan.currency).toBe("USD");
    for (const b of plan.bills) expect(b.currency).toBe("USD");
    // Deduped: never more suppliers than bills.
    expect(plan.suppliers.length).toBeLessThanOrEqual(plan.bills.length);
  });

  it("throws rather than write orphaned bookings when no items exist", () => {
    const demo = deriveDemoBusiness(ALL_ARCHETYPES[0]);
    expect(() => planDemoLoad(demo, { storefrontId: "sf-1", itemIds: [] })).toThrow();
  });
});

describe("demoTeardownSpec", () => {
  it("scopes teardown prefixes per archetype and globally", () => {
    const scoped = demoTeardownSpec("dental-practice");
    expect(scoped.bookingRefPrefix).toBe("demo-dental-practice-bk-");
    expect(scoped.providerRefPrefix).toBe("demo-dental-practice-prov-");
    const global = demoTeardownSpec();
    expect(global.bookingRefPrefix).toBe(DEMO_REF_PREFIX);
  });

  it("teardown prefixes actually match the refs a plan produces", () => {
    const demo = deriveDemoBusiness(ALL_ARCHETYPES[0], { seed: "dental-practice" });
    const plan = planDemoLoad(demo, { storefrontId: "sf-1", itemIds: ITEM_IDS });
    const spec = demoTeardownSpec(demo.archetypeId);
    for (const bk of plan.bookings) expect(bk.bookingRef.startsWith(spec.bookingRefPrefix)).toBe(true);
    for (const p of plan.providers) expect(p.providerId.startsWith(spec.providerRefPrefix)).toBe(true);
    for (const b of plan.bills) expect(b.billRef.startsWith(spec.billRefPrefix)).toBe(true);
    for (const s of plan.suppliers) expect(s.supplierId.startsWith(spec.supplierRefPrefix)).toBe(true);
    for (const e of plan.employees) expect(e.employeeRef.startsWith(spec.employeeRefPrefix)).toBe(true);
  });
});

describe("isSafeToLoadDemo", () => {
  it("refuses to load over a real operating business", () => {
    expect(isSafeToLoadDemo({ bookings: 0, invoices: 0 })).toBe(true);
    expect(isSafeToLoadDemo({ bookings: 3, invoices: 0 })).toBe(false);
    expect(isSafeToLoadDemo({ bookings: 0, invoices: 2 })).toBe(false);
  });
});
