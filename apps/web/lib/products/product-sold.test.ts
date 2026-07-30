import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/new-id", () => ({ newId: vi.fn(() => "FIXED") }));

import {
  PRODUCT_FULFILLMENT_INSTANCE_KINDS,
  PRODUCT_SOLD_EVIDENCE_KINDS,
  PRODUCT_SOLD_PARTY_ROLES,
  PRODUCT_SOLD_STATUSES,
  appendProductSoldEvidence,
  createProductSoldDraft,
  createProductSoldEntitlement,
  createProductSoldPartyLinks,
  createProductSoldSnapshot,
  createTypedFulfillmentInstance,
  materializeProductSold,
  persistProductSoldPartyLinks,
  persistProductSoldEntitlement,
  persistProductFulfillmentInstance,
  summarizeProductSoldRevenue,
  transitionProductSold,
} from "./product-sold";
import {
  persistProductSoldComponentAllocations,
  transitionProductSoldByEvidence,
} from "./product-sold-commercial-persistence";

const commercialSelection = {
  organizationId: "org-one",
  providerOrganizationId: "org-one",
  product: {
    id: "product-row",
    productId: "PRODUCT-ONE",
    name: "Haircut",
    organizationId: "org-one",
  },
  offering: {
    id: "offering-row",
    offeringId: "OFFERING-ONE",
    name: "Standard haircut",
    organizationId: "org-one",
    providerOrganizationId: "org-one",
  },
  catalogItem: {
    id: "catalog-row",
    catalogItemId: "CATALOG-ONE",
    name: "Haircut appointment",
    organizationId: "org-one",
  },
  catalogSku: null,
  configuration: null,
  priceListEntryId: null,
  promotionId: null,
  quantity: 1,
  unitPrice: 45,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 45,
  currency: "USD",
  purchasedAt: new Date("2026-07-28T12:00:00.000Z"),
  configurationSnapshot: null,
  pricingSnapshot: {
    source: "catalog-base-price",
    amount: 45,
    currency: "USD",
  },
};

