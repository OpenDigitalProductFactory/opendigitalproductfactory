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
