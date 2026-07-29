import { describe, expect, it } from "vitest";
import type { ProductOperatingContext } from "./product-operating-context";
import { buildProductPortfolioHierarchy } from "./product-line-direction-view";

const asOf = new Date("2026-07-28T20:00:00.000Z");

function context(): ProductOperatingContext {
  return {
    scope: { kind: "organization", id: "org-1" },
    requestedAt: asOf,
    provider: {
      id: "org-1",
      sourceKind: "organization",
      asOf,
      name: "Harbor Salon",
      derivedFromOrganization: true,
    },
    productLines: [
      {
        id: "line-retail",
        sourceKind: "product-line",
        asOf,
        name: "Retail goods",
        parentId: null,
      },
      {
        id: "line-services",
        sourceKind: "product-line",
        asOf,
        name: "Salon services",
        parentId: null,
      },
      {
        id: "line-colour",
        sourceKind: "product-line",
        asOf,
        name: "Colour",
        parentId: "line-services",
      },
    ],
    productLine: null,
    products: [
      {
        id: "product-colour",
        productId: "PROD-COLOUR",
        productLineId: "line-colour",
        sourceKind: "product",
        asOf,
        name: "Colour appointments",
      },
      {
        id: "product-retail",
        productId: "PROD-RETAIL",
        productLineId: "line-retail",
        sourceKind: "product",
        asOf,
        name: "Salon retail",
      },
    ],
    consumers: emptySlice("consumer"),
    enablingDigitalProducts: emptySlice("digital-product"),
    offerings: emptySlice("product-offering"),
    catalogItems: emptySlice("catalog-item"),
    productSold: emptySlice("product-sold"),
    commercialPerformance: {
      saleCount: 3,
      additiveRevenue: 260,
      currency: "USD",
      componentAllocations: [],
      unallocatedComponentCount: 0,
    },
    commercialPerformanceByProduct: [
      {
        productId: "product-colour",
        saleCount: 2,
        additiveRevenue: 220,
        currency: "USD",
        unallocatedComponentCount: 0,
      },
      {
        productId: "product-retail",
        saleCount: 1,
        additiveRevenue: 40,
        currency: "USD",
        unallocatedComponentCount: 0,
      },
    ],
    intelligence: emptySlice("intelligence"),
    demand: emptySlice("demand"),
    decisions: emptySlice("decision"),
    objectives: emptySlice("objective"),
    roadmapInputs: emptySlice("roadmap"),
    deliveryChanges: emptySlice("change"),
    architecture: emptySlice("architecture"),
    scheduledPlaybooks: emptySlice("schedule"),
  };
}

function emptySlice(sourceKind: string) {
  return {
    availability: "available" as const,
    freshness: "unknown" as const,
    asOf,
    sourceKind,
    items: [],
    reason: null,
  };
}

describe("product-line direction view", () => {
  it("builds a top-down hierarchy with descendant rollups and no duplicate revenue", () => {
    const hierarchy = buildProductPortfolioHierarchy(context());

    expect(hierarchy.map((line) => line.name)).toEqual([
      "Retail goods",
      "Salon services",
    ]);
    expect(hierarchy[1]).toMatchObject({
      id: "line-services",
      directProductCount: 0,
      totalProductCount: 1,
      saleCount: 2,
      additiveRevenue: 220,
      currency: "USD",
      children: [
        expect.objectContaining({
          id: "line-colour",
          directProductCount: 1,
          totalProductCount: 1,
          additiveRevenue: 220,
        }),
      ],
    });
  });

  it("includes malformed legacy cycles once without looping", () => {
    const malformed = context();
    malformed.productLines = [
      { ...malformed.productLines[0]!, id: "a", parentId: "b", name: "A" },
      { ...malformed.productLines[1]!, id: "b", parentId: "a", name: "B" },
    ];
    malformed.products = [];
    malformed.commercialPerformanceByProduct = [];

    const hierarchy = buildProductPortfolioHierarchy(malformed);
    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0]?.id).toBe("a");
    expect(hierarchy[0]?.children[0]?.id).toBe("b");
    expect(hierarchy[0]?.children[0]?.children).toEqual([]);
  });
});
