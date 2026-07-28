import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductSoldTracePanel } from "./ProductSoldTracePanel";

describe("ProductSoldTracePanel", () => {
  it("keeps the empty simple-business state free of enterprise jargon", () => {
    const html = renderToStaticMarkup(
      <ProductSoldTracePanel
        itemName="Haircut"
        trace={{
          saleCount: 0,
          additiveRevenue: 0,
          currency: null,
          records: [],
        }}
      />,
    );

    expect(html).toContain("Customer purchases and use");
    expect(html).toContain(
      "Purchases will appear after a catalog-linked order or booking",
    );
    expect(html).not.toContain("entitlement");
    expect(html).not.toContain("install base");
    expect(html).not.toContain("subscriber");
  });

  it("shows evidence-only customer data honestly and discloses trace detail contextually", () => {
    const html = renderToStaticMarkup(
      <ProductSoldTracePanel
        itemName="Conference package"
        trace={{
          saleCount: 1,
          additiveRevenue: 1000,
          currency: "USD",
          records: [
            {
              id: "sold-row",
              productSoldId: "PS-001",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 1000,
              currency: "USD",
              purchasedAt: new Date("2026-07-28T12:00:00.000Z"),
              commercial: {
                providerOrganizationId: "org-one",
                product: {
                  productId: "PRODUCT-EVENT",
                  name: "Private events",
                },
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
              pricingSnapshot: {},
              customer: {
                label: "Walk-in customer",
                email: "walk-in@example.com",
                canonicalLinkEstablished: false,
                roles: [],
              },
              evidence: [
                {
                  evidenceId: "EVID-001",
                  kind: "storefront-booking",
                  observedAt: new Date("2026-07-28T12:01:00.000Z"),
                  sourceRef: "BOOK-001",
                },
              ],
              entitlements: [],
              fulfillmentInstances: [
                {
                  instanceId: "INSTANCE-001",
                  instanceKind: "one-time-service",
                  status: "fulfilled",
                  fulfillmentSnapshot: {},
                },
              ],
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
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Walk-in customer");
    expect(html).toContain("Customer/account link not established");
    expect(html).not.toContain("Consumer created");
    expect(html).toContain("More traceability");
    expect(html).toContain("Hosted private event");
    expect(html).toContain("Included items");
    expect(html).toContain("allocation, not additional revenue");
  });
});
