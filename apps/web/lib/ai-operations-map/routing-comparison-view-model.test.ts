import { describe, expect, it } from "vitest";
import { AI_ROUTING_STAGES } from "@/lib/ea/ai-routing-architecture-registry";
import type { RoutingEvidenceConformanceProjection } from "./routing-evidence-conformance";
import {
  buildRoutingComparisonViewModel,
  OWNER_ROUTING_STATIONS,
} from "./routing-comparison-view-model";

const EVIDENCE: RoutingEvidenceConformanceProjection = {
  schemaVersion: "ai-routing-evidence/v1",
  designRevision: "ai-routing/v4",
  window: {
    start: "2026-07-26T12:00:00.000Z",
    end: "2026-07-26T13:00:00.000Z",
  },
  coverage: {
    totalDecisions: 12,
    attributedDecisions: 11,
    tracedDecisions: 10,
    correlatedDecisions: 9,
    uncorrelatedDecisions: 3,
    unevidencedDecisions: 1,
    screenCoveredDecisions: 8,
    designBoundDecisions: 9,
    unprovenDesignDecisions: 3,
    staleDesignDecisions: 2,
    attributionRate: 11 / 12,
    traceRate: 10 / 12,
    correlationRate: 9 / 12,
    screenCoverageRate: 8 / 12,
    designBindingRate: 9 / 12,
  },
  metrics: {
    decisionVolume: 12,
    adapterAttempts: 14,
    successfulAttempts: 11,
    errorAttempts: 3,
    fallbackAttempts: 2,
    excludedCandidates: 5,
    inputTokens: 1_200,
    outputTokens: 800,
    costUsd: 1.25,
    latencyP50Ms: 420,
    latencyP95Ms: 1_300,
    capacityLimitedProviders: 1,
    latestEvidenceAt: "2026-07-26T12:59:00.000Z",
    evidenceAgeSeconds: 60,
  },
  providerMetrics: [],
  findings: [
    {
      issueKey: "blocked-dispatch",
      issueType: "ai-routing-blocked-path-dispatched",
      severity: "error",
      message: "A blocked path reached dispatch.",
      count: 1,
      architectureStageId: "data-policy-gateway",
    },
    {
      issueKey: "stale-design",
      issueType: "ai-routing-design-stale",
      severity: "warn",
      message: "Observed decisions used an older design revision.",
      count: 2,
      architectureStageId: "record-safe-receipt",
    },
  ],
};

describe("routing comparison view model", () => {
  it("projects every governed architecture stage into five stable owner stations", () => {
    const view = buildRoutingComparisonViewModel(EVIDENCE, {
      mode: "compare",
      focusStageId: "data-policy-gateway",
    });

    expect(view.stations.map((station) => station.id)).toEqual(
      OWNER_ROUTING_STATIONS.map((station) => station.id),
    );
    expect(view.stations.flatMap((station) => station.stages).map((stage) => stage.id).sort()).toEqual(
      AI_ROUTING_STAGES.map((stage) => stage.id).sort(),
    );
    expect(view.focusedStationId).toBe("data-safety");
  });

  it("keeps operational metrics on the station that can honestly explain them", () => {
    const view = buildRoutingComparisonViewModel(EVIDENCE, { mode: "observed" });
    const byId = new Map(view.stations.map((station) => [station.id, station]));

    expect(byId.get("data-safety")?.metrics.map((metric) => metric.label)).toEqual(
      expect.arrayContaining(["Screen coverage", "Blocked dispatch findings"]),
    );
    expect(byId.get("eligible-routes")?.metrics.map((metric) => metric.label)).toEqual(
      expect.arrayContaining(["Routing decisions", "Excluded candidates", "Capacity-limited providers"]),
    );
    expect(byId.get("select-dispatch")?.metrics.map((metric) => metric.label)).toEqual(
      expect.arrayContaining(["Adapter attempts", "Fallback attempts", "P95 latency", "Estimated cost"]),
    );
    expect(byId.get("evidence-return")?.metrics.map((metric) => metric.label)).toEqual(
      expect.arrayContaining(["Evidence correlation", "Design binding", "Evidence freshness"]),
    );
    expect(byId.get("ask-context")?.metrics).toEqual([]);
  });

  it("assigns conformance findings by architecture stage and exposes mode semantics", () => {
    const compare = buildRoutingComparisonViewModel(EVIDENCE, { mode: "compare" });
    expect(compare.showDesigned).toBe(true);
    expect(compare.showObserved).toBe(true);
    expect(compare.stations.find((station) => station.id === "data-safety")?.findings[0]?.issueKey)
      .toBe("blocked-dispatch");

    const designed = buildRoutingComparisonViewModel(EVIDENCE, { mode: "designed" });
    expect(designed.showDesigned).toBe(true);
    expect(designed.showObserved).toBe(false);

    const observed = buildRoutingComparisonViewModel(EVIDENCE, { mode: "observed" });
    expect(observed.showDesigned).toBe(false);
    expect(observed.showObserved).toBe(true);
  });

  it("accepts only the privacy-safe evidence projection and never emits source payload fields", () => {
    const serialized = JSON.stringify(
      buildRoutingComparisonViewModel(EVIDENCE, { mode: "compare" }),
    );

    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("tokenMap");
    expect(serialized).not.toContain("detectedValue");
  });
});
