import { describe, expect, it } from "vitest";
import { buildProductManagementAdoptionEvidence } from "./product-management-adoption";

const now = new Date("2026-07-28T12:00:00Z");
const empty = (sourceKind: string) => ({
  availability: "available" as const,
  freshness: "unknown" as const,
  asOf: now,
  sourceKind,
  items: [],
  reason: null,
});

function context() {
  return {
    scope: { kind: "product-line" as const, id: "line-1" },
    requestedAt: now,
    provider: {
      id: "org-1",
      name: "Hotel",
      sourceKind: "organization",
      asOf: now,
      derivedFromOrganization: true as const,
    },
    productLines: [],
    productLine: null,
    products: [],
    enablingDigitalProducts: empty("digital-product"),
    offerings: empty("product-offering"),
    catalogItems: empty("catalog-item"),
    productSold: empty("product-sold"),
    consumers: empty("consumer"),
    commercialPerformance: {
      saleCount: 0,
      additiveRevenue: 0,
      currency: null,
      componentAllocations: [],
      unallocatedComponentCount: 0,
    },
    commercialPerformanceByProduct: [],
    intelligence: empty("knowledge-article"),
    demand: empty("backlog-item"),
    decisions: empty("decision-interaction"),
    objectives: empty("product-objective"),
    roadmapInputs: empty("backlog-item"),
    deliveryChanges: empty("change-item"),
    architecture: empty("product-dependency"),
    scheduledPlaybooks: empty("scheduled-agent-task"),
  };
}

describe("buildProductManagementAdoptionEvidence", () => {
  it("reports unavailable metrics instead of manufacturing adoption or movement", () => {
    const evidence = buildProductManagementAdoptionEvidence({
      context: context(),
    });
    expect(evidence.map((measure) => measure.id)).toEqual([
      "playbook-freshness",
      "decision-latency",
      "outcome-review-cadence",
      "recommendation-response",
      "product-line-movement",
    ]);
    expect(evidence.every((measure) => measure.value === null)).toBe(true);
    expect(evidence.every((measure) => measure.reason)).toBe(true);
  });

  it("computes only from explicit timestamp and resolution evidence", () => {
    const evidence = buildProductManagementAdoptionEvidence({
      context: context(),
      decisionWindows: [
        {
          demandItemId: "BI-1",
          proposedAt: new Date("2026-07-27T12:00:00Z"),
          decidedAt: now,
        },
      ],
      recommendationResponses: [
        {
          interactionId: "DI-1",
          outcome: "accepted",
          resolvedAt: now,
        },
        {
          interactionId: "DI-2",
          outcome: "corrected",
          resolvedAt: now,
        },
      ],
      productLineMovements: [
        {
          productLineId: "line-1",
          metric: "additive-revenue",
          previousAsOf: new Date("2026-06-28T12:00:00Z"),
          currentAsOf: now,
          previousValue: 100,
          currentValue: 120,
        },
      ],
    });
    expect(
      evidence.find((measure) => measure.id === "decision-latency"),
    ).toMatchObject({ value: 24, unit: "hours" });
    expect(
      evidence.find((measure) => measure.id === "recommendation-response"),
    ).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(
      evidence.find((measure) => measure.id === "product-line-movement"),
    ).toMatchObject({ value: 1, unit: "count" });
  });
});
