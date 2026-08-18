import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();
const tableClassification = readFileSync(
  resolve(import.meta.dirname, "table-classification.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260728190000_add_product_sold_traceability/migration.sql",
  ),
  "utf8",
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Product Sold traceability schema", () => {
  it("creates one business-commercial sale root without broadening DigitalProduct", () => {
    const sold = model("ProductSold");

    expect(sold).toMatch(/\bproviderOrganizationId\s+String\b/);
    expect(sold).toMatch(/\bproductId\s+String\b/);
    expect(sold).toMatch(/\bofferingId\s+String\b/);
    expect(sold).toMatch(/\bcatalogItemId\s+String\b/);
    expect(sold).toMatch(/\bcatalogSkuId\s+String\?/);
    expect(sold).toMatch(/\bconfigurationId\s+String\?/);
    expect(sold).toMatch(/\bmaterializationKey\s+String\s+@unique\b/);
    expect(sold).toMatch(/\bcommercialSnapshot\s+Json\b/);
    expect(sold).toMatch(/\bpricingSnapshot\s+Json\b/);
    expect(sold).not.toMatch(/\bdigitalProductId\b/);
  });

  it("preserves the organization and provider boundary through composite relations", () => {
    const sold = model("ProductSold");

    expect(sold).toContain(
      '@relation("ProductSoldOrganization", fields: [organizationId], references: [id]',
    );
    expect(sold).toContain(
      '@relation("ProductSoldProviderOrganization", fields: [providerOrganizationId], references: [id]',
    );
    expect(sold).toContain(
      "@relation(fields: [productId, organizationId], references: [id, organizationId]",
    );
    expect(sold).toContain(
      "@relation(fields: [offeringId, organizationId], references: [id, organizationId]",
    );
    expect(sold).toContain(
      "@relation(fields: [catalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(sold).toMatch(/@@unique\(\[id, organizationId\]\)/);
  });

  it("normalizes storefront transaction lines while retaining the JSON compatibility field", () => {
    const order = model("StorefrontOrder");
    const line = model("StorefrontOrderLineItem");

    expect(order).toMatch(/\borganizationId\s+String\?/);
    expect(order).toMatch(/\bitems\s+Json\b/);
    expect(order).toMatch(/\blineItems\s+StorefrontOrderLineItem\[\]/);
    expect(line).toContain(
      "@relation(fields: [storefrontOrderId, organizationId], references: [id, organizationId]",
    );
    expect(line).toContain(
      "@relation(fields: [catalogItemId, organizationId], references: [id, organizationId]",
    );
    expect(line).toMatch(/\bconfigurationSnapshot\s+Json\?/);
    expect(line).toMatch(/\bpricingSnapshot\s+Json\b/);
  });

  it("keeps evidence, parties, entitlements, fulfillment instances, and allocations distinct", () => {
    const evidence = model("ProductSoldEvidence");
    const party = model("ProductSoldParty");
    const entitlement = model("ProductSoldEntitlement");
    const fulfillment = model("ProductFulfillmentInstance");
    const allocation = model("ProductSoldComponentAllocation");

    expect(evidence).toMatch(/\bquoteLineItemId\s+String\?/);
    expect(evidence).toMatch(/\bsalesOrderId\s+String\?/);
    expect(evidence).toMatch(/\bstorefrontOrderLineItemId\s+String\?/);
    expect(evidence).toMatch(/\bstorefrontBookingId\s+String\?/);
    expect(evidence).toMatch(/\brentalAgreementId\s+String\?/);
    expect(evidence).toMatch(/\bsubscriptionId\s+String\?/);

    expect(party).toMatch(/\brole\s+String\b/);
    expect(party).toMatch(/\baccountId\s+String\?/);
    expect(party).toMatch(/\bcontactId\s+String\?/);
    expect(party).toMatch(/\bevidenceId\s+String\b/);

    expect(entitlement).toMatch(/\bsubscriptionId\s+String\?/);
    expect(entitlement).toMatch(/\bentitlementKey\s+String\s+@unique\b/);
    expect(entitlement).toMatch(/\brightSnapshot\s+Json\b/);
    expect(entitlement).toMatch(/\bevidenceId\s+String\b/);

    expect(fulfillment).toMatch(/\bstorefrontBookingId\s+String\?/);
    expect(fulfillment).toMatch(/\brentalAgreementId\s+String\?/);
    expect(fulfillment).toMatch(/\brentableUnitId\s+String\?/);
    expect(fulfillment).toMatch(/\bedgeNodeId\s+String\?/);
    expect(fulfillment).toMatch(/\binstanceKey\s+String\s+@unique\b/);
    expect(fulfillment).toMatch(/\bevidenceId\s+String\b/);

    expect(allocation).toMatch(/\ballocatedAmount\s+Decimal\?/);
    expect(allocation).toMatch(/\ballocationPercent\s+Decimal\?/);
    expect(allocation).toMatch(/\bcomponentSnapshot\s+Json\b/);
  });

  it("enforces evidence-backed optional identities and typed source invariants in SQL", () => {
    expect(migration).toMatch(
      /CONSTRAINT "ProductSoldEvidence_exactly_one_source" CHECK \(num_nonnulls\([\s\S]*?\) = 1\)/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "ProductSoldParty_exactly_one_party" CHECK \(num_nonnulls\("accountId", "contactId"\) = 1\)/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "ProductSoldEntitlement_exactly_one_beneficiary" CHECK \(num_nonnulls\("accountId", "contactId"\) = 1\)/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "ProductFulfillmentInstance_has_typed_target" CHECK \(num_nonnulls\("storefrontBookingId", "rentalAgreementId", "rentableUnitId", "edgeNodeId"\) >= 1\)/,
    );
  });

  it("prevents duplicate source-line materialization and marks allocation as non-additive", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductSoldEvidence_quoteLineItemId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductSoldEvidence_storefrontOrderLineItemId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductSoldEvidence_storefrontBookingId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductSoldEvidence_rentalAgreementId_key"',
    );
    expect(model("ProductSoldComponentAllocation")).toMatch(
      /\breportingTreatment\s+String\s+@default\("non-additive"\)/,
    );
  });

  it("classifies customer-bearing trace rows as confidential", () => {
    const expected = {
      ProductSold: "internal",
      ProductSoldComponentAllocation: "internal",
      StorefrontOrderLineItem: "confidential",
      ProductSoldEvidence: "confidential",
      ProductSoldParty: "confidential",
      ProductSoldEntitlement: "confidential",
      ProductFulfillmentInstance: "confidential",
    } as const;

    for (const [name, sensitivity] of Object.entries(expected)) {
      expect(tableClassification).toContain(`${name}: "${sensitivity}"`);
    }
  });
});
