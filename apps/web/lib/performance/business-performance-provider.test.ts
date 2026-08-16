import { describe, expect, it, vi } from "vitest";

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
