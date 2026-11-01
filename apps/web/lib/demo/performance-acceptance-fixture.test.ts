import { describe, expect, it, vi } from "vitest";

import { seedPerformanceAcceptanceFixture } from "./performance-acceptance-fixture";

function fakeDb(input: { demoBookings?: number; ownerOrg?: string | null } = {}) {
  const rollups = new Map<string, any>();
  const tasks = new Map<string, any>();
  const db: any = {
    storefrontConfig: {
      findUnique: vi.fn(async () => ({
        id: "sf-1",
        organizationId: "org-1",
        timezone: "America/Chicago",
        archetype: { archetypeId: "restaurant" },
      })),
    },
    storefrontBooking: { count: vi.fn(async () => input.demoBookings ?? 7) },
    platformSetupProgress: {
      findUnique: vi.fn(async () => ({ organizationId: input.ownerOrg === undefined ? "org-1" : input.ownerOrg })),
    },
    businessMetricRollup: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = JSON.stringify(where);
        rollups.set(key, rollups.has(key) ? { ...rollups.get(key), ...update } : create);
        return rollups.get(key);
      }),
    },
    scheduledAgentTask: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.taskId;
        tasks.set(key, tasks.has(key) ? { ...tasks.get(key), ...update } : create);
        return tasks.get(key);
      }),
    },
  };
  return { db, rollups, tasks };
}

describe("seedPerformanceAcceptanceFixture", () => {
  it("idempotently seeds two populated periods and one org-scoped watched question", async () => {
    const { db, rollups, tasks } = fakeDb();
    const now = new Date("2026-08-12T18:00:00.000Z");

    const first = await seedPerformanceAcceptanceFixture({
      database: db,
      organizationId: "org-1",
      storefrontId: "sf-1",
      ownerUserId: "owner-1",
      now,
    });
    const second = await seedPerformanceAcceptanceFixture({
      database: db,
      organizationId: "org-1",
      storefrontId: "sf-1",
      ownerUserId: "owner-1",
      now,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ rollups: 14, watchedQuestions: 1 });
    expect(rollups).toHaveLength(14);
    expect(tasks).toHaveLength(1);
    const current = [...rollups.values()].filter((row) => row.periodEnd > now);
    expect(current.find((row) => row.metricKey === "covers")).toMatchObject({
      value: 96,
      availability: "available",
      definitionVersion: "restaurant-v1",
      dimensions: { storefrontId: "sf-1" },
      sourceLineage: { fixture: true },
    });
    expect(current.find((row) => row.metricKey === "sales")).toMatchObject({ value: null, availability: "unavailable" });
    expect(Math.min(...current.map((row) => row.sourceWatermark.getTime())))
      .toBe(now.getTime() - 90 * 60_000);
    expect([...tasks.values()][0]).toMatchObject({
      ownerUserId: "owner-1",
      organizationId: "org-1",
      taskKind: "business-analysis-watch",
      routeContext: "/performance",
    });
    expect([...tasks.values()][0].taskConfig.lastEvaluation.status).toBe("material-change");
  });

  it("refuses a non-demo or cross-organization target before writes", async () => {
    const noDemo = fakeDb({ demoBookings: 0 });
    await expect(seedPerformanceAcceptanceFixture({
      database: noDemo.db, organizationId: "org-1", storefrontId: "sf-1", ownerUserId: "owner-1",
    })).rejects.toThrow(/seeded restaurant demo/i);
    expect(noDemo.db.businessMetricRollup.upsert).not.toHaveBeenCalled();

    const wrongOwner = fakeDb({ ownerOrg: "org-2" });
    await expect(seedPerformanceAcceptanceFixture({
      database: wrongOwner.db, organizationId: "org-1", storefrontId: "sf-1", ownerUserId: "owner-1",
    })).rejects.toThrow(/current organization/i);
    expect(wrongOwner.db.businessMetricRollup.upsert).not.toHaveBeenCalled();
  });
});

