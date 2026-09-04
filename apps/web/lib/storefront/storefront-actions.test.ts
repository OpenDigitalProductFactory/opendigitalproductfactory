import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shared/new-id", () => ({ newId: vi.fn(() => "TESTREF") }));
vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromStorefrontOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@dpf/db", () => {
  const prisma = {
    businessProfile: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    storefrontInquiry: { create: vi.fn() },
    storefrontBooking: { create: vi.fn() },
    hospitalityResource: { findFirst: vi.fn() },
    hospitalityCapacityPool: { findFirst: vi.fn() },
    hospitalityCapacityAllocation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    storefrontOrder: { create: vi.fn() },
    storefrontOrderLineItem: { create: vi.fn() },
    storefrontItem: { findMany: vi.fn(), findFirst: vi.fn() },
    productSold: { upsert: vi.fn() },
    productFulfillmentInstance: { upsert: vi.fn() },
    storefrontDonation: { create: vi.fn() },
    orgSettings: { findFirst: vi.fn() },
    bookingHold: { findFirst: vi.fn(), delete: vi.fn() },
    $queryRaw: vi.fn(),
    // Interactive-transaction shim: run the callback against the same mock so
    // per-model create/findFirst/delete assertions still observe the calls.
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? await (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[])
    ),
  };
  return {
    prisma,
    Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
  };
});

import {
  submitInquiry,
  submitDonation,
  submitBooking,
  submitOrder,
} from "./storefront-actions";
import { prisma } from "@dpf/db";

const mockPublishedStorefront = { id: "sf-1", organizationId: "org-1" };

describe("submitInquiry", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when storefront is not published", async () => {
    // WHERE { isPublished: true } returns null when unpublished — simulate that here
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);
    const result = await submitInquiry("acme-vet", {
      customerEmail: "a@b.com",
      customerName: "Alice",
      message: "Hello",
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/not found/i);
  });

  it("creates inquiry and returns ref when storefront is published", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never
    );
    vi.mocked(prisma.storefrontInquiry.create).mockResolvedValue({
      inquiryRef: "INQ-TESTREF",
    } as never);

    const result = await submitInquiry("acme-vet", {
      customerEmail: "a@b.com",
      customerName: "Alice",
      message: "Hello",
    });
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: { ref: string; type: string } }).data.ref).toBe("INQ-TESTREF");
    expect((result as { ok: true; data: { ref: string; type: string } }).data.type).toBe("inquiry");
  });
});

describe("submitDonation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when storefront not found", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);
    const result = await submitDonation("missing-slug", {
      donorEmail: "d@e.com",
      amount: 10,
    });
    expect(result.ok).toBe(false);
  });

  function acceptDonations(baseCurrency: string | null) {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never,
    );
    vi.mocked(prisma.orgSettings.findFirst).mockResolvedValue(
      baseCurrency == null ? (null as never) : ({ baseCurrency } as never),
    );
    vi.mocked(prisma.storefrontDonation.create).mockResolvedValue({
      donationRef: "DON-TESTREF",
    } as never);
  }

  function storedCurrency(): string {
    const call = vi.mocked(prisma.storefrontDonation.create).mock.calls[0]?.[0] as {
      data: { currency: string };
    };
    return call.data.currency;
  }

  // `DonationForm` sends no currency, and this defaulted to a hardcoded "GBP",
  // so a USD rescue showed the donor `$50` and wrote GBP to its books
  // (BI-685ADDCD). Every gift on every non-GBP install was affected.
  it("records the gift in the workspace's own currency", async () => {
    acceptDonations("USD");
    await submitDonation("acme-vet", { donorEmail: "d@e.com", amount: 50 });
    expect(storedCurrency()).toBe("USD");
  });

  it("falls back to USD when the workspace has no settings row", async () => {
    acceptDonations(null);
    await submitDonation("acme-vet", { donorEmail: "d@e.com", amount: 50 });
    expect(storedCurrency()).toBe("USD");
  });

  it("honours an explicit currency, so a later multi-currency flow still works", async () => {
    acceptDonations("USD");
    await submitDonation("acme-vet", {
      donorEmail: "d@e.com",
      amount: 50,
      currency: "EUR",
    });
    expect(storedCurrency()).toBe("EUR");
  });
});

