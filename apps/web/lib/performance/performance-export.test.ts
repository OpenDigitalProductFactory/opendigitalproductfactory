import { describe, expect, it } from "vitest";

import type { ReadyBusinessPerformance } from "./business-performance-provider";
import { buildPerformanceExportRows } from "./performance-export";

describe("buildPerformanceExportRows", () => {
  it("exports only selected-period aggregates and excludes source lineage identifiers", () => {
    const performance = {
      status: "ready",
      periodLabel: "Jul 31, 2026",
      metricValues: [{
        label: "Covers",
        value: 42,
        unit: "count",
        availability: "available",
        unavailableReason: null,
        comparisonValue: 40,
        definitionVersion: "restaurant-v1",
        sourceWatermark: new Date("2026-08-01T01:00:00.000Z"),
        sourceLineage: {
          storefrontId: "sf-sensitive",
          customerId: "customer-never-export",
          sourceModels: ["HospitalityServiceTurn"],
        },
      }],
    } as unknown as ReadyBusinessPerformance;

    const rows = buildPerformanceExportRows(performance);
    expect(rows).toEqual([{
      period: "Jul 31, 2026",
      metric: "Covers",
      value: 42,
      unit: "count",
      availability: "available",
      unavailable_reason: "",
      prior_period_value: 40,
      definition_version: "restaurant-v1",
      source_watermark: "2026-08-01T01:00:00.000Z",
    }]);
    expect(JSON.stringify(rows)).not.toContain("customer-never-export");
    expect(JSON.stringify(rows)).not.toContain("sf-sensitive");
  });
});

it("exports financial currency and keeps an unavailable value null", () => {
  const performance = { periodLabel: "Oct 2026", metricValues: [{ label: "Posted income", value: null,
    unit: "currency", currency: "EUR", availability: "unavailable", unavailableReason: "Missing source",
    comparisonValue: null, definitionVersion: "software-ledger-v1", sourceWatermark: null }] } as unknown as ReadyBusinessPerformance;
  expect(buildPerformanceExportRows(performance)[0]).toMatchObject({ currency: "EUR", value: null, prior_period_value: null });
});

it("identifies retained financial exports after a failed refresh", () => {
  const input = { periodLabel: "Oct 2026", refreshFailure: { at: "2026-10-15T12:15:00.000Z", reason: "Source validation failed" },
    metricValues: [{ label: "Posted income", value: 1200, unit: "currency", currency: "EUR", availability: "available", unavailableReason: null,
      comparisonValue: null, definitionVersion: "software-ledger-v1", sourceWatermark: new Date("2026-10-15T12:00:00Z") }] } as unknown as ReadyBusinessPerformance;
  expect(buildPerformanceExportRows(input)[0]).toMatchObject({ value: 1200, snapshot_state: "retained-after-failed-refresh", refresh_failed_at: input.refreshFailure!.at });
});
