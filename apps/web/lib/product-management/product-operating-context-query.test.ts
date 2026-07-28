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
          topic: "market",
          status: "executed",
          updatedAt: now,
        },
        {
          proposalId: "research-product",
          digitalProductId: "digital-1",
          topic: "conversion",
          status: "executed",
          updatedAt: now,
        },
      ]),
    },
    marketingBattlecard: { findMany: empty },
    knowledgeArticle: { findMany: empty },
    backlogItem: { findMany: empty },
    changeItem: { findMany: empty },
    eaElement: { findMany: empty },
    productDependency: { findMany: empty },
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

  it("does not infer consumers, decisions, objectives, or schedules when no typed evidence exists", async () => {
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
    expect(context.scheduledPlaybooks.availability).toBe("unavailable");
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
