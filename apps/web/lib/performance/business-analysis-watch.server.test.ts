import { describe, expect, it } from "vitest";

import { validateBusinessAnalysisPlan } from "@dpf/storefront-templates";
import { evaluateBusinessAnalysisWatchTask } from "./business-analysis-watch.server";

function taskConfig() {
  const accepted = validateBusinessAnalysisPlan({
    schemaVersion: 1,
    question: "Did covers move enough to review?",
    intent: "change",
    metrics: [{ key: "covers" }],
    dimensions: [],
    filters: [],
    period: { start: "2026-08-11", end: "2026-08-11", timezone: "America/Chicago", grain: "day" },
    comparison: { basis: "prior-period" },
    sources: [{ owner: "restaurant-service", maximumAge: "PT2H" }],
    checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
  });
  if (accepted.status !== "accepted") throw new Error("expected accepted plan");
  return {
    schemaVersion: 1 as const,
    plan: accepted.plan,
    fingerprint: accepted.fingerprint,
    materiality: { mode: "relative" as const, direction: "either" as const, value: 0.1 },
    baseline: { value: 100, sourceWatermark: "2026-08-12T11:00:00.000Z" },
    lastEvaluation: null,
  };
}

describe("evaluateBusinessAnalysisWatchTask", () => {
  it("rechecks current organization and returns deterministic run evidence", async () => {
    const result = await evaluateBusinessAnalysisWatchTask({
      ownerUserId: "user-owner",
      organizationId: "org-1",
      taskConfig: taskConfig(),
    }, {
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      loadPerformance: async () => ({
        status: "ready",
        organizationId: "org-1",
        archetypeId: "restaurant",
        periodLabel: "Aug 11, 2026",
        periodStart: new Date("2026-08-11T05:00:00.000Z"),
        periodEnd: new Date("2026-08-12T05:00:00.000Z"),
        timezone: "America/Chicago",
        asOf: new Date("2026-08-12T11:30:00.000Z"),
        freshness: "fresh",
        periodState: "finalized",
        availablePeriods: [],
        sections: { headline: ["covers"], operating: [], financial: [], customer: [], workforce: [] },
        trendPoints: [],
        source: "business-performance-read-model",
        metricValues: [{
          key: "covers", label: "Covers", unit: "count", value: 115,
          comparisonValue: 100, comparisonDelta: 0.15, availability: "available",
          unavailableReason: null, definition: "count", definitionVersion: "v1",
          sourceOwner: "restaurant-service", sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
          sourceLineage: null,
        }],
      }),
    });

    expect(result.evaluation).toMatchObject({
      status: "material-change",
      fingerprint: taskConfig().fingerprint,
      sourceWatermark: "2026-08-12T11:30:00.000Z",
    });
  });

  it("refuses a task whose organization differs from the owner's current organization", async () => {
    await expect(evaluateBusinessAnalysisWatchTask({
      ownerUserId: "user-owner",
      organizationId: "org-old",
      taskConfig: taskConfig(),
    }, {
      loadPerformance: async () => ({ status: "not-configured", reason: "ambiguous", asOf: null, metricValues: [], source: "business-performance-read-model", applicable: true }),
    })).rejects.toThrow(/organization/i);
  });
});
