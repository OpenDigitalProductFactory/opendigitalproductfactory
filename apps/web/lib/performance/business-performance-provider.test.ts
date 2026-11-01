import { describe, expect, it, vi } from "vitest";
import { SOFTWARE_LEDGER_DEFINITION_VERSION } from "./software-ledger-metrics";
import { ledgerMonthWindow } from "@/lib/finance/ledger-period-report";

import {
  buildBusinessPerformanceReadModel,
  createBusinessPerformanceProvider,
  loadBusinessPerformance,
  type PersistedMetricRow,
} from "./business-performance-provider";

const row = (
  metricKey: string,
  periodStart: string,
  value: number | null,
  availability: "available" | "unavailable" = value === null ? "unavailable" : "available",
  overrides: Partial<PersistedMetricRow> = {},
): PersistedMetricRow => ({
  metricKey,
  periodStart: new Date(periodStart),
  periodEnd: new Date(new Date(periodStart).getTime() + 86_400_000),
  timezone: "America/Chicago",
  value,
  unit: metricKey === "covers" ? "count" : "duration",
  availability,
  unavailableReason: availability === "unavailable" ? "Canonical source is not connected." : null,
  definitionVersion: "restaurant-v1",
  sourceWatermark: new Date("2026-08-01T01:30:00.000Z"),
  computedAt: new Date("2026-08-01T01:30:00.000Z"),
  sourceLineage: { sourceModels: ["HospitalityServiceTurn"], sourceRows: 3 },
  ...overrides,
});

describe("buildBusinessPerformanceReadModel", () => {
  it("selects the latest period, joins prior-period comparisons, and retains unavailable truth", () => {
    const model = buildBusinessPerformanceReadModel({
      archetypeId: "restaurant",
      rows: [
        row("covers", "2026-07-30T05:00:00.000Z", 80),
        row("covers", "2026-07-31T05:00:00.000Z", 100),
        row("turn-time", "2026-07-31T05:00:00.000Z", null),
      ],
      now: new Date("2026-08-01T02:00:00.000Z"),
    });

    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.periodLabel).toBe("Jul 31, 2026");
    expect(model.freshness).toBe("fresh");
    expect(model.availablePeriods).toEqual([
      { key: "2026-07-31", label: "Jul 31, 2026", selected: true },
      { key: "2026-07-30", label: "Jul 30, 2026", selected: false },
    ]);
    expect(model.trendPoints).toEqual([
      { periodKey: "2026-07-30", periodLabel: "Jul 30, 2026", values: expect.objectContaining({ covers: 80 }) },
      { periodKey: "2026-07-31", periodLabel: "Jul 31, 2026", values: expect.objectContaining({ covers: 100 }) },
    ]);
    expect(model.metricValues.find((metric) => metric.key === "covers")).toMatchObject({
      value: 100,
      comparisonValue: 80,
      comparisonDelta: 0.25,
      availability: "available",
    });
    expect(model.metricValues.find((metric) => metric.key === "turn-time")).toMatchObject({
      value: null,
      availability: "unavailable",
      unavailableReason: "Canonical source is not connected.",
    });
  });

  it("classifies an old snapshot as stale without discarding it", () => {
    const model = buildBusinessPerformanceReadModel({
      archetypeId: "restaurant",
      rows: [row("covers", "2026-07-31T05:00:00.000Z", 100)],
      now: new Date("2026-08-01T05:00:01.000Z"),
    });
    expect(model).toMatchObject({ status: "ready", freshness: "stale" });
  });

  it("uses the oldest metric watermark so one fresh metric cannot hide a stale sibling", () => {
    const model = buildBusinessPerformanceReadModel({
      archetypeId: "restaurant",
      rows: [
        row("covers", "2026-07-31T05:00:00.000Z", 100),
        row("turn-time", "2026-07-31T05:00:00.000Z", 70, "available", {
          sourceWatermark: new Date("2026-07-31T20:00:00.000Z"),
        }),
      ],
      now: new Date("2026-08-01T02:00:00.000Z"),
    });

    expect(model).toMatchObject({
      status: "ready",
      freshness: "stale",
      asOf: new Date("2026-07-31T20:00:00.000Z"),
    });
  });

  it("honors a valid requested period and compares it with the next earlier period", () => {
    const model = buildBusinessPerformanceReadModel({
      archetypeId: "restaurant",
      selectedPeriod: "2026-07-30",
      rows: [
        row("covers", "2026-07-29T05:00:00.000Z", 70),
        row("covers", "2026-07-30T05:00:00.000Z", 80),
        row("covers", "2026-07-31T05:00:00.000Z", 100),
      ],
    });
    expect(model).toMatchObject({ status: "ready", periodLabel: "Jul 30, 2026" });
    if (model.status !== "ready") return;
    expect(model.metricValues.find((metric) => metric.key === "covers")).toMatchObject({
      value: 80,
      comparisonValue: 70,
    });
  });
});

