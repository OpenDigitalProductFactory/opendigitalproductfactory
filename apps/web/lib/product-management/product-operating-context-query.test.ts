import { describe, expect, it, vi } from "vitest";
import {
  loadProductOperatingContext,
  ProductOperatingContextNotFoundError,
  type ProductOperatingContextQueryClient,
} from "./product-operating-context-query";

const now = new Date("2026-07-28T20:00:00.000Z");

function fakeDb(
  overrides: Partial<ProductOperatingContextQueryClient> = {},
): ProductOperatingContextQueryClient {
  const empty = vi.fn(async () => []);
  return {
    organization: {
      findFirst: vi.fn(async () => ({
        id: "org-1",
        name: "Harbor Salon",
        updatedAt: now,
      })),
    },
    productLine: {
      findMany: vi.fn(async () => [
        {
          id: "line-1",
          name: "Salon services",
          parentId: null,
          updatedAt: now,
        },
      ]),
      findFirst: vi.fn(async () => ({
        id: "line-1",
        name: "Salon services",
        parentId: null,
        updatedAt: now,
      })),
    },
    product: {
      findMany: vi.fn(async () => [
        {
          id: "product-1",
          productId: "PROD-1",
          productLineId: "line-1",
          name: "Hair appointments",
          updatedAt: now,
        },
      ]),
      findFirst: vi.fn(async () => ({
        id: "product-1",
        productId: "PROD-1",
        productLineId: "line-1",
        name: "Hair appointments",
        updatedAt: now,
      })),
    },
    productOffering: {
      findMany: vi.fn(async () => [
        {
          id: "offering-1",
          productId: "product-1",
          providerOrganizationId: "org-1",
          name: "Book an appointment",
          status: "active",
          updatedAt: now,
          catalogItems: [
            {
              id: "catalog-1",
              name: "Haircut",
              status: "active",
              updatedAt: now,
            },
          ],
          operationalServiceOffering: {
            digitalProduct: {
              id: "digital-1",
              productId: "DP-BOOKING",
              name: "Booking portal",
              updatedAt: now,
            },
          },
        },
      ]),
    },
    productSold: { findMany: empty },
    researchProposal: {
      findMany: vi.fn(async () => [
        {
          proposalId: "research-org",
          digitalProductId: null,
          productLineId: null,
          businessProductId: null,
          topic: "market",
          query: "What changed in the market?",
          status: "executed",
          resultSummary: "First-baseline draft: added one page.",
          metadata: {
            evidence: {
              confidence: "medium",
              comparisonKind: "first-run",
              retrievedAt: "2026-07-28T19:00:00.000Z",
              sourceUrls: ["https://example.com/market"],
            },
          },
          updatedAt: now,
        },
        {
          proposalId: "research-product",
          digitalProductId: "digital-1",
          productLineId: null,
          businessProductId: null,
          topic: "conversion",
          query: "What changed in conversion?",
          status: "executed",
          resultSummary: null,
          metadata: null,
          updatedAt: now,
        },
      ]),
    },
    marketingBattlecard: { findMany: empty },
    knowledgeArticle: { findMany: empty },
    rawSource: { findMany: empty },
    backlogItem: { findMany: empty },
    changeItem: { findMany: empty },
    eaElement: { findMany: empty },
    productDependency: { findMany: empty },
    scheduledAgentTask: { findMany: empty },
    ...overrides,
  };
}

