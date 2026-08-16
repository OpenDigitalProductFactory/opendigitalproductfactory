import { describe, expect, it } from "vitest";

import type { NormalizedBusinessAnalysisPlan } from "@dpf/storefront-templates";
import { validateBusinessAnalysisPlan } from "@dpf/storefront-templates";

import {
  evaluateBusinessAnalysisWatch,
  parseBusinessAnalysisWatchConfig,
  type BusinessAnalysisWatchConfig,
} from "./business-analysis-watch";

function acceptedPlan(maximumAge = "PT2H"): {
  plan: NormalizedBusinessAnalysisPlan;
  fingerprint: string;
} {
  const result = validateBusinessAnalysisPlan({
    schemaVersion: 1,
    question: "Did covers move enough to deserve attention?",
    intent: "change",
    metrics: [{ key: "covers" }],
    dimensions: [],
    filters: [],
    period: {
      start: "2026-08-11",
      end: "2026-08-11",
      timezone: "America/Chicago",
      grain: "day",
    },
    comparison: { basis: "prior-period" },
    sources: [{ owner: "restaurant-service", maximumAge }],
    checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
  });
  if (result.status !== "accepted") throw new Error("test plan must be accepted");
  return { plan: result.plan, fingerprint: result.fingerprint };
}

function config(
  overrides: Partial<BusinessAnalysisWatchConfig> = {},
): BusinessAnalysisWatchConfig {
  const accepted = acceptedPlan();
  return {
    schemaVersion: 1,
    plan: accepted.plan,
    fingerprint: accepted.fingerprint,
    materiality: {
      mode: "relative",
      direction: "either",
      value: 0.1,
    },
    baseline: {
      value: 100,
      sourceWatermark: "2026-08-12T11:00:00.000Z",
    },
    lastEvaluation: null,
    ...overrides,
  };
}

describe("business analysis watch contract", () => {
  it("revalidates the accepted plan and exact fingerprint", () => {
    expect(parseBusinessAnalysisWatchConfig(config()).fingerprint).toMatch(/^bap1_/);

    expect(() =>
      parseBusinessAnalysisWatchConfig(config({ fingerprint: "bap1_wrong" })),
    ).toThrow(/fingerprint/i);
  });

  it("refuses unsupported or non-positive materiality instead of guessing", () => {
    expect(() =>
      parseBusinessAnalysisWatchConfig(config({
        materiality: { mode: "relative", direction: "either", value: 0 },
      })),
    ).toThrow(/positive/i);
    expect(() =>
      parseBusinessAnalysisWatchConfig(config({
        materiality: { mode: "relative", direction: "sideways" as never, value: 0.1 },
      })),
    ).toThrow(/direction/i);
  });

  it("surfaces a material change with plan identity and freshness evidence", () => {
    const result = evaluateBusinessAnalysisWatch(config(), {
      evaluatedAt: new Date("2026-08-12T12:00:00.000Z"),
      metric: {
        key: "covers",
        availability: "available",
        value: 115,
        sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
      },
    });

    expect(result.evaluation).toMatchObject({
      status: "material-change",
      metricKey: "covers",
      currentValue: 115,
      baselineValue: 100,
      delta: 0.15,
      fingerprint: config().fingerprint,
      sourceWatermark: "2026-08-12T11:30:00.000Z",
    });
    expect(result.nextConfig.baseline.value).toBe(115);
  });

  it("keeps unchanged evaluations quiet and retains the prior baseline", () => {
    const result = evaluateBusinessAnalysisWatch(config(), {
      evaluatedAt: new Date("2026-08-12T12:00:00.000Z"),
      metric: {
        key: "covers",
        availability: "available",
        value: 106,
        sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
      },
    });

    expect(result.evaluation.status).toBe("unchanged");
    expect(result.nextConfig.baseline.value).toBe(100);
  });

  it("classifies stale source evidence without calling it a business change", () => {
    const result = evaluateBusinessAnalysisWatch(config(), {
      evaluatedAt: new Date("2026-08-12T14:00:01.000Z"),
      metric: {
        key: "covers",
        availability: "available",
        value: 130,
        sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
      },
    });

    expect(result.evaluation).toMatchObject({
      status: "stale-source",
      fingerprint: config().fingerprint,
    });
    expect(result.nextConfig.baseline.value).toBe(100);
  });
});
