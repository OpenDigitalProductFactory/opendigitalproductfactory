import { describe, expect, it } from "vitest";
import { buildStakeholderBriefFromOperatingContext } from "./product-management-brief";

describe("buildStakeholderBriefFromOperatingContext", () => {
  it("keeps the portable brief derived, timestamped, and source linked", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    const unavailable = (sourceKind: string) => ({
      availability: "unavailable" as const,
      freshness: "unknown" as const,
      asOf: now,
      sourceKind,
      items: [],
      reason: "No evidence.",
    });
    const snapshot = buildStakeholderBriefFromOperatingContext({
      context: {
        scope: { kind: "product", id: "product-1" },
        requestedAt: now,
        provider: {
          id: "org-1",
          name: "Harbor Salon",
          sourceKind: "organization",
          asOf: now,
          derivedFromOrganization: true,
        },
        productLines: [],
        productLine: null,
        products: [
          {
            id: "product-1",
            productId: "PROD-1",
            name: "Hair services",
            productLineId: "line-1",
            sourceKind: "business-product",
            asOf: now,
          },
        ],
        enablingDigitalProducts: unavailable("digital-product"),
        offerings: unavailable("product-offering"),
        catalogItems: unavailable("catalog-item"),
        productSold: unavailable("product-sold"),
        consumers: unavailable("consumer"),
        commercialPerformance: {
          saleCount: 0,
          additiveRevenue: 0,
          currency: null,
          componentAllocations: [],
          unallocatedComponentCount: 0,
        },
        commercialPerformanceByProduct: [],
        intelligence: unavailable("knowledge-article"),
        demand: unavailable("backlog-item"),
        decisions: unavailable("decision-interaction"),
        objectives: unavailable("product-objective"),
        roadmapInputs: unavailable("backlog-item"),
        deliveryChanges: unavailable("change-item"),
        architecture: unavailable("product-dependency"),
        scheduledPlaybooks: unavailable("scheduled-agent-task"),
      },
      view: {
        audience: "guided",
        introduction: "What needs attention.",
        evidencePreviewCount: 3,
        primaryAction: { label: "Review", href: "/ops/demand" },
        sections: [
          {
            kind: "needs-decision",
            title: "Needs your decision",
            description: "Review demand.",
            availability: "available",
            freshness: "fresh",
            asOf: now,
            sourceKind: "backlog-item",
            reason: null,
            items: [
              {
                id: "BI-1",
                label: "Add retail line",
                status: "open",
                sourceKind: "backlog-item",
                asOf: now,
                detail: "Evidence ready",
              },
            ],
          },
        ],
      },
      generatedAt: now,
    });

    expect(snapshot).toMatchObject({
      authority: "derived-snapshot",
      importable: false,
      confidence: "unavailable",
      scope: {
        kind: "product",
        organizationId: "org-1",
        businessProductId: "product-1",
      },
    });
    expect(snapshot.sourceIds).toContain("business-product:product-1");
    expect(snapshot.sections[0]?.body).toContain("backlog-item:BI-1");
  });
});
