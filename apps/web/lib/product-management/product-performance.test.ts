import { describe, expect, it } from "vitest";
import { createContextSlice, type ProductOperatingContext } from "./product-operating-context";
import {
  buildProductLinePerformance,
  describeRecommendationForAudience,
} from "./product-performance";

const requestedAt = new Date("2026-07-28T12:00:00.000Z");

function slice<T extends { id: string; sourceKind: string; asOf: Date }>(
  sourceKind: string,
  items: T[],
) {
  return createContextSlice({ requestedAt, sourceKind, items });
}

function context(
  overrides: Partial<ProductOperatingContext> = {},
): ProductOperatingContext {
  return {
    scope: { kind: "product-line", id: "line-services" },
    requestedAt,
    provider: {
      id: "org-1",
      sourceKind: "organization",
      asOf: requestedAt,
      name: "Example Company",
      derivedFromOrganization: true,
    },
    productLines: [
      {
        id: "line-services",
        sourceKind: "product-line",
        asOf: requestedAt,
        name: "Services",
        parentId: null,
      },
      {
        id: "line-events",
        sourceKind: "product-line",
        asOf: requestedAt,
        name: "Events",
        parentId: "line-services",
      },
    ],
    productLine: {
      id: "line-services",
      sourceKind: "product-line",
      asOf: requestedAt,
      name: "Services",
      parentId: null,
    },
    products: [
      {
        id: "product-service",
        productId: "PROD-SERVICE",
        productLineId: "line-services",
        sourceKind: "business-product",
        asOf: requestedAt,
        name: "Core service",
      },
      {
        id: "product-event",
        productId: "PROD-EVENT",
        productLineId: "line-events",
        sourceKind: "business-product",
        asOf: requestedAt,
        name: "Private event",
      },
    ],
    consumers: slice("consumer", []),
    enablingDigitalProducts: slice("digital-product", []),
    offerings: slice("offering", []),
    catalogItems: slice("catalog-item", []),
    productSold: slice("product-sold", []),
    commercialPerformance: {
      saleCount: 0,
      additiveRevenue: 0,
      currency: null,
      componentAllocations: [],
      unallocatedComponentCount: 0,
    },
    commercialPerformanceByProduct: [],
    intelligence: slice("intelligence", []),
    demand: slice("backlog-item", []),
    decisions: slice("decision", []),
    objectives: slice("product-objective", []),
    roadmapInputs: slice("roadmap", []),
    deliveryChanges: slice("change", []),
    architecture: slice("architecture", []),
    scheduledPlaybooks: slice("playbook", []),
    ...overrides,
  };
}

function sold(input: {
  id: string;
  productId: string;
  amount: number;
  purchasedAt: string;
  status?: string;
  currency?: string;
  unallocated?: boolean;
}) {
  const asOf = new Date(input.purchasedAt);
  return {
    id: input.id,
    sourceKind: "product-sold",
    asOf,
    productId: input.productId,
    status: input.status ?? "fulfilled",
    quantity: 1,
    totalAmount: input.amount,
    currency: input.currency ?? "USD",
    consumerEvidence: [],
    componentAllocations: input.unallocated
      ? [
          {
            catalogItemId: "bundle-component",
            allocatedAmount: null,
            allocationMode: "unallocated",
          },
        ]
      : [],
  };
}

