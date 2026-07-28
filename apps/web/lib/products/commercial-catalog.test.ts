import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ITEM_STATUSES,
  PRODUCT_CONFIGURATION_KINDS,
  PRODUCT_OFFERING_STATUSES,
  ensureDefaultCommercialChain,
  ensureStorefrontCommercialChain,
  projectStorefrontCatalogItem,
  projectStorefrontCatalogRow,
  reconcileStorefrontCommercialCatalog,
  resolveCatalogProductLineSelection,
  updateCollapsedCommercialChain,
} from "./commercial-catalog";

describe("business commercial catalog", () => {
  it("uses canonical typed registries", () => {
    expect(PRODUCT_OFFERING_STATUSES).toEqual(["draft", "active", "retired"]);
    expect(CATALOG_ITEM_STATUSES).toEqual(["draft", "active", "retired"]);
    expect(PRODUCT_CONFIGURATION_KINDS).toEqual(["reusable"]);
  });

  it("collapses one real product line and requires an explicit choice only for a mixed-line business", () => {
    expect(resolveCatalogProductLineSelection([], null)).toEqual({
      productLineId: null,
      error: null,
    });
    expect(
      resolveCatalogProductLineSelection(
        [{ id: "line-services" }],
        null,
      ),
    ).toEqual({
      productLineId: "line-services",
      error: null,
    });
    expect(
      resolveCatalogProductLineSelection(
        [{ id: "line-services" }, { id: "line-retail" }],
        null,
      ),
    ).toEqual({
      productLineId: null,
      error:
        "productLineId is required when the business has multiple product lines",
    });
    expect(
      resolveCatalogProductLineSelection(
        [{ id: "line-services" }, { id: "line-retail" }],
        "line-retail",
      ),
    ).toEqual({
      productLineId: "line-retail",
      error: null,
    });
    expect(
      resolveCatalogProductLineSelection(
        [{ id: "line-services" }],
        "other-org-line",
      ),
    ).toEqual({
      productLineId: null,
      error: "Selected product line is not available to this organization",
    });
  });

  it("idempotently collapses a default offering and catalog item behind one product", async () => {
    const offeringUpsert = vi.fn().mockResolvedValue({ id: "offering-row" });
    const catalogItemUpsert = vi.fn().mockResolvedValue({ id: "catalog-row" });
    const db = {
      productOffering: { upsert: offeringUpsert },
      catalogItem: { upsert: catalogItemUpsert },
    };

    const input = {
      db,
      product: {
        id: "product-row",
        organizationId: "org-row",
        key: "haircut",
        name: "Haircut",
        description: "A standard haircut",
      },
      priceType: "fixed",
      priceAmount: 45,
      priceCurrency: "USD",
      sourceKind: "storefront-item",
      sourceRef: "ITEM-HAIRCUT",
    };

    await ensureDefaultCommercialChain(input);
    await ensureDefaultCommercialChain(input);

    expect(offeringUpsert).toHaveBeenCalledTimes(2);
    expect(offeringUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId_key: { productId: "product-row", key: "default" } },
        create: expect.objectContaining({
          organizationId: "org-row",
          providerOrganizationId: "org-row",
          productId: "product-row",
          key: "default",
          isDefault: true,
        }),
      }),
    );
    expect(offeringUpsert.mock.calls[0]?.[0]?.create).not.toHaveProperty("consumers");
    expect(offeringUpsert.mock.calls[0]?.[0]?.create).not.toHaveProperty(
      "digitalProductId",
    );

    expect(catalogItemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          offeringId_key: { offeringId: "offering-row", key: "default" },
        },
        create: expect.objectContaining({
          organizationId: "org-row",
          offeringId: "offering-row",
          name: "Haircut",
          priceAmount: 45,
          priceCurrency: "USD",
        }),
      }),
    );
  });

  it("prefers canonical catalog values while retaining legacy projection fields", () => {
    expect(
      projectStorefrontCatalogItem({
        id: "storefront-row",
        name: "Legacy name",
        description: "Legacy description",
        priceType: "from",
        priceAmount: "30",
        priceCurrency: "USD",
        catalogItem: {
          catalogItemId: "CAT-HAIRCUT",
          name: "Haircut",
          description: "Canonical description",
          priceType: "fixed",
          priceAmount: "45",
          priceCurrency: "USD",
          quoteRequired: false,
          status: "active",
        },
      }),
    ).toEqual({
      id: "storefront-row",
      catalogItemId: "CAT-HAIRCUT",
      name: "Haircut",
      description: "Canonical description",
      priceType: "fixed",
      priceAmount: "45",
      priceCurrency: "USD",
      quoteRequired: false,
      catalogStatus: "active",
      compatibilitySource: "catalog",
    });
  });

  it("maps a complete storefront row through one catalog-first compatibility adapter", () => {
    expect(
      projectStorefrontCatalogRow({
        id: "storefront-row",
        itemId: "ITEM-HAIRCUT",
        name: "Legacy name",
        description: "Legacy description",
        category: "Services",
        priceType: "from",
        priceAmount: { toString: () => "30" },
        priceCurrency: "USD",
        catalogItem: {
          catalogItemId: "CAT-HAIRCUT",
          name: "Haircut",
          description: "Canonical description",
          priceType: "fixed",
          priceAmount: { toString: () => "45" },
          priceCurrency: "USD",
          quoteRequired: false,
          status: "active",
        },
      }),
    ).toMatchObject({
      id: "storefront-row",
      itemId: "ITEM-HAIRCUT",
      category: "Services",
      catalogItemId: "CAT-HAIRCUT",
      name: "Haircut",
      description: "Canonical description",
      priceType: "fixed",
      priceAmount: "45",
      priceCurrency: "USD",
      compatibilitySource: "catalog",
    });
  });

  it("resolves a storefront item to one organization-owned Product before creating the chain", async () => {
    const productUpsert = vi.fn().mockResolvedValue({
      id: "product-row",
      organizationId: "org-row",
      key: "haircut",
      name: "Haircut",
      description: "A standard haircut",
    });
    const offeringUpsert = vi.fn().mockResolvedValue({ id: "offering-row" });
    const catalogItemUpsert = vi.fn().mockResolvedValue({ id: "catalog-row" });

    const result = await ensureStorefrontCommercialChain({
      db: {
        product: { upsert: productUpsert },
        productOffering: { upsert: offeringUpsert },
        catalogItem: { upsert: catalogItemUpsert },
      },
      organizationId: "org-row",
      productLineId: "line-row",
      name: "Haircut",
      description: "A standard haircut",
      priceType: "fixed",
      priceAmount: 45,
      priceCurrency: "USD",
      sourceRef: "ITEM-HAIRCUT",
    });

    expect(productUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productLineId_key: {
            productLineId: "line-row",
            key: "haircut",
          },
        },
        create: expect.objectContaining({
          organizationId: "org-row",
          productLineId: "line-row",
          key: "haircut",
          sourceKind: "storefront-item",
        }),
      }),
    );
    expect(result).toEqual({
      catalogItemId: "catalog-row",
      compatibilityReason: null,
    });
  });

  it("does not fabricate a product when legacy storefront evidence has no product line", async () => {
    const productUpsert = vi.fn();
    const offeringUpsert = vi.fn();
    const catalogItemUpsert = vi.fn();

    await expect(
      ensureStorefrontCommercialChain({
        db: {
          product: { upsert: productUpsert },
          productOffering: { upsert: offeringUpsert },
          catalogItem: { upsert: catalogItemUpsert },
        },
        organizationId: "org-row",
        productLineId: null,
        name: "Unmapped legacy service",
        description: null,
        priceType: "quote",
        priceAmount: null,
        priceCurrency: "USD",
        sourceRef: "ITEM-LEGACY",
      }),
    ).resolves.toEqual({
      catalogItemId: null,
      compatibilityReason: "product-line-unavailable",
    });

    expect(productUpsert).not.toHaveBeenCalled();
    expect(offeringUpsert).not.toHaveBeenCalled();
    expect(catalogItemUpsert).not.toHaveBeenCalled();
  });

  it("preserves an honest compatibility fallback for unlinked legacy items", () => {
    expect(
      projectStorefrontCatalogItem({
        id: "legacy-row",
        name: "Legacy service",
        description: null,
        priceType: "quote",
        priceAmount: null,
        priceCurrency: "USD",
        catalogItem: null,
      }),
    ).toEqual({
      id: "legacy-row",
      catalogItemId: null,
      name: "Legacy service",
      description: null,
      priceType: "quote",
      priceAmount: null,
      priceCurrency: "USD",
      quoteRequired: true,
      catalogStatus: null,
      compatibilitySource: "storefront",
    });
  });

  it("updates the collapsed Product, Offering, and CatalogItem through one boundary", async () => {
    const productUpdate = vi.fn().mockResolvedValue({ id: "product-row" });
    const offeringUpdate = vi.fn().mockResolvedValue({ id: "offering-row" });
    const catalogItemUpdate = vi.fn().mockResolvedValue({ id: "catalog-row" });
    const catalogItemFind = vi.fn().mockResolvedValue({
      id: "catalog-row",
      offering: {
        id: "offering-row",
        product: { id: "product-row" },
      },
    });

    await expect(
      updateCollapsedCommercialChain({
        db: {
          product: { update: productUpdate },
          productOffering: { update: offeringUpdate },
          catalogItem: {
            findUnique: catalogItemFind,
            update: catalogItemUpdate,
          },
        },
        catalogItemId: "catalog-row",
        name: "Precision haircut",
        description: "Updated once through the canonical boundary",
        priceType: "fixed",
        priceAmount: 55,
        priceCurrency: "USD",
      }),
    ).resolves.toBe(true);

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "product-row" },
      data: {
        name: "Precision haircut",
        description: "Updated once through the canonical boundary",
      },
    });
    expect(offeringUpdate).toHaveBeenCalledWith({
      where: { id: "offering-row" },
      data: {
        name: "Precision haircut",
        description: "Updated once through the canonical boundary",
      },
    });
    expect(catalogItemUpdate).toHaveBeenCalledWith({
      where: { id: "catalog-row" },
      data: {
        name: "Precision haircut",
        description: "Updated once through the canonical boundary",
        priceType: "fixed",
        priceAmount: 55,
        priceCurrency: "USD",
        quoteRequired: false,
      },
    });
  });

  it("reconciles only storefront rows backed by a real composition product line", async () => {
    const storefrontUpdate = vi.fn().mockResolvedValue({ id: "item-row" });
    const productUpsert = vi.fn().mockResolvedValue({
      id: "product-row",
      organizationId: "org-row",
      key: "haircut",
      name: "Haircut",
      description: null,
    });
    const offeringUpsert = vi.fn().mockResolvedValue({ id: "offering-row" });
    const catalogItemUpsert = vi.fn().mockResolvedValue({ id: "catalog-row" });

    await expect(
      reconcileStorefrontCommercialCatalog({
        db: {
          storefrontItem: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: "item-row",
                itemId: "ITEM-HAIRCUT",
                name: "Haircut",
                description: null,
                priceType: "fixed",
                priceAmount: 45,
                priceCurrency: "USD",
                sourceComposition: { productLineId: "line-row" },
              },
              {
                id: "legacy-row",
                itemId: "ITEM-LEGACY",
                name: "Legacy",
                description: null,
                priceType: "quote",
                priceAmount: null,
                priceCurrency: "USD",
                sourceComposition: null,
              },
            ]),
            update: storefrontUpdate,
          },
          product: { upsert: productUpsert },
          productOffering: { upsert: offeringUpsert },
          catalogItem: { upsert: catalogItemUpsert },
        },
        storefrontId: "storefront-row",
        organizationId: "org-row",
      }),
    ).resolves.toEqual({ linked: 1, unresolved: 1 });

    expect(storefrontUpdate).toHaveBeenCalledTimes(1);
    expect(storefrontUpdate).toHaveBeenCalledWith({
      where: { id: "item-row" },
      data: { catalogItemId: "catalog-row" },
    });
  });

  it.each([
    {
      label: "a simple one-line business",
      items: [
        ["ITEM-CONSULTING", "Consulting", "line-services"],
      ],
    },
    {
      label: "salon services plus retail goods",
      items: [
        ["ITEM-HAIRCUT", "Haircut", "line-salon-services"],
        ["ITEM-SHAMPOO", "Shampoo", "line-retail-goods"],
      ],
    },
    {
      label: "hotel rooms plus conferences and events",
      items: [
        ["ITEM-ROOM", "Guest room", "line-rooms"],
        ["ITEM-CONFERENCE", "Conference package", "line-events"],
      ],
    },
    {
      label: "restaurant dining plus private events",
      items: [
        ["ITEM-DINING", "Dinner", "line-dining"],
        ["ITEM-PRIVATE", "Private event", "line-events"],
      ],
    },
  ])(
    "preserves the real product-line boundary for $label",
    async ({ items }) => {
      const productUpsert = vi.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          id: `product-${create.sourceRef}`,
          organizationId: "org-row",
          key: create.key,
          name: create.name,
          description: create.description,
        }),
      );
      const offeringUpsert = vi.fn().mockImplementation(({ create }) =>
        Promise.resolve({ id: `offering-${create.sourceRef}` }),
      );
      const catalogItemUpsert = vi.fn().mockImplementation(({ create }) =>
        Promise.resolve({ id: `catalog-${create.sourceRef}` }),
      );
      const storefrontUpdate = vi.fn();

      const result = await reconcileStorefrontCommercialCatalog({
        db: {
          storefrontItem: {
            findMany: vi.fn().mockResolvedValue(
              items.map(([itemId, name, productLineId], index) => ({
                id: `row-${index}`,
                itemId,
                name,
                description: null,
                priceType: "fixed",
                priceAmount: 50 + index,
                priceCurrency: "USD",
                sourceComposition: { productLineId },
              })),
            ),
            update: storefrontUpdate,
          },
          product: { upsert: productUpsert },
          productOffering: { upsert: offeringUpsert },
          catalogItem: { upsert: catalogItemUpsert },
        },
        storefrontId: "storefront-row",
        organizationId: "org-row",
      });

      expect(result).toEqual({ linked: items.length, unresolved: 0 });
      expect(
        productUpsert.mock.calls.map(([call]) =>
          call.where.productLineId_key.productLineId),
      ).toEqual(items.map(([, , productLineId]) => productLineId));
      expect(JSON.stringify(productUpsert.mock.calls)).not.toMatch(
        /consumer|subscriber|entitlement|team/i,
      );
    },
  );
});