function softwareRows(period: string, values: [number, number, number] | null, checked = "2026-10-15T12:00:00Z", currency = "EUR") {
  const window = ledgerMonthWindow(new Date(`${period}-01T00:00:00Z`));
  return ["posted-ledger-income", "posted-ledger-expenses", "posted-ledger-net-result"].map((key, index) =>
    row(key, window.start.toISOString(), values?.[index] ?? null, values ? "available" : "unavailable", {
      periodEnd: window.end, timezone: "UTC", unit: "currency", definitionVersion: SOFTWARE_LEDGER_DEFINITION_VERSION,
      sourceWatermark: new Date(checked), computedAt: new Date(checked),
      sourceLineage: { sourceModels: ["LedgerAccount", "JournalEntry", "JournalLine"], sourceRows: values ? 16 : null,
        currency: values ? currency : null, generation: new Date(checked).toISOString(), coverage: "recorded-postings-only" },
    }));
}
const softwareModel = (rows: PersistedMetricRow[], extra: { selectedPeriod?: string; now?: Date } = {}) =>
  buildBusinessPerformanceReadModel({ organizationId: "org-a", archetypeId: "software-platform", rows,
    now: new Date("2026-10-15T12:30:00Z"), ...extra });

describe("software recorded results read model", () => {
  it("uses explicit UTC ledger months and actual currency, suppressing partial/full percentage comparison", () => {
    const model = softwareModel([...softwareRows("2026-09", [1000, 100, 900]), softwareRows("2026-10", [1200, 200, 1000])].flat());
    expect(model).toMatchObject({ status: "ready", periodLabel: "Oct 2026", reportingCurrency: "EUR", periodState: "in-progress" });
    if (model.status !== "ready") return;
    expect(model.availablePeriods.map(p => p.key)).toEqual(["2026-10", "2026-09"]);
    expect(model.metricValues.every(m => m.comparisonDelta === null)).toBe(true);
    expect(model.metricValues.find(m => m.key === "posted-ledger-income")).toMatchObject({ value: 1200, comparisonValue: 1000, currency: "EUR" });
  });

  it("retains past source age instead of treating an ended month as forever fresh", () => {
    expect(softwareModel(softwareRows("2026-09", [1200, 200, 1000], "2026-10-01T01:00:00Z"))).toMatchObject({ status: "ready", freshness: "stale" });
  });

  it("preserves recorded zero separately from an explicitly unavailable period", () => {
    const zero = softwareModel(softwareRows("2026-10", [0, 200, -200]));
    expect(zero.status).toBe("ready");
    if (zero.status === "ready") expect(zero.metricValues[0]).toMatchObject({ value: 0, availability: "available" });
    const missing = softwareModel(softwareRows("2026-10", null));
    expect(missing).toMatchObject({ status: "ready", reportingCurrency: null });
    if (missing.status === "ready") expect(missing.metricValues.every(m => m.value === null && m.availability === "unavailable")).toBe(true);
  });

  it("refuses incomplete or mixed saved packs without displaying a partial financial result", () => {
    const rows = softwareRows("2026-10", [1200, 200, 1000]);
    expect(softwareModel(rows.slice(0, 2))).toMatchObject({ status: "not-configured", reason: expect.stringMatching(/incomplete|inconsistent/i) });
    rows[0]!.computedAt = new Date("2026-10-15T13:00:00Z");
    expect(softwareModel(rows)).toMatchObject({ status: "not-configured", metricValues: [] });
  });

  it("uses only this pack's history and strips raw extra lineage", () => {
    const rows = softwareRows("2026-10", [1200, 200, 1000]);
    rows.forEach(r => { r.sourceLineage = { ...(r.sourceLineage as object), privateMemo: "secret-fixture", sourceId: "private-id" }; });
    const model = softwareModel([...rows, row("covers", "2028-01-01T00:00:00Z", 20)]);
    expect(model).toMatchObject({ status: "ready", periodLabel: "Oct 2026" });
    expect(JSON.stringify(model)).not.toMatch(/secret-fixture|private-id|privateMemo/);
  });

  it("does not fall back to another period on a malformed software month", () => {
    expect(softwareModel(softwareRows("2026-10", [1200, 200, 1000]), { selectedPeriod: "2026-13" }))
      .toMatchObject({ status: "not-configured", metricValues: [] });
  });

  it("never compares unlike currencies or invents conversion", () => {
    const rows = [...softwareRows("2026-08", [1000, 100, 900], "2026-10-15T12:00:00Z", "USD"),
      ...softwareRows("2026-09", [1200, 200, 1000])];
    const model = softwareModel(rows);
    expect(model.status).toBe("ready");
    if (model.status === "ready") expect(model.metricValues.every(m => m.comparisonValue === null && m.comparisonDelta === null)).toBe(true);
  });

  it("offers the native scoped finance next action when software history is missing", () => {
    expect(softwareModel([])).toMatchObject({ status: "not-configured", applicable: true,
      nextAction: { href: "/finance/reports/general-ledger?period=2026-10", label: "Review finance records" } });
  });
});

