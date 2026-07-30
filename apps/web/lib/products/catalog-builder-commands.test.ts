import { describe, expect, it, vi } from "vitest";

import {
  executeCatalogBuilderCommand,
  type CatalogBuilderCommandClient,
} from "./catalog-builder-commands";

function commandDb(overrides: Record<string, unknown> = {}) {
  const db = {
    catalogItem: {
      update: vi.fn().mockResolvedValue({ id: "catalog-item" }),
      findMany: vi.fn().mockResolvedValue([{ id: "component-item" }]),
    },
    catalogBundleComponent: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    catalogPriceList: {
      upsert: vi.fn().mockResolvedValue({ id: "price-list" }),
    },
    catalogPriceListEntry: {
      create: vi.fn().mockResolvedValue({ id: "price-entry" }),
    },
    catalogPromotion: {
      upsert: vi.fn().mockResolvedValue({ id: "promotion" }),
    },
    catalogPromotionItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: "promotion-item" }),
    },
    catalogChannelEligibility: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: "channel" }),
    },
    productConfiguration: {
      upsert: vi.fn().mockResolvedValue({ id: "configuration" }),
    },
    catalogSku: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: "sku" }),
    },
    quoteLineItem: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    ),
    ...overrides,
  };
  return db as typeof db & CatalogBuilderCommandClient;
}

const catalogItem = {
  id: "catalog-item",
  organizationId: "org-one",
  priceCurrency: "USD",
};

describe("Catalog Builder command service", () => {
  it("keeps fulfillment routing in the canonical catalog item", async () => {
    const db = commandDb();

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "set-fulfillment-route",
        fulfillmentRoute: "direct-purchase",
      },
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(db.catalogItem.update).toHaveBeenCalledWith({
      where: { id: "catalog-item" },
      data: {
        fulfillmentRoute: "direct-purchase",
        quoteRequired: false,
      },
    });
  });

  it("clears an explicit route without erasing legacy quote evidence", async () => {
    const db = commandDb();

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "set-fulfillment-route",
        fulfillmentRoute: null,
      },
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(db.catalogItem.update).toHaveBeenCalledWith({
      where: { id: "catalog-item" },
      data: { fulfillmentRoute: null },
    });
  });

  it("rejects a cross-organization bundle before replacing existing components", async () => {
    const db = commandDb({
      catalogItem: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      executeCatalogBuilderCommand({
        db,
        catalogItem,
        command: {
          operation: "replace-bundle",
          components: [
            {
              catalogItemId: "other-org-item",
              quantity: 1,
              eligibility: "standalone-and-bundle",
              allocationMode: "equal",
              allocationPercent: null,
            },
          ],
        },
        now: new Date("2026-07-28T12:00:00.000Z"),
      }),
    ).rejects.toThrow(
      "Every package component must be an active item from this organization",
    );
    expect(db.catalogBundleComponent.deleteMany).not.toHaveBeenCalled();
  });

  it("accepts only currently effective active components from the same organization", async () => {
    const db = commandDb();
    const now = new Date("2026-07-28T12:00:00.000Z");

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "replace-bundle",
        components: [
          {
            catalogItemId: "component-item",
            quantity: 1,
            eligibility: "standalone-and-bundle",
            allocationMode: "equal",
            allocationPercent: null,
          },
        ],
      },
      now,
    });

    expect(db.catalogItem.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["component-item"] },
        organizationId: "org-one",
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
    });
  });

  it("uses the injected clock for effective-dated channel history", async () => {
    const db = commandDb();
    const now = new Date("2026-12-01T09:30:00.000Z");

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "set-channel-eligibility",
        channelKey: "storefront",
        eligibility: "eligible",
      },
      now,
    });

    expect(db.catalogChannelEligibility.updateMany).toHaveBeenCalledWith({
      where: {
        catalogItemId: "catalog-item",
        channelKey: "storefront",
        effectiveTo: null,
      },
      data: { effectiveTo: now },
    });
    expect(db.catalogChannelEligibility.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-one",
        catalogItemId: "catalog-item",
        channelKey: "storefront",
        eligibility: "eligible",
        effectiveFrom: now,
      }),
    });
  });

  it("rejects inverted price windows before persistence", async () => {
    const db = commandDb();

    await expect(
      executeCatalogBuilderCommand({
        db,
        catalogItem,
        command: {
          operation: "add-price-list-entry",
          name: "Christmas",
          priceAmount: 75,
          effectiveFrom: "2026-12-31",
          effectiveTo: "2026-12-01",
        },
        now: new Date("2026-07-28T12:00:00.000Z"),
      }),
    ).rejects.toThrow("effectiveTo must be later than effectiveFrom");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps a named price list active while dating the individual entry", async () => {
    const db = commandDb();
    const now = new Date("2026-07-28T12:00:00.000Z");

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "add-price-list-entry",
        name: "Standard prices",
        priceAmount: 125,
        effectiveFrom: "2026-12-01",
        effectiveTo: "2027-01-01",
      },
      now,
    });

    expect(db.catalogPriceList.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          effectiveFrom: now,
          effectiveTo: null,
        }),
        update: expect.objectContaining({
          effectiveTo: null,
        }),
      }),
    );
    expect(db.catalogPriceListEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        effectiveFrom: new Date("2026-12-01T00:00:00.000Z"),
        effectiveTo: new Date("2027-01-01T00:00:00.000Z"),
      }),
    });
  });

  it("keys seasonal promotions by occurrence so a later year does not rewrite history", async () => {
    const db = commandDb();

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "add-promotion",
        name: "Christmas special",
        adjustmentType: "percentage",
        adjustmentValue: 10,
        effectiveFrom: "2026-12-01",
        effectiveTo: "2026-12-26",
      },
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(db.catalogPromotion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_key: {
            organizationId: "org-one",
            key: "christmas-special-2026-12-01",
          },
        },
      }),
    );
  });

  it("does not reassign an existing SKU code from another catalog item", async () => {
    const db = commandDb({
      catalogSku: {
        findUnique: vi.fn().mockResolvedValue({
          id: "existing-sku",
          catalogItemId: "different-catalog-item",
        }),
        upsert: vi.fn(),
      },
    });

    await expect(
      executeCatalogBuilderCommand({
        db,
        catalogItem,
        command: {
          operation: "publish-configuration",
          name: "Blue edition",
          skuCode: "CAR-BLUE",
          specification: { paint: "blue" },
        },
        now: new Date("2026-07-28T12:00:00.000Z"),
      }),
    ).rejects.toThrow("SKU code is already used by another catalog item");
    expect(db.productConfiguration.upsert).not.toHaveBeenCalled();
    expect(db.catalogSku.upsert).not.toHaveBeenCalled();
  });

  it("promotes a quoted one-off configuration atomically", async () => {
    const db = commandDb();
    db.quoteLineItem.findUnique.mockResolvedValue({
      id: "quote-line",
      catalogItemId: "catalog-item",
      catalogSkuId: null,
      configurationSnapshot: {
        configuration: {
          kind: "one-off",
          values: { paint: "blue" },
        },
      },
      catalogItem: { organizationId: "org-one" },
    });

    await executeCatalogBuilderCommand({
      db,
      catalogItem,
      command: {
        operation: "promote-quote-configuration",
        quoteLineItemId: "quote-line",
        name: "Blue edition",
        skuCode: "CAR-BLUE",
      },
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.productConfiguration.upsert).toHaveBeenCalledTimes(1);
    expect(db.catalogSku.upsert).toHaveBeenCalledTimes(1);
  });
});
