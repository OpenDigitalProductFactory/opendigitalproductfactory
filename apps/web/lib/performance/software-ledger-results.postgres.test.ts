import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
const connection = process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const binding = vi.hoisted(() => ({ db: null as any }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  if (!binding.db) throw new Error("isolated PostgreSQL fixture not initialized");
  const value = binding.db[key]; return typeof value === "function" ? value.bind(binding.db) : value;
} }) }));
import { aggregateBusinessMetrics } from "./business-metric-rollup";
import { defaultBusinessMetricRollupDeps } from "./business-metric-rollup.server";

// This lane accepts only the existing canonical disposable local-CI database.
const admitted = (() => { try { const url = new URL(connection ?? "invalid:");
  return ["localhost", "127.0.0.1"].includes(url.hostname) && /^\/dpf_local_ci_[01]$/.test(url.pathname);
} catch { return false; } })();
const schema = `review_software_results_${randomUUID().replaceAll("-", "")}`;
describe.skipIf(!admitted)("software source to saved results in isolated migrated PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  const at = new Date("2026-10-31T12:00:00Z");
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: connection!, schema,
      tables: ["LedgerAccount", "JournalEntry", "JournalLine", "BusinessMetricRollup"] });
    binding.db = fixture.db;
    for (const organizationId of ["results-org-a", "results-org-b"]) {
      for (const [code, type, normalBalance] of [["ar", "asset", "debit"], ["income", "revenue", "credit"], ["expense", "expense", "debit"], ["ap", "liability", "credit"]] as const) {
        await fixture.db.ledgerAccount.create({ data: { id: `${organizationId}-${code}`, organizationId, code,
          name: code, type, normalBalance, currency: "EUR" } });
      }
      for (const [key, debit, credit, amount] of [["sale", "ar", "income", organizationId.endsWith("a") ? 1200 : 9000], ["cost", "expense", "ap", 200]] as const) {
        await fixture.db.journalEntry.create({ data: { id: `${organizationId}-${key}`, entryRef: `${organizationId}-${key}`,
          organizationId, periodKey: "2026-10", status: "posted", currency: "EUR", entryDate: at,
          lines: { create: [{ accountId: `${organizationId}-${debit}`, debit: amount, credit: 0, currency: "EUR" },
            { accountId: `${organizationId}-${credit}`, debit: 0, credit: amount, currency: "EUR" }] } } });
      }
    }
  });
  afterAll(async () => { binding.db = null; await fixture?.close(); });
  const run = (now: Date) => {
    const deps = defaultBusinessMetricRollupDeps();
    return aggregateBusinessMetrics({ ...deps, listRestaurantContexts: async () => [],
      software: { ...deps.software!, listContexts: async () => [{ organizationId: "results-org-a", storefrontId: "results-sf-a" }] } }, now);
  };
  const saved = () => fixture.db.businessMetricRollup.findMany({ where: { organizationId: "results-org-a",
    periodStart: new Date("2026-10-01T00:00:00Z") }, orderBy: { metricKey: "asc" },
    select: { metricKey: true, value: true, availability: true, computedAt: true, sourceWatermark: true } });
  it("persists one scoped pack, rolls back a later row failure and recovers without duplicates", async () => {
    await run(at);
    const before = await saved();
    expect(before.map(row => Number(row.value))).toEqual([200, 1200, 1000]);
    expect(before.every(row => row.availability === "available" && row.computedAt.getTime() === at.getTime())).toBe(true);
    expect(await fixture.db.businessMetricRollup.count({ where: { organizationId: "results-org-b" } })).toBe(0);
    await fixture.pool.query(`ALTER TABLE "BusinessMetricRollup" ADD CONSTRAINT results_fixture_fault CHECK (NOT ("metricKey"='posted-ledger-expenses' AND value=201))`);
    await fixture.db.journalLine.updateMany({ where: { journalEntryId: "results-org-a-cost", debit: 200 }, data: { debit: 201 } });
    await fixture.db.journalLine.updateMany({ where: { journalEntryId: "results-org-a-cost", credit: 200 }, data: { credit: 201 } });
    await expect(run(new Date(at.getTime() + 60000))).rejects.toThrow();
    expect(await saved()).toEqual(before);
    await fixture.pool.query(`ALTER TABLE "BusinessMetricRollup" DROP CONSTRAINT results_fixture_fault`);
    const recoveredAt = new Date(at.getTime() + 120000);
    await run(recoveredAt);
    expect((await saved()).map(row => Number(row.value))).toEqual([201, 1200, 999]);
    expect((await saved()).every(row => row.computedAt.getTime() === recoveredAt.getTime())).toBe(true);
    expect(await fixture.db.businessMetricRollup.count()).toBe(6);
    const recovered = await saved();
    await fixture.pool.query(`ALTER TABLE "JournalLine" RENAME TO "JournalLine_fixture_unavailable"`);
    try { await expect(run(new Date(at.getTime() + 180000))).rejects.toThrow(); expect(await saved()).toEqual(recovered); }
    finally { await fixture.pool.query(`ALTER TABLE "JournalLine_fixture_unavailable" RENAME TO "JournalLine"`); }
    await run(new Date(at.getTime() + 240000));
    expect(await fixture.db.businessMetricRollup.count()).toBe(6);
    expect((await saved()).map(row => Number(row.value))).toEqual([201, 1200, 999]);
  });
});