describe("loadProductOperatingContext", () => {
  it("authorizes once, scopes every business query to the organization, and resolves enabling digital products through operational offerings", async () => {
    const db = fakeDb();
    const authorize = vi.fn(async () => undefined);

    const context = await loadProductOperatingContext({
      db,
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize,
      requestedAt: now,
    });

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith({ organizationId: "org-1" });
    expect(db.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1", organizationId: "org-1" },
      }),
    );
    expect(db.productOffering.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          productId: { in: ["product-1"] },
        },
        take: 100,
      }),
    );
    expect(context.enablingDigitalProducts.items).toEqual([
      expect.objectContaining({
        id: "digital-1",
        productId: "DP-BOOKING",
      }),
    ]);
    expect(context.intelligence.items.map((entry) => entry.scope)).toEqual([
      "digital-product",
      "organization",
    ]);
  });

  it("projects business-product demand directly without requiring a DigitalProduct", async () => {
    const backlogItem = vi.fn(async () => [
      {
        itemId: "BI-PRODUCT",
        title: "Reduce booking abandonment",
        body: "Customers abandon appointment booking.",
        status: "open",
        workType: "feature",
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        digitalProductId: null,
        demandStage: "screened",
        demandScore: 8,
        demandScoreFramework: "rice",
        effortSize: "medium",
        jobSize: 4,
        reach: 20,
        occurrenceCount: 20,
        impact: 2,
        confidence: 0.8,
        businessValue: null,
        timeCriticality: null,
        riskOpportunity: null,
        investmentBucket: "grow",
        estimateAiJobSize: 4,
        estimateHumanJobSize: 4,
        estimateSource: "agreed",
        estimateAgreed: true,
        claimStatus: null,
        claimedByAgentId: null,
        demandEvidenceLinks: [
          {
            evidenceLinkId: "DME-1",
            sourceKind: "booking",
            sourceRef: "booking-1",
            title: "Abandoned booking",
            summary: null,
            confidence: 0.8,
            reviewedAt: now,
          },
        ],
        activities: [
          {
            kind: "demand_funding_decision",
            summary: "Funding deferred",
            recordedAt: now,
            payload: { funded: false, rationale: "Needs stronger evidence" },
          },
        ],
        updatedAt: now,
        epic: null,
      },
    ]);
    const db = fakeDb({
      productOffering: { findMany: vi.fn(async () => []) },
      backlogItem: { findMany: backlogItem },
    });

    const context = await loadProductOperatingContext({
      db,
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(backlogItem).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          OR: expect.arrayContaining([
            expect.objectContaining({ businessProductId: "product-1" }),
          ]),
        }),
      }),
    );
    expect(context.demand.items[0]).toMatchObject({
      id: "BI-PRODUCT",
      evidenceCount: 1,
      readiness: expect.objectContaining({
        evidenceReady: true,
        scoreReady: true,
      }),
      latestDecision: expect.objectContaining({
        summary: "Funding deferred",
      }),
    });
  });

  it("keeps the commercial-summary profile on the sales query boundary", async () => {
    const productSold = vi.fn(async () => [
      {
        id: "sold-1",
        productId: "product-1",
        status: "fulfilled",
        quantity: { toNumber: () => 2 },
        totalAmount: { toNumber: () => 150 },
        currency: "USD",
        purchasedAt: now,
        parties: [],
        evidence: [],
        componentAllocations: [],
      },
    ]);
    const db = fakeDb({
      productSold: { findMany: productSold },
    });

    const context = await loadProductOperatingContext({
      db,
      organizationId: "org-1",
      scope: { kind: "organization", id: "org-1" },
      profile: "commercial-summary",
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(productSold).toHaveBeenCalledTimes(1);
    expect(context.commercialPerformance).toMatchObject({
      saleCount: 1,
      additiveRevenue: 150,
      currency: "USD",
    });
    expect(db.productOffering.findMany).not.toHaveBeenCalled();
    expect(db.researchProposal.findMany).not.toHaveBeenCalled();
    expect(db.marketingBattlecard.findMany).not.toHaveBeenCalled();
    expect(db.knowledgeArticle.findMany).not.toHaveBeenCalled();
    expect(db.rawSource.findMany).not.toHaveBeenCalled();
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
    expect(db.changeItem.findMany).not.toHaveBeenCalled();
    expect(db.eaElement.findMany).not.toHaveBeenCalled();
    expect(db.productDependency.findMany).not.toHaveBeenCalled();
    expect(db.scheduledAgentTask.findMany).not.toHaveBeenCalled();
    expect(context.intelligence).toMatchObject({
      availability: "unavailable",
      items: [],
      reason:
        "Intelligence is outside the commercial-summary query profile.",
    });
    expect(context.architecture).toMatchObject({
      availability: "unavailable",
      items: [],
      reason:
        "Architecture is outside the commercial-summary query profile.",
    });
  });

  it("fails closed when a requested product is not in the authorized organization", async () => {
    const db = fakeDb({
      product: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
    });

    await expect(
      loadProductOperatingContext({
        db,
        organizationId: "org-1",
        scope: { kind: "product", id: "product-from-another-org" },
        authorize: vi.fn(async () => undefined),
        requestedAt: now,
      }),
    ).rejects.toBeInstanceOf(ProductOperatingContextNotFoundError);

    expect(db.productOffering.findMany).not.toHaveBeenCalled();
  });

  it("rolls a product-line context through its descendant lines", async () => {
    const productFindMany = vi.fn(async () => [
      {
        id: "product-1",
        productId: "PROD-1",
        productLineId: "line-child",
        name: "Conference breakout",
        updatedAt: now,
      },
    ]);
    const db = fakeDb({
      productLine: {
        findMany: vi.fn(async () => [
          {
            id: "line-parent",
            name: "Hospitality",
            parentId: null,
            updatedAt: now,
          },
          {
            id: "line-child",
            name: "Events",
            parentId: "line-parent",
            updatedAt: now,
          },
        ]),
        findFirst: vi.fn(async () => ({
          id: "line-parent",
          name: "Hospitality",
          parentId: null,
          updatedAt: now,
        })),
      },
      product: {
        findMany: productFindMany,
        findFirst: vi.fn(async () => null),
      },
    });

    const context = await loadProductOperatingContext({
      db,
      organizationId: "org-1",
      scope: { kind: "product-line", id: "line-parent" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          productLineId: { in: ["line-parent", "line-child"] },
          effectiveTo: null,
        },
      }),
    );
    expect(context.products).toEqual([
      expect.objectContaining({
        id: "product-1",
        productLineId: "line-child",
      }),
    ]);
  });

  it("does not infer consumers, decisions, or objectives when no typed evidence exists", async () => {
    const context = await loadProductOperatingContext({
      db: fakeDb(),
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(context.consumers.items).toEqual([]);
    expect(context.decisions.availability).toBe("unavailable");
    expect(context.objectives.availability).toBe("unavailable");
    expect(context.scheduledPlaybooks).toMatchObject({
      availability: "available",
      items: [],
    });
  });

  it("projects typed objectives, current observations, corrections, and contributing work", async () => {
    const productObjective = vi.fn(async () => [
      {
        objectiveId: "OBJ-EVENTS",
        title: "Increase private-event bookings",
        problemStatement: "Private-event demand is inconsistent.",
        outcomeHypothesis:
          "Clear packages will convert more qualified enquiries.",
        status: "active",
        measureKind: "number",
        measureDefinition: "Confirmed private events per month",
        measureUnit: "events/month",
        baselineValue: { toNumber: () => 3 },
        targetValue: { toNumber: () => 6 },
        baselineNarrative: null,
        targetNarrative: null,
        reviewCadence: "monthly",
        reviewAt: new Date("2026-07-27T00:00:00.000Z"),
        reviewedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: now,
        ownerPrincipal: {
          principalId: "PRN-OWNER",
          displayName: "Owner operator",
        },
        contributingWork: [
          {
            contributionKind: "delivery",
            backlogItem: {
              itemId: "BI-EVENTS",
              title: "Publish private-event packages",
              status: "in-progress",
            },
          },
        ],
        observations: [
          {
            observationId: "OBS-CORRECTED",
            observedAt: new Date("2026-07-27T00:00:00.000Z"),
            numericValue: { toNumber: () => 4 },
            narrative: "Booking ledger reconciled.",
            measureKind: "number",
            measureUnit: "events/month",
            sourceKind: "booking",
            sourceRef: "booking-ledger:2026-07",
            confidence: 0.95,
            supersedes: { observationId: "OBS-ORIGINAL" },
            supersededBy: null,
            createdAt: now,
            recordedByPrincipal: null,
          },
          {
            observationId: "OBS-ORIGINAL",
            observedAt: new Date("2026-07-26T00:00:00.000Z"),
            numericValue: { toNumber: () => 5 },
            narrative: null,
            measureKind: "number",
            measureUnit: "events/month",
            sourceKind: "manual",
            sourceRef: null,
            confidence: null,
            supersedes: null,
            supersededBy: { observationId: "OBS-CORRECTED" },
            createdAt: new Date("2026-07-26T00:00:00.000Z"),
            recordedByPrincipal: null,
          },
        ],
      },
    ]);
    const context = await loadProductOperatingContext({
      db: fakeDb({ productObjective: { findMany: productObjective } }),
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(productObjective).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          productId: { in: ["product-1"] },
        },
      }),
    );
    expect(context.objectives.items[0]).toMatchObject({
      objectiveId: "OBJ-EVENTS",
      reviewDue: true,
      posture: {
        availability: "available",
        direction: "increase",
        state: "improving",
        latestValue: 4,
      },
      observations: [
        expect.objectContaining({
          observationId: "OBS-CORRECTED",
          supersedesObservationId: "OBS-ORIGINAL",
          supersededByObservationId: null,
        }),
        expect.objectContaining({ observationId: "OBS-ORIGINAL" }),
      ],
      contributingWork: [
        {
          itemId: "BI-EVENTS",
          title: "Publish private-event packages",
          status: "in-progress",
          contributionKind: "delivery",
        },
      ],
    });
  });

  it("projects only typed product intelligence watches without parsing prompt or route text", async () => {
    const scheduledAgentTask = vi.fn(async () => [
      {
        taskId: "agent-task-watch",
        title: "Watch salon competitors",
        productLineId: null,
        businessProductId: "product-1",
        schedule: "0 9 * * 1",
        isActive: false,
        nextRunAt: null,
        lastRunAt: new Date("2026-07-28T09:00:00.000Z"),
        lastStatus: "ok",
        updatedAt: now,
      },
    ]);
    const context = await loadProductOperatingContext({
      db: fakeDb({ scheduledAgentTask: { findMany: scheduledAgentTask } }),
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(scheduledAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskKind: "product-intelligence-watch",
          organizationId: "org-1",
        }),
      }),
    );
    expect(context.scheduledPlaybooks.items).toEqual([
      expect.objectContaining({
        taskId: "agent-task-watch",
        status: "paused",
        scope: "business-product",
      }),
    ]);
  });

  it("projects reviewed Wiki research at its exact business-product scope", async () => {
    const rawSource = vi.fn(async () => [
      {
        sourceKey: "research:proposal-1",
        retrievedAt: new Date("2026-07-27T15:00:00.000Z"),
        locator: {
          sourceType: "research",
          proposalId: "proposal-1",
          topic: "customer-choice",
          productLineId: null,
          businessProductId: "product-1",
          digitalProductId: null,
          urls: ["https://example.com/customer-choice"],
          confidence: "high",
          comparisonKind: "changed-since",
        },
        pageSources: [
          {
            page: {
              id: "wiki-1",
              title: "Market research: customer choice",
              abstract: "Customers increasingly value bundled consultations.",
              status: "published",
              lastReviewedAt: new Date("2026-07-28T12:00:00.000Z"),
              updatedAt: now,
            },
          },
        ],
      },
      {
        sourceKey: "research:other-product",
        retrievedAt: now,
        locator: {
          sourceType: "research",
          businessProductId: "product-other",
        },
        pageSources: [
          {
            page: {
              id: "wiki-other",
              title: "Other product research",
              abstract: null,
              status: "published",
              lastReviewedAt: now,
              updatedAt: now,
            },
          },
        ],
      },
    ]);

    const context = await loadProductOperatingContext({
      db: fakeDb({ rawSource: { findMany: rawSource } }),
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(context.intelligence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wiki-1",
          sourceKind: "wiki-page",
          scope: "business-product",
          businessProductId: "product-1",
          confidence: "high",
          comparisonKind: "changed-since",
          sourceUrls: ["https://example.com/customer-choice"],
        }),
      ]),
    );
    expect(context.intelligence.items.some((item) => item.id === "wiki-other")).toBe(
      false,
    );
  });

  it("keeps package component allocation non-additive and preserves unallocated components", async () => {
    const db = fakeDb({
      productSold: {
        findMany: vi.fn(async () => [
          {
            id: "sold-1",
            productId: "product-1",
            status: "fulfilled",
            quantity: { toNumber: () => 1 },
            totalAmount: { toNumber: () => 100 },
            currency: "USD",
            purchasedAt: now,
            parties: [],
            evidence: [],
            componentAllocations: [
              {
                componentCatalogItemId: "catalog-component",
                allocatedAmount: { toNumber: () => 40 },
                allocationMode: "percentage",
              },
              {
                componentCatalogItemId: "catalog-unallocated",
                allocatedAmount: null,
                allocationMode: "unallocated",
              },
            ],
          },
        ]),
      },
    });

    const context = await loadProductOperatingContext({
      db,
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
      authorize: vi.fn(async () => undefined),
      requestedAt: now,
    });

    expect(context.commercialPerformance).toMatchObject({
      additiveRevenue: 100,
      componentAllocations: [
        {
          catalogItemId: "catalog-component",
          allocatedAmount: 40,
          additive: false,
        },
      ],
      unallocatedComponentCount: 1,
    });
    expect(context.productSold.items[0]?.componentAllocations).toEqual([
      {
        catalogItemId: "catalog-component",
        allocatedAmount: 40,
        allocationMode: "percentage",
      },
      {
        catalogItemId: "catalog-unallocated",
        allocatedAmount: null,
        allocationMode: "unallocated",
      },
    ]);
  });
});
