
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("business commercial catalog schema", () => {
  it("keeps the business commercial chain separate from digital architecture", () => {
    const offering = model("ProductOffering");
    const catalogItem = model("CatalogItem");

    expect(offering).toMatch(/\bproductId\s+String\b/);
    expect(offering).toMatch(/\bproviderOrganizationId\s+String\b/);
    expect(offering).toMatch(/\boperationalServiceOfferingId\s+String\?\s+@unique\b/);
    expect(offering).not.toMatch(/\bdigitalProductId\s+String\b/);
    expect(offering).not.toMatch(/\bconsumers\s+Json\b/);

    expect(catalogItem).toMatch(/\bofferingId\s+String\b/);
    expect(catalogItem).not.toMatch(/\bstorefrontId\s+String\b/);
    expect(catalogItem).not.toMatch(/\bconsumer/);
  });

  it("preserves organization boundaries through composite relations", () => {
    const offering = model("ProductOffering");
    const catalogItem = model("CatalogItem");
    const configuration = model("ProductConfiguration");
    const sku = model("CatalogSku");

    expect(offering).toContain(
      "@relation(fields: [productId, organizationId], references: [id, organizationId]",
    );
    expect(catalogItem).toContain(
      "@relation(fields: [offeringId, organizationId], references: [id, organizationId]",
    );
    expect(configuration).toContain(
      "@relation(fields: [catalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(sku).toContain(
      "@relation(fields: [catalogItemId, organizationId], references: [id, organizationId]",
    );
  });

  it("makes StorefrontItem a nullable projection and preserves quote compatibility", () => {
    const storefrontItem = model("StorefrontItem");
    const quoteLine = model("QuoteLineItem");

    expect(storefrontItem).toMatch(/\bcatalogItemId\s+String\?/);
    expect(storefrontItem).toMatch(/\bcatalogItem\s+CatalogItem\?/);

    expect(quoteLine).toMatch(/\bcatalogItemId\s+String\?/);
    expect(quoteLine).toMatch(/\bconfigurationSnapshot\s+Json\?/);
    expect(quoteLine).toMatch(/\bproductId\s+String\?/);
    expect(quoteLine).toMatch(/\bproduct\s+DigitalProduct\?/);
  });

  it("models reusable configurations and optional SKUs without sale-specific rows", () => {
    const configuration = model("ProductConfiguration");
    const sku = model("CatalogSku");

    expect(configuration).toMatch(/\bspecification\s+Json\b/);
    expect(configuration).toMatch(/\bkind\s+String\s+@default\("reusable"\)/);
    expect(configuration).not.toMatch(/\bquoteId\b|\borderId\b|\bconsumerId\b/);
    expect(sku).toMatch(/\bconfigurationId\s+String\?/);
    expect(sku).toMatch(/@@unique\(\[organizationId, code\]\)/);
  });

  it("lets an existing stocked unit reference a reusable SKU without duplicating inventory", () => {
    const sku = model("CatalogSku");
    const rentableUnit = model("RentableUnit");

    expect(rentableUnit).toMatch(/\bcatalogSkuId\s+String\?/);
    expect(rentableUnit).toMatch(/\bcatalogSku\s+CatalogSku\?/);
    expect(sku).toMatch(/\brentableUnits\s+RentableUnit\[\]/);
    expect(schema).not.toMatch(/model CatalogInventoryUnit \{/);
  });
});