describe("Product Sold domain", () => {
  it("uses canonical typed lifecycle, evidence, party, and fulfillment registries", () => {
    expect(PRODUCT_SOLD_STATUSES).toEqual([
      "purchased",
      "active",
      "fulfilled",
      "cancelled",
      "refunded",
    ]);
    expect(PRODUCT_SOLD_EVIDENCE_KINDS).toEqual([
      "quote-line",
      "sales-order",
      "storefront-order-line",
      "storefront-booking",
      "rental-agreement",
      "support-subscription",
    ]);
    expect(PRODUCT_SOLD_PARTY_ROLES).toEqual([
      "account",
      "consumer",
      "subscriber",
    ]);
    expect(PRODUCT_FULFILLMENT_INSTANCE_KINDS).toEqual([
      "one-time-service",
      "booking",
      "physical-good",
      "rental",
      "supported-instance",
    ]);
  });

  it("defaults the simple-business provider from the real offering and snapshots the commercial chain", () => {
    const draft = createProductSoldDraft({
      selection: commercialSelection,
      evidence: {
        kind: "storefront-booking",
        sourceId: "booking-row",
        sourceRef: "BOOK-001",
        observedAt: new Date("2026-07-28T12:01:00.000Z"),
        snapshot: {
          customerEmail: "walk-in@example.com",
          customerName: "Walk-in customer",
        },
      },
    });

    expect(draft).toMatchObject({
      organizationId: "org-one",
      providerOrganizationId: "org-one",
      productId: "product-row",
      offeringId: "offering-row",
      catalogItemId: "catalog-row",
      catalogSkuId: null,
      configurationId: null,
      materializationKey: "storefront-booking:booking-row",
      status: "purchased",
      totalAmount: 45,
      evidence: {
        kind: "storefront-booking",
        sourceId: "booking-row",
      },
    });
    expect(draft.commercialSnapshot).toMatchObject({
      product: { productId: "PRODUCT-ONE", name: "Haircut" },
      offering: {
        offeringId: "OFFERING-ONE",
        name: "Standard haircut",
        providerOrganizationId: "org-one",
      },
      catalogItem: {
        catalogItemId: "CATALOG-ONE",
        name: "Haircut appointment",
      },
    });
  });

  it("rejects a cross-organization or mismatched offering provider before a write", () => {
    expect(() =>
      createProductSoldDraft({
        selection: {
          ...commercialSelection,
          offering: {
            ...commercialSelection.offering,
            organizationId: "other-org",
          },
        },
        evidence: {
          kind: "storefront-order-line",
          sourceId: "line-one",
          sourceRef: "ORDER-001:1",
          observedAt: new Date(),
          snapshot: {},
        },
      }),
    ).toThrow("Commercial selection crosses organization boundaries");

    expect(() =>
      createProductSoldDraft({
        selection: {
          ...commercialSelection,
          providerOrganizationId: "made-up-team",
        },
        evidence: {
          kind: "storefront-order-line",
          sourceId: "line-one",
          sourceRef: "ORDER-001:1",
          observedAt: new Date(),
          snapshot: {},
        },
      }),
    ).toThrow("Provider must come from the selected offering");
  });

  it("keeps email-only customer evidence honest and creates no placeholder party", () => {
    expect(
      createProductSoldPartyLinks({
        evidenceId: "evidence-row",
        observedAt: new Date("2026-07-28T12:01:00.000Z"),
        account: null,
        contact: null,
        subscriber: null,
        evidenceSnapshot: {
          customerEmail: "walk-in@example.com",
          customerName: "Walk-in customer",
        },
      }),
    ).toEqual([]);
  });

  it("creates only roles justified by canonical account/contact evidence", () => {
    expect(
      createProductSoldPartyLinks({
        evidenceId: "evidence-row",
        observedAt: new Date("2026-07-28T12:01:00.000Z"),
        account: { id: "account-row", accountId: "ACC-001", name: "Acme" },
        contact: {
          id: "contact-row",
          email: "buyer@acme.example",
          name: "Buyer",
        },
        subscriber: null,
        evidenceSnapshot: {},
      }),
    ).toEqual([
      expect.objectContaining({
        role: "account",
        accountId: "account-row",
        contactId: null,
      }),
      expect.objectContaining({
        role: "consumer",
        accountId: null,
        contactId: "contact-row",
      }),
    ]);
  });

  it("does not create an entitlement for an ordinary sale", () => {
    expect(
      createProductSoldEntitlement({
        evidenceId: "evidence-row",
        entitlement: null,
      }),
    ).toBeNull();
  });

  it("requires real evidence and one canonical beneficiary for an entitlement", () => {
    expect(() =>
      createProductSoldEntitlement({
        evidenceId: "evidence-row",
        entitlement: {
          kind: "event-access",
          accountId: null,
          contactId: null,
          subscriptionId: null,
          quantity: 2,
          rights: { admission: true },
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
          validTo: new Date("2026-08-02T00:00:00.000Z"),
        },
      }),
    ).toThrow("Entitlement requires one canonical beneficiary");

    expect(
      createProductSoldEntitlement({
        evidenceId: "evidence-row",
        entitlement: {
          kind: "event-access",
          accountId: null,
          contactId: "contact-row",
          subscriptionId: null,
          quantity: 2,
          rights: { admission: true },
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
          validTo: new Date("2026-08-02T00:00:00.000Z"),
        },
      }),
    ).toMatchObject({
      evidenceId: "evidence-row",
      entitlementKind: "event-access",
      accountId: null,
      contactId: "contact-row",
      subscriptionId: null,
    });
  });

  it("creates a fulfillment instance only from a real typed target", () => {
    expect(() =>
      createTypedFulfillmentInstance({
        evidenceId: "evidence-row",
        kind: "one-time-service",
        status: "fulfilled",
        targets: {
          storefrontBookingId: null,
          rentalAgreementId: null,
          rentableUnitId: null,
          edgeNodeId: null,
        },
        snapshot: {},
      }),
    ).toThrow("Fulfillment instance requires a typed target");

    expect(
      createTypedFulfillmentInstance({
        evidenceId: "evidence-row",
        kind: "one-time-service",
        status: "fulfilled",
        targets: {
          storefrontBookingId: "booking-row",
          rentalAgreementId: null,
          rentableUnitId: null,
          edgeNodeId: null,
        },
        snapshot: { completedByBooking: "BOOK-001" },
      }),
    ).toMatchObject({
      evidenceId: "evidence-row",
      instanceKind: "one-time-service",
      storefrontBookingId: "booking-row",
    });
  });

  it("preserves immutable commercial snapshots across lifecycle transitions", () => {
    const snapshot = createProductSoldSnapshot(commercialSelection);
    const fulfilled = transitionProductSold(
      {
        status: "purchased",
        commercialSnapshot: snapshot.commercialSnapshot,
        pricingSnapshot: snapshot.pricingSnapshot,
        cancelledAt: null,
        refundedAt: null,
      },
      {
        to: "fulfilled",
        occurredAt: new Date("2026-07-29T12:00:00.000Z"),
      },
    );

    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.commercialSnapshot).toBe(snapshot.commercialSnapshot);
    expect(fulfilled.pricingSnapshot).toBe(snapshot.pricingSnapshot);
    expect(Object.isFrozen(fulfilled.commercialSnapshot)).toBe(true);
  });

  it("counts each sale once and keeps package allocation non-additive", () => {
    expect(
      summarizeProductSoldRevenue([
        {
          productSoldId: "sale-one",
          totalAmount: 1000,
          componentAllocations: [
            { catalogItemId: "room", allocatedAmount: 600 },
            { catalogItemId: "event-space", allocatedAmount: 400 },
          ],
        },
        {
          productSoldId: "sale-one",
          totalAmount: 1000,
          componentAllocations: [
            { catalogItemId: "room", allocatedAmount: 600 },
            { catalogItemId: "event-space", allocatedAmount: 400 },
          ],
        },
      ]),
    ).toEqual({
      saleCount: 1,
      additiveRevenue: 1000,
      componentAllocations: [
        {
          catalogItemId: "event-space",
          allocatedAmount: 400,
          additive: false,
        },
        {
          catalogItemId: "room",
          allocatedAmount: 600,
          additive: false,
        },
      ],
    });
  });

  it("excludes cancelled and fully refunded sales from recognized performance", () => {
    expect(
      summarizeProductSoldRevenue([
        {
          productSoldId: "fulfilled",
          status: "fulfilled",
          totalAmount: 125,
          componentAllocations: [],
        },
        {
          productSoldId: "cancelled",
          status: "cancelled",
          totalAmount: 75,
          componentAllocations: [],
        },
        {
          productSoldId: "refunded",
          status: "refunded",
          totalAmount: 50,
          componentAllocations: [],
        },
      ]),
    ).toEqual({
      saleCount: 1,
      additiveRevenue: 125,
      componentAllocations: [],
    });
  });

  it("materializes the root and initial typed evidence atomically and idempotently", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({
        id: "sold-row",
        productSoldId: "PS-FIXED",
        evidence: [{ id: "evidence-row" }],
      });
    const draft = createProductSoldDraft({
      selection: commercialSelection,
      evidence: {
        kind: "storefront-booking",
        sourceId: "booking-row",
        sourceRef: "BOOK-001",
        observedAt: new Date("2026-07-28T12:01:00.000Z"),
        snapshot: { customerEmail: "walk-in@example.com" },
      },
    });

    await materializeProductSold({ db: { productSold: { upsert } }, draft });
    await materializeProductSold({ db: { productSold: { upsert } }, draft });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        materializationKey: "storefront-booking:booking-row",
      },
      create: expect.objectContaining({
        productSoldId: "PS-FIXED",
        materializationKey: "storefront-booking:booking-row",
        organizationId: "org-one",
        providerOrganizationId: "org-one",
        productId: "product-row",
        offeringId: "offering-row",
        catalogItemId: "catalog-row",
        evidence: {
          create: expect.objectContaining({
            evidenceId: "EVID-FIXED",
            evidenceKind: "storefront-booking",
            storefrontBookingId: "booking-row",
          }),
        },
      }),
      update: {},
      select: {
        id: true,
        productSoldId: true,
        evidence: {
          where: { storefrontBookingId: "booking-row" },
          select: { id: true },
          take: 1,
        },
      },
    });
  });

  it("appends SalesOrder evidence idempotently without creating another sale", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "sales-evidence-row" });

    await expect(
      appendProductSoldEvidence({
        db: { productSoldEvidence: { upsert } },
        organizationId: "org-one",
        productSoldId: "sold-row",
        kind: "sales-order",
        sourceId: "sales-order-row",
        sourceRef: "SO-2026-0001",
        observedAt: new Date("2026-07-28T12:02:00.000Z"),
        snapshot: { status: "confirmed" },
      }),
    ).resolves.toEqual({ id: "sales-evidence-row" });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        productSoldId_salesOrderId: {
          productSoldId: "sold-row",
          salesOrderId: "sales-order-row",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-one",
        productSoldId: "sold-row",
        evidenceKind: "sales-order",
        salesOrderId: "sales-order-row",
      }),
      update: expect.objectContaining({
        observedAt: new Date("2026-07-28T12:02:00.000Z"),
      }),
      select: { id: true },
    });
  });

  it("persists only canonical party links and remains a no-op for honest unknowns", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "party-row" });
    const db = { productSoldParty: { upsert } };

    await persistProductSoldPartyLinks({
      db,
      organizationId: "org-one",
      productSoldId: "sold-row",
      links: [],
    });
    expect(upsert).not.toHaveBeenCalled();

    const links = createProductSoldPartyLinks({
      evidenceId: "evidence-row",
      observedAt: new Date("2026-07-28T12:01:00.000Z"),
      account: { id: "account-row", accountId: "ACC-001", name: "Acme" },
      contact: null,
      subscriber: null,
      evidenceSnapshot: {},
    });
    await persistProductSoldPartyLinks({
      db,
      organizationId: "org-one",
      productSoldId: "sold-row",
      links,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        productSoldId_role_accountId: {
          productSoldId: "sold-row",
          role: "account",
          accountId: "account-row",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-one",
        productSoldId: "sold-row",
        evidenceId: "evidence-row",
        role: "account",
        accountId: "account-row",
        contactId: null,
      }),
      update: expect.objectContaining({
        evidenceId: "evidence-row",
      }),
      select: { id: true },
    });
  });

  it("persists entitlement and fulfillment records idempotently from their evidence keys", async () => {
    const entitlementUpsert = vi.fn().mockResolvedValue({ id: "entitlement-row" });
    const fulfillmentUpsert = vi.fn().mockResolvedValue({ id: "instance-row" });
    const entitlement = createProductSoldEntitlement({
      evidenceId: "evidence-row",
      entitlement: {
        kind: "event-access",
        accountId: "account-row",
        contactId: null,
        subscriptionId: null,
        quantity: 2,
        rights: { admission: true },
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        validTo: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    const fulfillment = createTypedFulfillmentInstance({
      evidenceId: "evidence-row",
      kind: "rental",
      status: "active",
      targets: {
        storefrontBookingId: null,
        rentalAgreementId: "agreement-row",
        rentableUnitId: "unit-row",
        edgeNodeId: null,
      },
      snapshot: { agreementRef: "RA-001" },
    });

    await persistProductSoldEntitlement({
      db: {
        productSoldEntitlement: { upsert: entitlementUpsert },
      },
      organizationId: "org-one",
      productSoldId: "sold-row",
      entitlement,
    });
    await persistProductFulfillmentInstance({
      db: {
        productFulfillmentInstance: { upsert: fulfillmentUpsert },
      },
      organizationId: "org-one",
      productSoldId: "sold-row",
      instance: fulfillment,
    });

    expect(entitlementUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entitlementKey: "evidence-row:event-access:account-row",
        },
        create: expect.objectContaining({
          productSoldId: "sold-row",
          evidenceId: "evidence-row",
          accountId: "account-row",
        }),
      }),
    );
    expect(fulfillmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          instanceKey:
            "evidence-row:rental:rentalAgreementId=agreement-row|rentableUnitId=unit-row",
        },
        create: expect.objectContaining({
          productSoldId: "sold-row",
          evidenceId: "evidence-row",
          rentalAgreementId: "agreement-row",
          rentableUnitId: "unit-row",
        }),
      }),
    );
  });
});

