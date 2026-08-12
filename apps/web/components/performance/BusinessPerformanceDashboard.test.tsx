import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/report-kit/Chart", () => ({
  Chart: () => <div data-component="trend-chart" />,
}));

import type { ReadyBusinessPerformance } from "@/lib/performance/business-performance-provider";
import { BusinessPerformanceDashboard } from "./BusinessPerformanceDashboard";

const performance: ReadyBusinessPerformance = {
  status: "ready",
  archetypeId: "restaurant",
  periodLabel: "Jul 31, 2026",
  periodStart: new Date("2026-07-31T05:00:00.000Z"),
  periodEnd: new Date("2026-08-01T05:00:00.000Z"),
  timezone: "America/Chicago",
  asOf: new Date("2026-08-01T01:30:00.000Z"),
  freshness: "fresh",
  periodState: "in-progress",
  availablePeriods: [
    { key: "2026-07-31", label: "Jul 31, 2026", selected: true },
    { key: "2026-07-30", label: "Jul 30, 2026", selected: false },
  ],
  source: "business-performance-read-model",
  trendPoints: [
    { periodKey: "2026-07-30", periodLabel: "Jul 30, 2026", values: { covers: 80, "turn-time": 70 } },
    { periodKey: "2026-07-31", periodLabel: "Jul 31, 2026", values: { covers: 100, "turn-time": null } },
  ],
  sections: {
    headline: ["covers", "turn-time"],
    operating: ["turn-time"],
    financial: [],
    customer: [],
    workforce: [],
  },
  metricValues: [
    {
      key: "covers",
      label: "Covers",
      unit: "count",
      value: 100,
      comparisonValue: 80,
      comparisonDelta: 0.25,
      availability: "available",
      unavailableReason: null,
      definition: "count seated guests",
      definitionVersion: "restaurant-v1",
      sourceOwner: "restaurant-service",
      sourceWatermark: new Date("2026-08-01T01:30:00.000Z"),
      sourceLineage: { sourceModels: ["HospitalityServiceTurn"], sourceRows: 20 },
      drilldownRoute: "/workspace",
    },
    {
      key: "turn-time",
      label: "Turn time",
      unit: "duration",
      value: null,
      comparisonValue: null,
      comparisonDelta: null,
      availability: "unavailable",
      unavailableReason: "No completed service turns exist in this period.",
      definition: "median seated-to-available duration",
      definitionVersion: "restaurant-v1",
      sourceOwner: "restaurant-floor",
      sourceWatermark: new Date("2026-08-01T01:30:00.000Z"),
      sourceLineage: { sourceModels: ["HospitalityServiceTurn"], sourceRows: 0 },
      drilldownRoute: "/workspace",
    },
  ],
};

describe("BusinessPerformanceDashboard", () => {
  it("renders comparisons, unavailable reasons, lineage, drilldown, and scoped export", () => {
    const html = renderToStaticMarkup(
      <BusinessPerformanceDashboard performance={performance} />,
    );

    expect(html).toContain("Jul 31, 2026");
    expect(html).toContain("100");
    expect(html).toContain("+25%");
    expect(html).toContain("Not available");
    expect(html).toContain("No completed service turns exist in this period.");
    expect(html).toContain("How this is calculated");
    expect(html).toContain("HospitalityServiceTurn");
    expect(html).toContain('href="/workspace"');
    expect(html).toContain("Export this period");
    expect(html).toContain("Oldest source update");
    expect(html).toContain("Source updated");
    expect(html).toContain("What changed");
    expect(html).toContain("Why it changed");
    expect(html).toContain("What deserves review");
    expect(html).toContain("Observation, not a recommendation");
    expect(html).toContain("do not yet prove what caused the change");
    expect(html.indexOf("Headline performance")).toBeLessThan(html.indexOf("Owner brief"));
    expect(html).toContain('href="/performance?period=2026-07-30"');
    expect(html).toContain("Trends");
    expect(html).toContain("View trend as a table");
  });
});