describe("loadBusinessPerformance", () => {
  it("returns an attributed setup state without fabricated metric values", async () => {
    await expect(
      loadBusinessPerformance({ userId: "user-owner" }, {
        async load() {
          return {
            status: "not-configured",
            reason: "No rollup exists yet.",
            asOf: null,
            metricValues: [],
            source: "business-performance-read-model",
            applicable: true,
          };
        },
      }),
    ).resolves.toMatchObject({
      status: "not-configured",
      reason: "No rollup exists yet.",
      metricValues: [],
    });
  });

  it("loads only the authenticated user's current organization when multiple organizations exist", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: "org-current" })),
      },
      storefrontConfig: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-current",
          archetype: { archetypeId: "restaurant" },
        })),
        findMany: vi.fn(),
      },
      businessMetricRollup: {
        findMany: vi.fn(async () => []),
      },
    };

    await createBusinessPerformanceProvider(db as never).load({ userId: "user-owner" });

    expect(db.platformSetupProgress.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-owner" },
      select: { organizationId: true },
    });
    expect(db.storefrontConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-current" },
    }));
    expect(db.storefrontConfig.findMany).not.toHaveBeenCalled();
    expect(db.businessMetricRollup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-current" },
    }));
  });

  it("tells the truth (and reads no rollups) when the archetype has no metrics engine", async () => {
    // BI-F359E1E9: a non-hospitality install would never produce a snapshot, so
    // the surface must say "not available for this business type", not imply one
    // is pending — and it must not run the rollup query at all.
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: "org-platform" })),
      },
      storefrontConfig: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-platform",
          archetype: { archetypeId: "hair-salon" },
        })),
        findMany: vi.fn(),
      },
      businessMetricRollup: {
        findMany: vi.fn(),
      },
    };

    const result = await createBusinessPerformanceProvider(db as never).load({ userId: "user-owner" });

    expect(result).toMatchObject({
      status: "not-configured",
      applicable: false,
      reason: expect.stringContaining("not available for this business type"),
    });
    expect(db.businessMetricRollup.findMany).not.toHaveBeenCalled();
  });

  it("keeps the pending (applicable) state for a supported archetype with no snapshot yet", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: "org-current" })),
      },
      storefrontConfig: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-current",
          archetype: { archetypeId: "restaurant" },
        })),
        findMany: vi.fn(),
      },
      businessMetricRollup: {
        findMany: vi.fn(async () => []),
      },
    };

    const result = await createBusinessPerformanceProvider(db as never).load({ userId: "user-owner" });

    expect(result).toMatchObject({ status: "not-configured", applicable: true });
    expect(db.businessMetricRollup.findMany).toHaveBeenCalled();
  });

  it("refuses an unmapped user in a multi-organization install without reading any rollups", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => null),
      },
      storefrontConfig: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { organizationId: "org-a", archetype: { archetypeId: "restaurant" } },
          { organizationId: "org-b", archetype: { archetypeId: "restaurant" } },
        ]),
      },
      businessMetricRollup: {
        findMany: vi.fn(),
      },
    };

    const result = await createBusinessPerformanceProvider(db as never).load({ userId: "user-unmapped" });

    expect(result).toMatchObject({
      status: "not-configured",
      reason: expect.stringContaining("current organization"),
    });
    expect(db.storefrontConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(db.storefrontConfig.findUnique).not.toHaveBeenCalled();
    expect(db.businessMetricRollup.findMany).not.toHaveBeenCalled();
  });

  it("keeps the legacy fallback only when exactly one storefront organization exists", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: null })),
      },
      storefrontConfig: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { organizationId: "org-only", archetype: { archetypeId: "restaurant" } },
        ]),
      },
      businessMetricRollup: {
        findMany: vi.fn(async () => []),
      },
    };

    await createBusinessPerformanceProvider(db as never).load({ userId: "legacy-owner" });

    expect(db.businessMetricRollup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-only" },
    }));
  });
});