describe("package component allocation persistence", () => {
  it("persists component attribution as non-additive and idempotent", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "allocation-1" });

    await persistProductSoldComponentAllocations({
      db: { productSoldComponentAllocation: { upsert } },
      organizationId: "org-one",
      productSoldId: "sold-row",
      packageRevenue: 100,
      components: [
        {
          componentCatalogItemId: "component-1",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 60,
          componentSnapshot: { name: "Cut" },
        },
        {
          componentCatalogItemId: "component-2",
          quantity: 1,
          allocationMode: "percentage",
          allocationPercent: 40,
          componentSnapshot: { name: "Shampoo" },
        },
      ],
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          allocatedAmount: 60,
          reportingTreatment: "non-additive",
        }),
      }),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          allocatedAmount: 40,
          reportingTreatment: "non-additive",
        }),
      }),
    );
  });
});

describe("evidence-backed lifecycle persistence", () => {
  it("updates the sale and its real fulfillment without changing snapshots", async () => {
    const productSoldUpdate = vi.fn().mockResolvedValue({});
    const fulfillmentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      productSoldEvidence: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "evidence-row",
            productSold: {
              id: "sold-row",
              status: "purchased",
              commercialSnapshot: { product: "Haircut" },
              pricingSnapshot: { total: 45 },
              cancelledAt: null,
              refundedAt: null,
            },
          },
        ]),
      },
      productSold: { update: productSoldUpdate },
      productFulfillmentInstance: { updateMany: fulfillmentUpdateMany },
    };
    const occurredAt = new Date("2026-08-01T12:00:00.000Z");

    await transitionProductSoldByEvidence({
      db,
      kind: "storefront-booking",
      sourceId: "booking-row",
      to: "active",
      occurredAt,
    });

    expect(productSoldUpdate).toHaveBeenCalledWith({
      where: { id: "sold-row" },
      data: {
        status: "active",
        cancelledAt: null,
        refundedAt: null,
      },
    });
    expect(fulfillmentUpdateMany).toHaveBeenCalledWith({
      where: { evidenceId: "evidence-row" },
      data: {
        status: "active",
        completedAt: null,
        endedAt: null,
      },
    });
  });
});
