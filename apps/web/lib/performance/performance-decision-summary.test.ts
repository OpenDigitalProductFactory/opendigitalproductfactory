import { describe, expect, it } from "vitest";

import type { BusinessPerformanceMetricValue } from "./business-performance-provider";
import { buildPerformanceDecisionSummary } from "./performance-decision-summary";

function metric(
  key: string,
  comparisonDelta: number | null,
  overrides: Partial<BusinessPerformanceMetricValue> = {},
): BusinessPerformanceMetricValue {
  return {
    key,
    label: key,
    unit: "count",
    value: 10,
    comparisonValue: comparisonDelta === null ? null : 8,
    comparisonDelta,
    availability: "available",
    unavailableReason: null,
    definition: `definition for ${key}`,
    definitionVersion: "v1",
    sourceOwner: "test-source",
    sourceWatermark: new Date("2026-08-01T01:30:00.000Z"),
    sourceLineage: { sourceModels: ["TestFact"] },
    ...overrides,
  };
}

describe("buildPerformanceDecisionSummary", () => {
  it("ranks observed changes by magnitude instead of storage order", () => {
    const summary = buildPerformanceDecisionSummary({
      metrics: [metric("small", 0.05), metric("largest", -0.4), metric("medium", 0.2)],
      headlineKeys: ["small", "largest", "medium"],
    });

    expect(summary.observedChanges.map((item) => item.key)).toEqual([
      "largest",
      "medium",
      "small",
    ]);
  });

  it("calls unavailable headline metrics out for review without inventing desirability", () => {
    const summary = buildPerformanceDecisionSummary({
      metrics: [
        metric("covers", 0.25),
        metric("sales", null, {
          availability: "unavailable",
          value: null,
          unavailableReason: "No payment source is connected.",
        }),
      ],
      headlineKeys: ["covers", "sales"],
    });

    expect(summary.reviewItems).toEqual([
      {
        key: "sales",
        label: "sales",
        reason: "No payment source is connected.",
        kind: "missing-headline",
      },
      {
        key: "covers",
        label: "covers",
        reason: "Moved 25% versus the prior period; review context before acting.",
        kind: "observed-change",
      },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/good|bad|better|worse|favorable|unfavorable/i);
  });

  it("refuses to claim a cause when the read model contains lineage but no driver analysis", () => {
    const summary = buildPerformanceDecisionSummary({
      metrics: [metric("covers", 0.25)],
      headlineKeys: ["covers"],
    });

    expect(summary.driverEvidence).toEqual({
      status: "not-available",
      message: "Connected sources explain where each number came from, but they do not yet prove what caused the change.",
    });
  });
});
