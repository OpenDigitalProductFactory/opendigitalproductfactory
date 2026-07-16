import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEMO_REF_PREFIX } from "@dpf/storefront-templates";

// The app-layer collaborators are mocked; we are testing the IO orchestration,
// not the reset/seed/playbook internals (those have their own coverage).
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/storefront/archetype-reset", () => ({
  resetStorefrontArchetype: vi.fn(async () => ({ storefrontId: "sf-1" })),
}));
vi.mock("@/lib/onboarding/setup-completion-seeds", () => ({
  runSetupCompletionSeeds: vi.fn(async () => undefined),
}));
vi.mock("@/lib/tak/marketing-playbooks", () => ({
  getPlaybook: () => ({ primaryGoal: "goal", keyMetrics: ["m1"] }),
}));
vi.mock("@/lib/onboarding/archetype-business-context", () => ({
  resolveBusinessProfile: () => ({ whoWeServe: "who" }),
}));

import { loadDemoBusiness, unloadDemoBusiness } from "./load-demo-business";
import { resetStorefrontArchetype } from "@/lib/storefront/archetype-reset";
import { runSetupCompletionSeeds } from "@/lib/onboarding/setup-completion-seeds";

/** Minimal in-memory prisma stand-in tracking upserts + deletes. */
function makeFakeDb(opts: { nonDemoBookings?: number; nonDemoInvoices?: number } = {}) {
  let seq = 0;
  const created: Record<string, string[]> = {
    provider: [],
    supplier: [],
    bill: [],
    booking: [],
    employee: [],
  };
  const model = (bucket: string, refField: string) => ({
    upsert: vi.fn(async ({ create }: any) => {
      created[bucket].push(create[refField]);
      return { id: `${bucket}-${seq++}` };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const prefix = where[refField].startsWith as string;
      const remaining = created[bucket].filter((r) => !r.startsWith(prefix));
      const count = created[bucket].length - remaining.length;
      created[bucket] = remaining;
      return { count };
    }),
    count: vi.fn(async () => 0),
  });
  const db: any = {
    organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
    storefrontItem: { findMany: vi.fn(async () => [{ itemId: "item-a" }, { itemId: "item-b" }]) },
    invoice: { count: vi.fn(async () => opts.nonDemoInvoices ?? 0) },
    serviceProvider: model("provider", "providerId"),
    supplier: model("supplier", "supplierId"),
    bill: model("bill", "billRef"),
    employeeProfile: model("employee", "employeeId"),
    storefrontBooking: {
      ...model("booking", "bookingRef"),
      count: vi.fn(async () => opts.nonDemoBookings ?? 0),
    },
  };
  return { db, created };
}

const ARCHETYPE = "dental-practice";

describe("loadDemoBusiness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads a demo, tagging every row with the demo prefix", async () => {
    const { db, created } = makeFakeDb();
    const result = await loadDemoBusiness(ARCHETYPE, { db, now: new Date(0) });

    expect(resetStorefrontArchetype).toHaveBeenCalledWith(
      expect.objectContaining({ targetArchetypeId: ARCHETYPE, mode: "replace-seeded-content" }),
    );
    expect(runSetupCompletionSeeds).toHaveBeenCalledWith("org-1");

    for (const bucket of Object.values(created)) {
      expect(bucket.length).toBeGreaterThan(0);
      for (const ref of bucket) expect(ref.startsWith(DEMO_REF_PREFIX)).toBe(true);
    }
    expect(result.storefrontId).toBe("sf-1");
    expect(result.counts.bookings).toBe(created.booking.length);
    expect(result.seededAt).toEqual(new Date(0));
  });

  it("refuses to load over real (non-demo) bookings unless forced", async () => {
    const { db } = makeFakeDb({ nonDemoBookings: 4 });
    await expect(loadDemoBusiness(ARCHETYPE, { db })).rejects.toThrow(/non-demo data/);
    expect(resetStorefrontArchetype).not.toHaveBeenCalled();
  });

  it("loads over non-demo data when force is set", async () => {
    const { db } = makeFakeDb({ nonDemoInvoices: 2 });
    await expect(loadDemoBusiness(ARCHETYPE, { db, force: true, now: new Date(0) })).resolves.toBeTruthy();
    expect(resetStorefrontArchetype).toHaveBeenCalled();
  });

  it("throws on an unknown archetype", async () => {
    const { db } = makeFakeDb();
    await expect(loadDemoBusiness("not-a-real-archetype", { db })).rejects.toThrow(/unknown archetype/);
  });
});

describe("unloadDemoBusiness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes only demo rows and reports counts", async () => {
    const { db } = makeFakeDb();
    await loadDemoBusiness(ARCHETYPE, { db, now: new Date(0) });
    const result = await unloadDemoBusiness({ archetypeId: ARCHETYPE, db });
    expect(result.removed.bookings).toBeGreaterThan(0);
    expect(result.removed.providers).toBeGreaterThan(0);
  });
});
