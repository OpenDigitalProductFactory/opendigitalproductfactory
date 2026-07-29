import { describe, expect, it, vi } from "vitest";

import { getCatalogItemProductSoldTrace } from "./product-sold-query";

describe("Product Sold authorized trace query", () => {
  it("scopes the canonical query by organization and returns honest customer evidence", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "sold-row",
        productSoldId: "PS-001",
        status: "fulfilled",
        quantity: { toNumber: () => 1 },
        totalAmount: { toNumber: () => 1000 },
        currency: "USD",
        purchasedAt: new Date("2026-07-28T12:00:00.000Z"),
        commercialSnapshot: {
          providerOrganizationId: "org-one",
          product: { productId: "PRODUCT-EVENT", name: "Private events" },
          offering: {
            offeringId: "OFFERING-EVENT",
            name: "Hosted private event",
          },
          catalogItem: {
            catalogItemId: "CATALOG-EVENT",
            name: "Conference package",
          },
          catalogSku: null,
          configuration: null,
        },
        pricingSnapshot: { source: "accepted-quote-line" },
        evidence: [
          {
            evidenceId: "EVID-001",
            evidenceKind: "storefront-booking",
            observedAt: new Date("2026-07-28T12:01:00.000Z"),
            evidenceSnapshot: {
              bookingRef: "BOOK-001",
              customerEmail: "walk-in@example.com",
              customerName: "Walk-in customer",
            },
            sourceRef: "BOOK-001",
          },
        ],
        parties: [],
        entitlements: [],
        fulfillmentInstances: [
          {
            instanceId: "INSTANCE-001",
            instanceKind: "one-time-service",
            status: "fulfilled",
            fulfillmentSnapshot: { completedByBooking: "BOOK-001" },
          },
        ],
        componentAllocations: [
          {
            componentCatalogItemId: "room-row",
            allocatedAmount: { toNumber: () => 600 },
            allocationPercent: { toNumber: () => 60 },
            reportingTreatment: "non-additive",
            componentSnapshot: {
              catalogItemId: "CATALOG-ROOM",
              name: "Rooms",
            },
          },
          {
            componentCatalogItemId: "space-row",
            allocatedAmount: { toNumber: () => 400 },
            allocationPercent: { toNumber: () => 40 },
            reportingTreatment: "non-additive",
            componentSnapshot: {
              catalogItemId: "CATALOG-SPACE",
              name: "Conference space",
            },
          },
        ],
      },
    ]);

    const result = await getCatalogItemProductSoldTrace({
      db: { productSold: { findMany } },
      organizationId: "org-one",
      catalogItemId: "catalog-row",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-one",
          catalogItemId: "catalog-row",
        },
      }),
    );
    expect(result).toEqual({
      saleCount: 1,
      additiveRevenue: 1000,
      currency: "USD",
      records: [
        expect.objectContaining({
          productSoldId: "PS-001",
          customer: {
            label: "Walk-in customer",
            email: "walk-in@example.com",
            canonicalLinkEstablished: false,
            roles: [],
          },
          packageAllocations: [
            {
              catalogItemId: "CATALOG-ROOM",
              name: "Rooms",
              allocatedAmount: 600,
              allocationPercent: 60,
              additive: false,
            },
            {
              catalogItemId: "CATALOG-SPACE",
              name: "Conference space",
              allocatedAmount: 400,
              allocationPercent: 40,
              additive: false,
            },
          ],
        }),
      ],
    });
  });

  it("prefers canonical party roles when real account/contact links exist", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "sold-row",
        productSoldId: "PS-002",
        status: "purchased",
        quantity: 1,
        totalAmount: 200,
        currency: "USD",
        purchasedAt: new Date("2026-07-28T12:00:00.000Z"),
        commercialSnapshot: {
          product: { productId: "PRODUCT-EVENT", name: "Private events" },
          offering: {
            offeringId: "OFFERING-EVENT",
            name: "Hosted private event",
          },
          catalogItem: {
            catalogItemId: "CATALOG-EVENT",
            name: "Private event",
          },
          catalogSku: null,
          configuration: null,
        },
        pricingSnapshot: {},
        evidence: [
          {
            evidenceId: "EVID-002",
            evidenceKind: "quote-line",
            observedAt: new Date("2026-07-28T12:00:00.000Z"),
            evidenceSnapshot: {},
            sourceRef: "QUO-001:1",
          },
        ],
        parties: [
          {
            role: "account",
            displaySnapshot: { accountId: "ACC-001", name: "Acme" },
          },
        ],
        entitlements: [],
        fulfillmentInstances: [],
        componentAllocations: [],
      },
    ]);

    const result = await getCatalogItemProductSoldTrace({
      db: { productSold: { findMany } },
      organizationId: "org-one",
      catalogItemId: "catalog-row",
    });

    expect(result.records[0]?.customer).toEqual({
      label: "Acme",
      email: null,
      canonicalLinkEstablished: true,
      roles: ["account"],
    });
  });
});
