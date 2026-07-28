import { describe, expect, it, vi } from "vitest";

import {
  BUNDLE_ALLOCATION_MODES,
  BUNDLE_COMPONENT_ELIGIBILITY,
  CATALOG_CHANNEL_ELIGIBILITY,
  CATALOG_FULFILLMENT_ROUTES,
  CATALOG_PRICE_LIST_STATUSES,
  CATALOG_PROMOTION_ADJUSTMENT_TYPES,
  CATALOG_PROMOTION_STATUSES,
  allocateBundleRevenue,
  currentEffectiveWindowFilter,
  createCommercialSelectionSnapshot,
  deriveCatalogFulfillmentRoute,
  promoteOneOffConfiguration,
  resetBundleToEqualAllocation,
  summarizeCatalogBuilderSignals,
  resolveEffectiveCatalogPrice,
  validateBundleComponents,
  validateEffectiveWindow,
} from "./catalog-builder";
import {
  STOREFRONT_CTA_OPTIONS,
  STOREFRONT_PRICE_TYPE_OPTIONS,
} from "./storefront-commercial-options";

describe("Catalog Builder contracts", () => {
  it("keeps records with a future end date in the current catalog projection", () => {
    const asOf = new Date("2026-07-28T18:00:00.000Z");

    expect(currentEffectiveWindowFilter(asOf)).toEqual({
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    });
  });

  it("uses canonical typed registries", () => {
    expect(CATALOG_FULFILLMENT_ROUTES).toEqual([
      "direct-purchase",
      "booking",
      "configured-purchase",
      "quote",
      "subscription",
      "reservation",
      "verified-other",
    ]);
    expect(CATALOG_PRICE_LIST_STATUSES).toEqual(["draft", "active", "retired"]);
    expect(CATALOG_PROMOTION_STATUSES).toEqual(["draft", "active", "retired"]);
    expect(CATALOG_PROMOTION_ADJUSTMENT_TYPES).toEqual([
      "percentage",
      "fixed-amount",
      "fixed-price",
    ]);
    expect(CATALOG_CHANNEL_ELIGIBILITY).toEqual(["eligible", "ineligible"]);
    expect(BUNDLE_COMPONENT_ELIGIBILITY).toEqual([
      "standalone-and-bundle",
      "bundle-only",
    ]);
    expect(BUNDLE_ALLOCATION_MODES).toEqual([
      "percentage",
      "equal",
      "unallocated",
    ]);
    expect(STOREFRONT_CTA_OPTIONS.map(({ value }) => value)).toEqual([
      "booking",
      "purchase",
      "rental",
      "inquiry",
      "donation",
    ]);
    expect(
      STOREFRONT_PRICE_TYPE_OPTIONS.inquiry.map(({ value }) => value),
    ).toEqual(["quote", "from", "per-hour", "fixed"]);
  });

  it("derives compatibility routes without requiring a quote for fixed-price or booking items", () => {
    expect(
      deriveCatalogFulfillmentRoute({
        storedRoute: null,
        quoteRequired: false,
        storefrontCtaType: "purchase",
      }),
    ).toBe("direct-purchase");
    expect(
      deriveCatalogFulfillmentRoute({
        storedRoute: null,
        quoteRequired: false,
        storefrontCtaType: "booking",
      }),
    ).toBe("booking");
    expect(
      deriveCatalogFulfillmentRoute({
        storedRoute: null,
        quoteRequired: true,
        storefrontCtaType: "inquiry",
      }),
    ).toBe("quote");
    expect(
      deriveCatalogFulfillmentRoute({
        storedRoute: "configured-purchase",
        quoteRequired: false,
        storefrontCtaType: "purchase",
      }),
    ).toBe("configured-purchase");
    expect(
      deriveCatalogFulfillmentRoute({
        storedRoute: null,
        quoteRequired: false,
        storefrontCtaType: "inquiry",
      }),
    ).toBeNull();
  });

  it("rejects inverted effective windows", () => {
    expect(
      validateEffectiveWindow({
        effectiveFrom: new Date("2026-12-20T00:00:00Z"),
        effectiveTo: new Date("2026-12-01T00:00:00Z"),
      }),
    ).toEqual({
      ok: false,
      error: "effectiveTo must be later than effectiveFrom",
    });
  });

  it("resolves an exact SKU price and an effective seasonal promotion", () => {
    const result = resolveEffectiveCatalogPrice({
      asOf: new Date("2026-12-20T12:00:00Z"),
      catalogItemId: "dinner-package",
      catalogSkuId: "sku-two-guests",
      basePrice: 140,
      priceEntries: [
        {
          id: "generic",
          catalogItemId: "dinner-package",
          catalogSkuId: null,
          priceAmount: 130,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          effectiveTo: null,
          priceList: {
            id: "standard",
            status: "active",
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            effectiveTo: null,
          },
        },
        {
          id: "exact",
          catalogItemId: "dinner-package",
          catalogSkuId: "sku-two-guests",
          priceAmount: 120,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          effectiveTo: null,
          priceList: {
            id: "standard",
            status: "active",
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            effectiveTo: null,
          },
        },
      ],
      promotions: [
        {
          id: "christmas",
          status: "active",
          adjustmentType: "percentage",
          adjustmentValue: 10,
          effectiveFrom: new Date("2026-12-01T00:00:00Z"),
          effectiveTo: new Date("2026-12-27T00:00:00Z"),
        },
      ],
    });

    expect(result).toEqual({
      baseAmount: 120,
      finalAmount: 108,
      priceListEntryId: "exact",
      promotionIds: ["christmas"],
    });
  });

  it.each([
    {
      fixture: "haircut + shave",
      parentCatalogItemId: "salon-special",
      components: [
        { catalogItemId: "haircut", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 70 },
        { catalogItemId: "shave", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 30 },
      ],
    },
    {
      fixture: "full dinner versus a la carte",
      parentCatalogItemId: "full-dinner",
      components: [
        { catalogItemId: "starter", quantity: 1, allocationMode: "equal" as const, allocationPercent: null },
        { catalogItemId: "main", quantity: 1, allocationMode: "equal" as const, allocationPercent: null },
        { catalogItemId: "dessert", quantity: 1, allocationMode: "equal" as const, allocationPercent: null },
      ],
    },
    {
      fixture: "hotel conference",
      parentCatalogItemId: "conference-package",
      components: [
        { catalogItemId: "room", quantity: 10, allocationMode: "percentage" as const, allocationPercent: 50 },
        { catalogItemId: "conference-space", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 50 },
      ],
    },
    {
      fixture: "car + loan + insurance",
      parentCatalogItemId: "car-package",
      components: [
        { catalogItemId: "car", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 90 },
        { catalogItemId: "loan", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 5 },
        { catalogItemId: "insurance", quantity: 1, allocationMode: "percentage" as const, allocationPercent: 5 },
      ],
    },
  ])("validates $fixture without changing product parentage", ({ parentCatalogItemId, components }) => {
    expect(
      validateBundleComponents({
        parentCatalogItemId,
        components,
      }),
    ).toEqual({ ok: true, error: null });
  });

  it("rejects self-membership and incomplete explicit percentage allocation", () => {
    expect(
      validateBundleComponents({
        parentCatalogItemId: "package",
        components: [
          {
            catalogItemId: "package",
            quantity: 1,
            allocationMode: "percentage",
            allocationPercent: 100,
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "A catalog item cannot contain itself",
    });
    expect(
      validateBundleComponents({
        parentCatalogItemId: "package",
        components: [
          {
            catalogItemId: "a",
            quantity: 1,
            allocationMode: "percentage",
            allocationPercent: 60,
          },
          {
            catalogItemId: "b",
            quantity: 1,
            allocationMode: "percentage",
            allocationPercent: 20,
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "Percentage allocations must total 100",
    });
  });

  it("counts package revenue once while exposing non-additive component attribution", () => {
    const allocation = allocateBundleRevenue({
      packageRevenue: 1000,
      components: [
        {
          catalogItemId: "car",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 90,
        },
        {
          catalogItemId: "loan",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 5,
        },
        {
          catalogItemId: "insurance",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 5,
        },
      ],
    });

    expect(allocation.packageRevenue).toBe(1000);
    expect(allocation.commercialSaleCount).toBe(1);
    expect(allocation.componentAttribution).toEqual([
      { catalogItemId: "car", allocatedRevenue: 900, additive: false },
      { catalogItemId: "loan", allocatedRevenue: 50, additive: false },
      { catalogItemId: "insurance", allocatedRevenue: 50, additive: false },
    ]);
  });

  it("assigns currency rounding remainder to the last equal component even when unallocated rows follow", () => {
    const allocation = allocateBundleRevenue({
      packageRevenue: 100,
      components: [
        {
          catalogItemId: "room",
          quantity: 1,
          allocationMode: "equal",
          allocationPercent: null,
        },
        {
          catalogItemId: "conference-space",
          quantity: 1,
          allocationMode: "equal",
          allocationPercent: null,
        },
        {
          catalogItemId: "catering",
          quantity: 1,
          allocationMode: "equal",
          allocationPercent: null,
        },
        {
          catalogItemId: "optional-not-attributed",
          quantity: 1,
          allocationMode: "unallocated",
          allocationPercent: null,
        },
      ],
    });

    expect(allocation.componentAttribution).toEqual([
      { catalogItemId: "room", allocatedRevenue: 33.33, additive: false },
      {
        catalogItemId: "conference-space",
        allocatedRevenue: 33.33,
        additive: false,
      },
      {
        catalogItemId: "catering",
        allocatedRevenue: 33.34,
        additive: false,
      },
      {
        catalogItemId: "optional-not-attributed",
        allocatedRevenue: 0,
        additive: false,
      },
    ]);
  });

  it("rejects percentage values outside the zero-to-one-hundred range", () => {
    expect(
      validateBundleComponents({
        parentCatalogItemId: "package",
        components: [
          {
            catalogItemId: "a",
            quantity: 1,
            allocationMode: "percentage",
            allocationPercent: 120,
          },
          {
            catalogItemId: "b",
            quantity: 1,
            allocationMode: "percentage",
            allocationPercent: -20,
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "Percentage allocation must be between 0 and 100",
    });
  });

  it("resets allocation to a valid equal split when package contents change", () => {
    expect(
      resetBundleToEqualAllocation([
        {
          catalogItemId: "room",
          quantity: 10,
          allocationMode: "percentage",
          allocationPercent: 80,
        },
        {
          catalogItemId: "conference-space",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 20,
        },
      ]),
    ).toEqual([
      {
        catalogItemId: "room",
        quantity: 10,
        allocationMode: "equal",
        allocationPercent: null,
      },
      {
        catalogItemId: "conference-space",
        quantity: 1,
        allocationMode: "equal",
        allocationPercent: null,
      },
    ]);
  });

  it("projects attach, conversion, margin, and option demand without counting package revenue twice", () => {
    expect(
      summarizeCatalogBuilderSignals([
        {
          selectionId: "sale-one",
          revenue: 1000,
          cost: 600,
          quoted: true,
          converted: true,
          bundleComponentIds: ["room", "conference-space"],
          configurationValues: { layout: "banquet", catering: true },
        },
        {
          selectionId: "sale-two",
          revenue: 800,
          cost: 500,
          quoted: true,
          converted: false,
          bundleComponentIds: ["room"],
          configurationValues: { layout: "theatre", catering: false },
        },
      ]),
    ).toEqual({
      commercialSaleCount: 2,
      revenue: 1800,
      cost: 1100,
      margin: 700,
      marginRate: 38.89,
      costCoverageRate: 100,
      quoteConversion: {
        quotedSelections: 2,
        convertedSelections: 1,
        conversionRate: 50,
      },
      componentAttach: [
        { catalogItemId: "conference-space", selections: 1, attachRate: 50 },
        { catalogItemId: "room", selections: 2, attachRate: 100 },
      ],
      optionDemand: [
        { option: "catering=false", selections: 1 },
        { option: "catering=true", selections: 1 },
        { option: "layout=banquet", selections: 1 },
        { option: "layout=theatre", selections: 1 },
      ],
    });
  });

  it("withholds margin when any selection lacks real cost evidence", () => {
    const signals = summarizeCatalogBuilderSignals([
      {
        selectionId: "sale-one",
        revenue: 100,
        cost: null,
        quoted: false,
        converted: true,
        bundleComponentIds: [],
        configurationValues: null,
      },
    ]);

    expect(signals).toMatchObject({
      commercialSaleCount: 1,
      revenue: 100,
      cost: null,
      margin: null,
      marginRate: null,
      costCoverageRate: 0,
    });
  });

  it("creates an immutable exact-SKU or one-off selection snapshot", () => {
    const snapshot = createCommercialSelectionSnapshot({
      catalogItem: {
        catalogItemId: "CAT-CAR",
        name: "Configured car",
        fulfillmentRoute: "configured-purchase",
      },
      catalogSku: null,
      configuration: {
        kind: "one-off",
        values: { paint: "blue", wheels: "sport" },
      },
      price: {
        amount: 48_000,
        currency: "USD",
        promotionIds: [],
      },
      bundleComponents: [],
      capturedAt: new Date("2026-07-28T12:00:00Z"),
    });

    expect(snapshot).toEqual({
      version: 1,
      catalogItem: {
        catalogItemId: "CAT-CAR",
        name: "Configured car",
        fulfillmentRoute: "configured-purchase",
      },
      catalogSku: null,
      configuration: {
        kind: "one-off",
        values: { paint: "blue", wheels: "sport" },
      },
      price: {
        amount: 48_000,
        currency: "USD",
        promotionIds: [],
      },
      bundleComponents: [],
      capturedAt: "2026-07-28T12:00:00.000Z",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("promotes a one-off configuration deliberately and idempotently", async () => {
    const configurationUpsert = vi.fn().mockResolvedValue({ id: "config-row" });
    const skuUpsert = vi.fn().mockResolvedValue({ id: "sku-row" });
    const db = {
      quoteLineItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "quote-line",
          catalogItemId: "catalog-row",
          catalogSkuId: null,
          configurationSnapshot: {
            version: 1,
            configuration: {
              kind: "one-off",
              values: { paint: "blue" },
            },
          },
          catalogItem: { organizationId: "org-row" },
        }),
      },
      productConfiguration: { upsert: configurationUpsert },
      catalogSku: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: skuUpsert,
      },
    };

    await promoteOneOffConfiguration({
      db: db as never,
      organizationId: "org-row",
      quoteLineItemId: "quote-line",
      key: "blue-edition",
      name: "Blue edition",
      skuCode: "CAR-BLUE",
      promotedAt: new Date("2026-07-28T12:00:00Z"),
    });
    await promoteOneOffConfiguration({
      db: db as never,
      organizationId: "org-row",
      quoteLineItemId: "quote-line",
      key: "blue-edition",
      name: "Blue edition",
      skuCode: "CAR-BLUE",
      promotedAt: new Date("2026-07-28T12:00:00Z"),
    });

    expect(configurationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          catalogItemId_key: {
            catalogItemId: "catalog-row",
            key: "blue-edition",
          },
        },
        create: expect.objectContaining({
          organizationId: "org-row",
          catalogItemId: "catalog-row",
          kind: "reusable",
          promotedFromQuoteLineItemId: "quote-line",
        }),
      }),
    );
    expect(skuUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_code: {
            organizationId: "org-row",
            code: "CAR-BLUE",
          },
        },
      }),
    );
  });

  it("rejects deliberate promotion when the SKU code belongs to another catalog item", async () => {
    const configurationUpsert = vi.fn();
    const db = {
      quoteLineItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "quote-line",
          catalogItemId: "catalog-row",
          catalogSkuId: null,
          configurationSnapshot: {
            configuration: {
              kind: "one-off",
              values: { paint: "blue" },
            },
          },
          catalogItem: { organizationId: "org-row" },
        }),
      },
      productConfiguration: { upsert: configurationUpsert },
      catalogSku: {
        findUnique: vi.fn().mockResolvedValue({
          id: "other-sku",
          catalogItemId: "other-catalog-row",
        }),
        upsert: vi.fn(),
      },
    };

    await expect(
      promoteOneOffConfiguration({
        db: db as never,
        organizationId: "org-row",
        quoteLineItemId: "quote-line",
        key: "blue-edition",
        name: "Blue edition",
        skuCode: "CAR-BLUE",
        promotedAt: new Date("2026-07-28T12:00:00Z"),
      }),
    ).rejects.toThrow("SKU code is already used by another catalog item");
    expect(configurationUpsert).not.toHaveBeenCalled();
  });
});