function softwareProviderFixture(role: string | null = "HR-000", active = true) {
  const db = {
    user: { findUnique: vi.fn(async () => role === null ? null : ({ isActive: active, isSuperuser: false, automationExpiresAt: null, groups: [{ platformRole: { roleId: role } }] })) },
    platformSetupProgress: { findUnique: vi.fn(async () => ({ organizationId: "org-a" })) },
    storefrontConfig: { findUnique: vi.fn(async () => ({ organizationId: "org-a", archetype: { archetypeId: "software-platform" } })), findMany: vi.fn(async () => []) },
    businessMetricRollup: { findMany: vi.fn(async () => softwareRows("2026-10", [1200, 200, 1000])) },
  };
  return db;
}
it.each([["HR-500", true], ["HR-200", true], [null, true], ["HR-000", false]] as const)("does not read software financial projections for denied actor %s active=%s", async (role, active) => {
  const db = softwareProviderFixture(role, active);
  const result = await createBusinessPerformanceProvider(db as never).load({ userId: "actor" });
  expect(result).toMatchObject({ status: "not-configured", metricValues: [] });
  expect(db.businessMetricRollup.findMany).not.toHaveBeenCalled();
});
it("reads the actual current owner membership and only its resolved organization's software pack", async () => {
  const db = softwareProviderFixture();
  const result = await createBusinessPerformanceProvider(db as never).load({ userId: "owner", organizationId: "org-b" } as { userId: string });
  expect(result.status).toBe("ready");
  expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owner" } }));
  expect(db.businessMetricRollup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a" }) }));
});
it("immediately labels retained valid results stale after a failed validation attempt without advancing source age", () => {
  const rows = softwareRows("2026-10", [1200, 200, 1000]);
  rows.forEach(row => { row.sourceLineage = { ...(row.sourceLineage as object), refreshFailure: { at: "2026-10-15T12:15:00.000Z", kind: "source-unavailable" } }; });
  const result = softwareModel(rows);
  expect(result).toMatchObject({ status: "ready", freshness: "stale", asOf: new Date("2026-10-15T12:00:00Z"), refreshFailure: { at: "2026-10-15T12:15:00.000Z" } });
  if (result.status === "ready") expect(result.metricValues.map(row => row.value)).toEqual([1200, 200, 1000]);
});
