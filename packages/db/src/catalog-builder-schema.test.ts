import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(import.meta.dirname, "../prisma/schema.prisma"),
  "utf8",
);
const tableClassification = readFileSync(
  resolve(import.meta.dirname, "table-classification.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260728170000_add_catalog_builder_packaging/migration.sql",
  ),
  "utf8",
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Catalog Builder schema", () => {
  it("keeps packaging on canonical CatalogItem rather than DigitalProduct or StorefrontItem", () => {
    const catalogItem = model("CatalogItem");
    const storefrontItem = model("StorefrontItem");

    expect(catalogItem).toMatch(/\bfulfillmentRoute\s+String\?/);
    expect(catalogItem).toMatch(/\bbundleComponents\s+CatalogBundleComponent\[\]/);
    expect(catalogItem).toMatch(/\bcomponentOfBundles\s+CatalogBundleComponent\[\]/);
    expect(catalogItem).toMatch(/\bpriceListEntries\s+CatalogPriceListEntry\[\]/);
    expect(catalogItem).toMatch(/\bpromotionItems\s+CatalogPromotionItem\[\]/);
    expect(catalogItem).toMatch(/\bchannelEligibility\s+CatalogChannelEligibility\[\]/);
    expect(storefrontItem).not.toMatch(/\bbundleComponents\b|\bpriceListEntries\b|\bpromotions\b/);

    for (const name of [
      "CatalogBundleComponent",
      "CatalogPriceListEntry",
      "CatalogPromotionItem",
      "CatalogChannelEligibility",
    ]) {
      expect(model(name)).not.toMatch(/\bdigitalProductId\b/);
    }
  });

  it("preserves organization boundaries for bundle membership and price selection", () => {
    const bundle = model("CatalogBundleComponent");
    const priceEntry = model("CatalogPriceListEntry");

    expect(bundle).toContain(
      "@relation(\"CatalogBundleParent\", fields: [parentCatalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(bundle).toContain(
      "@relation(\"CatalogBundleComponentItem\", fields: [componentCatalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(priceEntry).toContain(
      "@relation(fields: [catalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(priceEntry).toContain(
      "@relation(fields: [catalogSkuId, organizationId], references: [id, organizationId]",
    );
  });

  it("models effective-dated price lists, promotions, and channel eligibility", () => {
    const priceList = model("CatalogPriceList");
    const priceEntry = model("CatalogPriceListEntry");
    const promotion = model("CatalogPromotion");
    const promotionItem = model("CatalogPromotionItem");
    const eligibility = model("CatalogChannelEligibility");

    expect(priceList).toMatch(/\bcurrency\s+String\b/);
    expect(priceList).toMatch(/\beffectiveFrom\s+DateTime\b/);
    expect(priceList).toMatch(/\beffectiveTo\s+DateTime\?/);
    expect(priceEntry).toMatch(/\bpriceAmount\s+Decimal\b/);
    expect(priceEntry).toMatch(/\bcatalogSkuId\s+String\?/);
    expect(promotion).toMatch(/\badjustmentType\s+String\b/);
    expect(promotion).toMatch(/\badjustmentValue\s+Decimal\b/);
    expect(promotionItem).toMatch(/\bpriceListId\s+String\?/);
    expect(promotionItem).toContain(
      "@relation(fields: [priceListId, organizationId], references: [id, organizationId]",
    );
    expect(eligibility).toMatch(/\bchannelKey\s+String\b/);
    expect(eligibility).toMatch(/\beligibility\s+String\b/);
  });

  it("records explicit reusable-configuration promotion and exact quote-line SKU selection", () => {
    const configuration = model("ProductConfiguration");
    const quoteLine = model("QuoteLineItem");
    const sku = model("CatalogSku");

    expect(configuration).toMatch(/\bpromotedFromQuoteLineItemId\s+String\?/);
    expect(configuration).toMatch(/\bpromotionSnapshot\s+Json\?/);
    expect(configuration).toMatch(/\bpromotedAt\s+DateTime\?/);
    expect(quoteLine).toMatch(/\bcatalogSkuId\s+String\?/);
    expect(quoteLine).toMatch(/\bcatalogSku\s+CatalogSku\?/);
    expect(sku).toMatch(/\bquoteLineItems\s+QuoteLineItem\[\]/);
  });

  it("does not add a duplicate inventory or catalog-owned sale authority", () => {
    expect(schema).not.toMatch(/model CatalogInventoryUnit \{/);
    expect(schema).not.toMatch(/model CatalogSale \{/);
    expect(schema.match(/model ProductSold \{/g)).toHaveLength(1);
    expect(model("ProductSold")).not.toMatch(/\bdigitalProductId\b/);
  });

  it("classifies every new catalog packaging table as internal business data", () => {
    for (const name of [
      "CatalogBundleComponent",
      "CatalogPriceList",
      "CatalogPriceListEntry",
      "CatalogPromotion",
      "CatalogPromotionItem",
      "CatalogChannelEligibility",
    ]) {
      expect(tableClassification).toContain(`${name}: "internal"`);
    }
  });

  it("enforces nullable business keys and organization-safe promotion pricing in SQL", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "CatalogPriceListEntry_defaultSku_effectiveFrom_key"',
    );
    expect(migration).toContain(
      'WHERE "catalogSkuId" IS NULL',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "CatalogPromotionItem_defaultPriceList_key"',
    );
    expect(migration).toContain(
      'WHERE "priceListId" IS NULL',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("priceListId", "organizationId"\)\s+REFERENCES "CatalogPriceList"\("id", "organizationId"\)/,
    );
  });
});
