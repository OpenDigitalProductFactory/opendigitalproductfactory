import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { platformRole: "admin", isSuperuser: true },
  }),
}));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => {
  const prisma = {
    storefrontConfig: { findFirst: vi.fn() },
    storefrontItem: { findFirst: vi.fn() },
    rentalAgreement: { findMany: vi.fn(), create: vi.fn() },
    rentableUnit: { update: vi.fn() },
    productSold: { upsert: vi.fn() },
    productFulfillmentInstance: { upsert: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  return { prisma };
});

import { prisma } from "@dpf/db";
import { createReservation } from "./rental";

describe("rental Product Sold adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      id: "storefront-row",
      organizationId: "org-one",
    } as never);
    vi.mocked(prisma.rentalAgreement.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.rentalAgreement.create).mockResolvedValue({
      id: "agreement-row",
      agreementRef: "RA-001",
      status: "reserved",
    } as never);
    vi.mocked(prisma.rentableUnit.update).mockResolvedValue({} as never);
    vi.mocked(prisma.productSold.upsert).mockResolvedValue({
      id: "sold-row",
      productSoldId: "PS-001",
      evidence: [{ id: "evidence-row" }],
    } as never);
    vi.mocked(prisma.productFulfillmentInstance.upsert).mockResolvedValue({
      id: "instance-row",
    } as never);
  });

  it("materializes a deterministic fixed-rate rental and its real agreement/unit fulfillment", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue({
      id: "storefront-item-row",
      name: "Conference room",
      priceCurrency: "USD",
      catalogItem: {
        id: "catalog-row",
        catalogItemId: "CATALOG-ROOM",
        name: "Conference room",
        organizationId: "org-one",
        offering: {
          id: "offering-row",
          offeringId: "OFFERING-ROOM",
          name: "Conference room rental",
          organizationId: "org-one",
          providerOrganizationId: "org-one",
          product: {
            id: "product-row",
            productId: "PRODUCT-ROOM",
            name: "Conference rooms",
            organizationId: "org-one",
          },
        },
      },
      rentableUnits: [
        {
          id: "unit-row",
          catalogSku: {
            id: "sku-row",
            skuId: "SKU-ROOM-A",
            code: "ROOM-A",
            name: "Room A",
            configuration: null,
          },
        },
      ],
    } as never);

    const result = await createReservation({
      storefrontItemId: "storefront-item-row",
      rentableUnitId: "unit-row",
      customerEmail: "organizer@example.com",
      customerName: "Event organizer",
      periodStart: "2026-08-01T09:00:00.000Z",
      periodEnd: "2026-08-01T17:00:00.000Z",
      pricingModel: "fixed",
      rateAmount: 500,
    });

    expect(result.ok).toBe(true);
    expect(prisma.productSold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materializationKey: "rental-agreement:agreement-row" },
        create: expect.objectContaining({
          organizationId: "org-one",
          catalogItemId: "catalog-row",
          catalogSkuId: "sku-row",
          totalAmount: 500,
          evidence: {
            create: expect.objectContaining({
              evidenceKind: "rental-agreement",
              rentalAgreementId: "agreement-row",
            }),
          },
        }),
      }),
    );
    expect(prisma.productFulfillmentInstance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          instanceKind: "rental",
          rentalAgreementId: "agreement-row",
          rentableUnitId: "unit-row",
        }),
      }),
    );
  });

  it("keeps usage-based reservations unmaterialized until a real charge exists", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue({
      id: "storefront-item-row",
      name: "Equipment",
      priceCurrency: "USD",
      catalogItem: {
        id: "catalog-row",
        organizationId: "org-one",
      },
      rentableUnits: [],
    } as never);

    const result = await createReservation({
      storefrontItemId: "storefront-item-row",
      customerEmail: "renter@example.com",
      customerName: "Renter",
      periodStart: "2026-08-01T09:00:00.000Z",
      periodEnd: "2026-08-02T09:00:00.000Z",
      pricingModel: "usage-based",
      rateAmount: 2,
    });

    expect(result.ok).toBe(true);
    expect(prisma.productSold.upsert).not.toHaveBeenCalled();
  });
});