import { seedSoftwarePerformanceAcceptanceFixture } from "./performance-acceptance-fixture";
function softwareFixture() {
  const tx: any = {
    storefrontConfig: { findUnique: vi.fn(async () => ({ organizationId: "org-1", archetype: { archetypeId: "software-platform" } })) },
    platformSetupProgress: { findUnique: vi.fn(async () => ({ organizationId: "org-1" })) },
    user: { findUnique: vi.fn(async () => ({ platformRole: "HR-000", isSuperuser: false })) },
    storefrontBooking: { count: vi.fn(async () => 1) },
    journalEntry: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    ledgerAccount: { upsert: vi.fn(async (args: any) => ({ id: args.create.code })) },
  };
  const database: any = { $transaction: vi.fn(async (work: any) => work(tx)) };
  const input = { database, organizationId: "org-1", storefrontId: "sf-1", ownerUserId: "owner-1",
    target: { environmentClass: "development", databaseHost: "dev-postgres", databaseName: "dpf" }, now: new Date("2026-10-31T12:00:00Z") };
  return { tx, database, input };
}
it.each(["production", "undeclared"])("refuses %s fixture targets before any data read or write", async environmentClass => {
  const { input, database } = softwareFixture();
  await expect(seedSoftwarePerformanceAcceptanceFixture({ ...input, target: { ...input.target, environmentClass } })).rejects.toThrow(/disposable preview/);
  expect(database.$transaction).not.toHaveBeenCalled();
});
it("refuses a production database address even when environment says development", async () => {
  const { input, database } = softwareFixture();
  await expect(seedSoftwarePerformanceAcceptanceFixture({ ...input, target: { ...input.target, databaseHost: "postgres" } })).rejects.toThrow(/disposable preview/);
  expect(database.$transaction).not.toHaveBeenCalled();
});
it.each(["operating-journal", "foreign-owner", "no-demo", "worker", "foreign-ref"])("refuses %s before financial writes", async scenario => {
  const { input, tx } = softwareFixture();
  if (scenario === "operating-journal") tx.journalEntry.count.mockResolvedValue(1);
  if (scenario === "foreign-owner") tx.platformSetupProgress.findUnique.mockResolvedValue({ organizationId: "org-2" });
  if (scenario === "no-demo") tx.storefrontBooking.count.mockResolvedValue(0);
  if (scenario === "worker") tx.user.findUnique.mockResolvedValue({ platformRole: "HR-500", isSuperuser: false });
  if (scenario === "foreign-ref") tx.journalEntry.findMany.mockResolvedValue([{ organizationId: "org-2", sourceType: "PerformanceAcceptanceFixture" }]);
  await expect(seedSoftwarePerformanceAcceptanceFixture(input)).rejects.toThrow(/fixture|demo|owner|scope/i);
  expect(tx.ledgerAccount.upsert).not.toHaveBeenCalled(); expect(tx.journalEntry.upsert).not.toHaveBeenCalled();
});
it("writes balanced source journals with stable fixture refs for populated, zero and empty scenarios", async () => {
  const { input, tx } = softwareFixture();
  await seedSoftwarePerformanceAcceptanceFixture(input);
  const originalRefs = tx.journalEntry.upsert.mock.calls.map(([args]: any) => args.where.entryRef);
  expect(originalRefs).toHaveLength(4);
  expect(tx.journalEntry.upsert.mock.calls[0][0].create.lines.create[0].debit).toBe(1200);
  tx.journalEntry.upsert.mockClear();
  await seedSoftwarePerformanceAcceptanceFixture({ ...input, scenario: "zero" });
  expect(tx.journalEntry.upsert.mock.calls.map(([args]: any) => args.where.entryRef)).toEqual(originalRefs);
  expect(tx.journalEntry.upsert.mock.calls[0][0].create.lines.create[0].debit).toBe(200);
  tx.journalEntry.upsert.mockClear();
  await seedSoftwarePerformanceAcceptanceFixture({ ...input, scenario: "empty" });
  expect(tx.journalEntry.upsert.mock.calls.every(([args]: any) => args.update.status === "draft")).toBe(true);
});
