import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildProductLinePerformance,
  type ProductLinePerformanceView,
} from "@/lib/product-management/product-performance";
import type { ProductOperatingContext } from "@/lib/product-management/product-operating-context";
import { ProductLinePerformance } from "./ProductLinePerformance";

function sparseContext(): ProductOperatingContext {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const empty = (sourceKind: string) => ({
    availability: "available" as const,
    freshness: "unknown" as const,
    asOf: now,
    sourceKind,
    items: [],
    reason: null,
  });
  return {
    scope: { kind: "product-line", id: "line-1" },
    requestedAt: now,
    provider: {
      id: "org-1",
      sourceKind: "organization",
      asOf: now,
      name: "Harbor Salon",
      derivedFromOrganization: true,
    },
    productLines: [
      {
        id: "line-1",
        sourceKind: "product-line",
        asOf: now,
        name: "Salon services",
        parentId: null,
      },
    ],
    productLine: {
      id: "line-1",
      sourceKind: "product-line",
      asOf: now,
      name: "Salon services",
      parentId: null,
    },
    products: [
      {
        id: "product-1",
        productId: "PROD-1",
        productLineId: "line-1",
        sourceKind: "business-product",
        asOf: now,
        name: "Hair appointments",
      },
    ],
    consumers: empty("consumer"),
    enablingDigitalProducts: empty("digital"),
    offerings: empty("offering"),
    catalogItems: empty("catalog"),
    productSold: empty("product-sold"),
    commercialPerformance: {
      saleCount: 0,
      additiveRevenue: 0,
      currency: null,
      componentAllocations: [],
      unallocatedComponentCount: 0,
    },
    commercialPerformanceByProduct: [],
    intelligence: empty("intelligence"),
    demand: empty("demand"),
    decisions: empty("decision"),
    objectives: empty("objective"),
    roadmapInputs: empty("roadmap"),
    deliveryChanges: empty("delivery"),
    architecture: empty("architecture"),
    scheduledPlaybooks: empty("playbook"),
  };
}

describe("ProductLinePerformance", () => {
  it("renders sparse evidence as unavailable rather than zero", () => {
    const view = buildProductLinePerformance(sparseContext());
    const html = renderToStaticMarkup(
      <ProductLinePerformance view={view} audience="owner-operator" />,
    );

    expect(html).toContain("What deserves attention?");
    expect(html).toContain("No evidence-backed action is ready");
    expect(html).toContain("What this comparison cannot say yet");
    expect(html).toContain("Not available");
    expect(html).not.toContain(">0 USD<");
  });

  it("adds professional decision detail without changing the projection", () => {
    const base = buildProductLinePerformance(sparseContext());
    const recommendation = {
      recommendationId: "performance:attribution-gap:line",
      issue: "attribution-gap" as const,
      action: "investigate" as const,
      productId: null,
      title: "Package attribution needs review",
      interpretation: "One component allocation is missing.",
      expectedEffect: "Comparisons become trustworthy.",
      confidence: "high" as const,
      evidence: [],
      blindSpots: ["One package split is unavailable."],
      approvalBoundary: "recommend-only" as const,
      followUpMeasure: "Unallocated package components",
    };
    const view: ProductLinePerformanceView = {
      ...base,
      recommendations: [recommendation],
    };

    const professional = renderToStaticMarkup(
      <ProductLinePerformance view={view} audience="professional-pm" />,
    );
    const guided = renderToStaticMarkup(
      <ProductLinePerformance view={view} audience="owner-operator" />,
    );
    expect(professional).toContain("Decision detail");
    expect(professional).toContain("Investigate attribution");
    expect(guided).toContain("Check the package split");
    expect(guided).not.toContain("Decision detail");
  });
});