describe("buildProductLinePerformance", () => {
  it("reconciles periods, excludes cancelled/refunded revenue, and rolls descendants once", () => {
    const productSold = slice("product-sold", [
      sold({
        id: "current-service",
        productId: "product-service",
        amount: 300,
        purchasedAt: "2026-07-20T00:00:00.000Z",
      }),
      sold({
        id: "current-event",
        productId: "product-event",
        amount: 700,
        purchasedAt: "2026-07-15T00:00:00.000Z",
        unallocated: true,
      }),
      sold({
        id: "refunded-event",
        productId: "product-event",
        amount: 900,
        purchasedAt: "2026-07-10T00:00:00.000Z",
        status: "refunded",
      }),
      sold({
        id: "baseline-service",
        productId: "product-service",
        amount: 500,
        purchasedAt: "2026-06-20T00:00:00.000Z",
      }),
      sold({
        id: "cancelled-service",
        productId: "product-service",
        amount: 800,
        purchasedAt: "2026-06-15T00:00:00.000Z",
        status: "cancelled",
      }),
    ]);

    const view = buildProductLinePerformance(context({ productSold }), {
      windowDays: 30,
    });

    expect(view.line.productIds).toEqual([
      "product-event",
      "product-service",
    ]);
    expect(view.line.current).toMatchObject({
      recognizedSaleCount: 2,
      recognizedRevenue: 1000,
      refundedCount: 1,
      cancelledCount: 0,
      unallocatedComponentCount: 1,
      currency: "USD",
    });
    expect(view.line.baseline).toMatchObject({
      recognizedSaleCount: 1,
      recognizedRevenue: 500,
      cancelledCount: 1,
    });
    expect(
      view.line.measures.find((measure) => measure.key === "recognized-revenue"),
    ).toMatchObject({
      availability: "available",
      currentValue: 1000,
      baselineValue: 500,
      trend: "rising",
    });
    expect(view.recommendations[0]).toMatchObject({
      issue: "attribution-gap",
      action: "investigate",
    });
  });

  it("keeps mixed currency, missing margin, capacity, and conversion explicit", () => {
    const productSold = slice("product-sold", [
      sold({
        id: "usd-sale",
        productId: "product-service",
        amount: 100,
        currency: "USD",
        purchasedAt: "2026-07-20T00:00:00.000Z",
      }),
      sold({
        id: "gbp-sale",
        productId: "product-event",
        amount: 100,
        currency: "GBP",
        purchasedAt: "2026-07-20T00:00:00.000Z",
      }),
    ]);
    const view = buildProductLinePerformance(context({ productSold }));

    expect(
      view.line.measures.find((measure) => measure.key === "recognized-revenue"),
    ).toMatchObject({
      availability: "partial",
      currentValue: null,
      reason: expect.stringMatching(/currency/i),
    });
    for (const key of [
      "contribution-margin",
      "conversion",
      "repeat-purchase",
      "capacity-utilization",
      "stock-availability",
      "quality",
      "cannibalization",
    ] as const) {
      expect(
        view.line.measures.find((measure) => measure.key === key),
      ).toMatchObject({
        availability: "unavailable",
        currentValue: null,
      });
    }
  });

  it("recommends investigating funded demand without inventing capacity or sales", () => {
    const demand = slice("backlog-item", [
      {
        id: "BI-ONE",
        sourceKind: "backlog-item",
        asOf: new Date("2026-07-27T00:00:00.000Z"),
        title: "Customers ask for private events",
        status: "open",
        businessProductId: "product-event",
        productLineId: "line-events",
        demandStage: "ready",
        score: 81,
        evidenceCount: 3,
        readiness: {
          classified: true,
          evidenceReady: true,
          scoreReady: true,
          fundingReady: true,
        },
        blockers: [],
        latestDecision: null,
      },
    ]);
    const view = buildProductLinePerformance(context({ demand }));

    expect(view.recommendations).toContainEqual(
      expect.objectContaining({
        issue: "demand-opportunity",
        action: "investigate",
        productId: "product-event",
        confidence: "medium",
        blindSpots: expect.arrayContaining([
          expect.stringMatching(/capacity/i),
        ]),
      }),
    );
    expect(view.recommendations).not.toContainEqual(
      expect.objectContaining({ issue: "capacity-constraint" }),
    );
  });

  it("uses one recommendation contract with audience-appropriate language", () => {
    const recommendation = {
      recommendationId: "rec-1",
      issue: "attribution-gap" as const,
      action: "investigate" as const,
      productId: null,
      title: "Package attribution needs review",
      interpretation: "One bundle component has no recorded allocation.",
      expectedEffect: "Product-line comparisons become trustworthy.",
      confidence: "high" as const,
      evidence: [],
      blindSpots: [],
      approvalBoundary: "recommend-only" as const,
      followUpMeasure: "Unallocated package components",
    };

    expect(
      describeRecommendationForAudience(recommendation, "owner-operator"),
    ).toMatchObject({
      actionLabel: "Check the package split",
      detailLevel: "plain",
    });
    expect(
      describeRecommendationForAudience(recommendation, "professional-pm"),
    ).toMatchObject({
      actionLabel: "Investigate attribution",
      detailLevel: "technical",
    });
  });

  it.each([
    ["salon", "Salon services", "Hair-care retail"],
    ["hotel", "Rooms", "Conferences and events"],
    ["restaurant", "Dining", "Private events"],
  ])(
    "keeps %s mixed lines independently drillable",
    (_kind: string, primary: string, adjacent: string) => {
    const mixed = context({
      productLines: [
        {
          id: "line-primary",
          sourceKind: "product-line",
          asOf: requestedAt,
          name: primary,
          parentId: null,
        },
        {
          id: "line-adjacent",
          sourceKind: "product-line",
          asOf: requestedAt,
          name: adjacent,
          parentId: null,
        },
      ],
      productLine: null,
      scope: { kind: "organization", id: "org-1" },
      products: [
        {
          id: "product-primary",
          productId: "PROD-PRIMARY",
          productLineId: "line-primary",
          sourceKind: "business-product",
          asOf: requestedAt,
          name: primary,
        },
        {
          id: "product-adjacent",
          productId: "PROD-ADJACENT",
          productLineId: "line-adjacent",
          sourceKind: "business-product",
          asOf: requestedAt,
          name: adjacent,
        },
      ],
    });

      const view = buildProductLinePerformance(mixed);
      const expected = [primary, adjacent].sort((left, right) =>
        left.localeCompare(right),
      );
      expect(view.lines.map((line) => line.name)).toEqual(expected);
      expect(view.products.map((product) => product.name)).toEqual(expected);
    },
  );
});