describe("submitOrder Product Sold traceability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never,
    );
    vi.mocked(prisma.storefrontOrder.create).mockResolvedValue({
      id: "order-row",
      orderRef: "ORD-TESTREF",
    } as never);
    vi.mocked(prisma.storefrontOrderLineItem.create).mockResolvedValue({
      id: "order-line-row",
    } as never);
    vi.mocked(prisma.productSold.upsert).mockResolvedValue({
      id: "sold-row",
      productSoldId: "PS-TESTREF",
      evidence: [{ id: "evidence-row" }],
    } as never);
    vi.mocked(prisma.productFulfillmentInstance.upsert).mockResolvedValue({
      id: "instance-row",
    } as never);
  });

  it("atomically writes a normalized line and Product Sold for a catalog-linked purchase", async () => {
    vi.mocked(prisma.storefrontItem.findMany).mockResolvedValue([
      {
        itemId: "item-one",
        name: "Haircut",
        priceAmount: { toNumber: () => 45 },
        catalogItem: {
          id: "catalog-row",
          catalogItemId: "CATALOG-ONE",
          name: "Haircut appointment",
          organizationId: "org-1",
          offering: {
            id: "offering-row",
            offeringId: "OFFERING-ONE",
            name: "Standard haircut",
            organizationId: "org-1",
            providerOrganizationId: "org-1",
            product: {
              id: "product-row",
              productId: "PRODUCT-ONE",
              name: "Haircut",
              organizationId: "org-1",
            },
          },
        },
      },
    ] as never);

    const result = await submitOrder("salon", {
      customerEmail: "walk-in@example.com",
      customerName: "Walk-in customer",
      items: [{ itemId: "item-one", name: "Haircut", qty: 1, unitPrice: 45 }],
      totalAmount: 45,
      currency: "USD",
    });

    expect(result).toEqual({
      ok: true,
      data: { ref: "ORD-TESTREF", type: "order" },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.storefrontOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          storefrontId: "sf-1",
        }),
      }),
    );
    expect(prisma.storefrontOrderLineItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storefrontOrderId: "order-row",
        catalogItemId: "catalog-row",
        quantity: 1,
        unitPrice: 45,
        totalAmount: 45,
        sourcePosition: 0,
      }),
      select: { id: true },
    });
    expect(prisma.productSold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          materializationKey: "storefront-order-line:order-line-row",
        },
        create: expect.objectContaining({
          organizationId: "org-1",
          providerOrganizationId: "org-1",
          productId: "product-row",
          offeringId: "offering-row",
          catalogItemId: "catalog-row",
          evidence: {
            create: expect.objectContaining({
              storefrontOrderLineItemId: "order-line-row",
              evidenceKind: "storefront-order-line",
            }),
          },
        }),
      }),
    );
  });

  it("keeps an unlinked legacy item purchasable without fabricating a trace", async () => {
    vi.mocked(prisma.storefrontItem.findMany).mockResolvedValue([
      {
        itemId: "legacy-item",
        name: "Legacy item",
        priceAmount: { toNumber: () => 20 },
        catalogItem: null,
      },
    ] as never);

    const result = await submitOrder("shop", {
      customerEmail: "buyer@example.com",
      items: [
        {
          itemId: "legacy-item",
          name: "Legacy item",
          qty: 1,
          unitPrice: 20,
        },
      ],
      totalAmount: 20,
    });

    expect(result.ok).toBe(true);
    expect(prisma.storefrontOrderLineItem.create).not.toHaveBeenCalled();
    expect(prisma.productSold.upsert).not.toHaveBeenCalled();
  });
});

describe("submitBooking (enhanced)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("materializes a catalog-linked booking without inventing a consumer", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never,
    );
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue({
      id: "storefront-item-row",
      itemId: "item-one",
      name: "Haircut",
      priceAmount: { toNumber: () => 45 },
      priceCurrency: "USD",
      catalogItem: {
        id: "catalog-row",
        catalogItemId: "CATALOG-ONE",
        name: "Haircut appointment",
        organizationId: "org-1",
        offering: {
          id: "offering-row",
          offeringId: "OFFERING-ONE",
          name: "Standard haircut",
          organizationId: "org-1",
          providerOrganizationId: "org-1",
          product: {
            id: "product-row",
            productId: "PRODUCT-ONE",
            name: "Haircut",
            organizationId: "org-1",
          },
        },
      },
    } as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({
      id: "booking-row",
      bookingRef: "BK-TESTREF",
    } as never);
    vi.mocked(prisma.productSold.upsert).mockResolvedValue({
      id: "sold-row",
      productSoldId: "PS-TESTREF",
      evidence: [{ id: "evidence-row" }],
    } as never);

    await submitBooking("salon", {
      itemId: "item-one",
      customerEmail: "walk-in@example.com",
      customerName: "Walk-in customer",
      scheduledAt: new Date("2026-07-29T09:00:00Z"),
      durationMinutes: 45,
    });

    expect(prisma.productSold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materializationKey: "storefront-booking:booking-row" },
        create: expect.objectContaining({
          organizationId: "org-1",
          providerOrganizationId: "org-1",
          totalAmount: 45,
          evidence: {
            create: expect.objectContaining({
              evidenceKind: "storefront-booking",
              storefrontBookingId: "booking-row",
              evidenceSnapshot: expect.objectContaining({
                customerEmail: "walk-in@example.com",
              }),
            }),
          },
        }),
      }),
    );
    expect(
      vi.mocked(prisma.productSold.upsert).mock.calls[0]?.[0],
    ).not.toHaveProperty("create.parties");
    expect(prisma.productFulfillmentInstance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          evidenceId: "evidence-row",
          instanceKind: "booking",
          storefrontBookingId: "booking-row",
          rentalAgreementId: null,
          rentableUnitId: null,
          edgeNodeId: null,
        }),
      }),
    );
  });

  it("validates hold token before creating booking", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue({
      id: "hold-1", holderToken: "tok-abc", providerId: "prov-1",
      slotStart: new Date("2026-03-23T09:00:00Z"), slotEnd: new Date("2026-03-23T09:45:00Z"),
      expiresAt: new Date(Date.now() + 600_000),
    } as never);
    vi.mocked(prisma.bookingHold.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({ id: "bk-1", bookingRef: "BK-TESTREF" } as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "tok-abc",
    });
    expect(result.ok).toBe(true);
    expect(prisma.bookingHold.delete).toHaveBeenCalledWith({ where: { id: "hold-1" } });
  });

  it("rejects booking when hold token is invalid", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue(null as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "invalid-token",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid|expired/i);
  });

  it("rejects duplicate submission via idempotency key", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue({
      id: "hold-2", holderToken: "tok-def", expiresAt: new Date(Date.now() + 600_000),
    } as never);
    vi.mocked(prisma.bookingHold.delete).mockResolvedValue({} as never);
    const prismaError = new Error("Unique constraint") as Error & { code: string };
    prismaError.code = "P2002";
    vi.mocked(prisma.storefrontBooking.create).mockRejectedValue(prismaError);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "tok-def", idempotencyKey: "dup-key",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate/i);
  });

  it("runs booking creation inside a transaction", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({ id: "bk-1", bookingRef: "BK-TESTREF" } as never);

    await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("writes the structured hospitality resource and allocation in the booking transaction", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      timezone: "America/Chicago",
    } as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never,
    );
    vi.mocked(prisma.hospitalityResource.findFirst).mockResolvedValue({
      id: "table-1",
      legacyServiceProviderId: "prov-1",
      status: "active",
      capacity: 6,
      availability: [],
      storefront: { timezone: "UTC" },
    } as never);
    vi.mocked(
      prisma.hospitalityCapacityAllocation.findFirst,
    ).mockResolvedValue(null as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({
      id: "bk-1",
      bookingRef: "BK-TESTREF",
    } as never);
    vi.mocked(
      prisma.hospitalityCapacityAllocation.create,
    ).mockResolvedValue({ id: "allocation-1" } as never);

    const result = await submitBooking("restaurant", {
      itemId: "itm-1",
      customerEmail: "a@b.com",
      customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"),
      durationMinutes: 45,
      providerId: "prov-1",
      covers: 4,
    });

    expect(result.ok).toBe(true);
    expect(prisma.businessProfile.findFirst).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { timezone: true },
    });
    expect(prisma.storefrontBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: "prov-1",
          hospitalityResourceId: "table-1",
        }),
      }),
    );
    expect(
      prisma.hospitalityCapacityAllocation.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: "table-1",
        bookingId: "bk-1",
        demandType: "booking",
        demandRef: "BK-TESTREF",
        quantity: 4,
      }),
    });
  });

  it("refuses a Restaurant booking when the selected provider has no table resource", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockPublishedStorefront,
      archetype: { archetypeId: "restaurant" },
    } as never);
    vi.mocked(prisma.hospitalityResource.findFirst).mockResolvedValue(null as never);

    const result = await submitBooking("restaurant", {
      itemId: "itm-1",
      customerEmail: "a@b.com",
      customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"),
      durationMinutes: 45,
      providerId: "generic-provider",
      covers: 4,
    });

    expect(result).toEqual({
      ok: false,
      error: "That table is not available for reservations. Please choose another time.",
    });
    expect(prisma.storefrontBooking.create).not.toHaveBeenCalled();
  });

  it("refuses a Restaurant booking when no table provider is selected", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockPublishedStorefront,
      archetype: { archetypeId: "restaurant" },
    } as never);

    const result = await submitBooking("restaurant", {
      itemId: "itm-1",
      customerEmail: "a@b.com",
      customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"),
      durationMinutes: 45,
      covers: 4,
    });

    expect(result).toEqual({
      ok: false,
      error: "That table is not available for reservations. Please choose another time.",
    });
    expect(prisma.storefrontBooking.create).not.toHaveBeenCalled();
  });

  it("returns a customer-safe error when party size exceeds table capacity", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockPublishedStorefront,
      archetype: { archetypeId: "restaurant" },
    } as never);
    vi.mocked(prisma.hospitalityResource.findFirst)
      .mockResolvedValueOnce({
        id: "table-1",
        legacyServiceProviderId: "prov-1",
        status: "active",
      } as never)
      .mockResolvedValueOnce({
        id: "table-1",
        legacyServiceProviderId: "prov-1",
        status: "active",
        capacity: 4,
        availability: [],
        storefront: { timezone: "UTC" },
      } as never);
    vi.mocked(prisma.hospitalityCapacityAllocation.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({
      id: "bk-1",
      bookingRef: "BK-TESTREF",
    } as never);

    const result = await submitBooking("restaurant", {
      itemId: "itm-1",
      customerEmail: "a@b.com",
      customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"),
      durationMinutes: 45,
      providerId: "prov-1",
      covers: 10,
    });

    expect(result).toEqual({
      ok: false,
      error: "That table cannot seat this party. Please choose a smaller party or contact the venue.",
    });
  });

  it("rejects an overlapping slot on an exclusion-constraint violation (23P01)", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    // Simulate Postgres 23P01 surfaced through Prisma on the create.
    const exclusionError = new Error(
      'conflicting key value violates exclusion constraint "StorefrontBooking_no_overlap"'
    ) as Error & { meta?: { code: string } };
    exclusionError.meta = { code: "23P01" };
    vi.mocked(prisma.storefrontBooking.create).mockRejectedValue(exclusionError);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      providerId: "prov-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer available/i);
  });
});

describe("submitBooking (recurring)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates child bookings for weekly recurrence", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(mockPublishedStorefront as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({ id: "bk-parent", bookingRef: "BK-TESTREF" } as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      recurrenceRule: "weekly" as const,
      recurrenceEndDate: new Date("2026-04-13T00:00:00Z"), // ~3 weeks out
    });
    expect(result.ok).toBe(true);
    // Parent + 3 children = 4 total create calls
    expect(prisma.storefrontBooking.create).toHaveBeenCalledTimes(4);
  });
});
