import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    opportunity: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    quote: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    salesOrder: {
      create: vi.fn(),
    },
    productSold: {
      upsert: vi.fn(),
    },
    productSoldEvidence: {
      upsert: vi.fn(),
    },
    productSoldParty: {
      upsert: vi.fn(),
    },
    catalogSku: {
      findMany: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromSalesOrder: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { acceptQuote, createQuote } from "./crm";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
});

describe("createQuote commercial lineage", () => {
  it("persists an exact catalog item and immutable one-off configuration snapshot", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opportunity-row",
      accountId: "account-row",
    } as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { nextval: 1n },
    ] as never);
    vi.mocked(prisma.catalogSku.findMany).mockResolvedValue([
      { id: "sku-row", catalogItemId: "catalog-row" },
    ] as never);

    const quoteCreate = vi.fn().mockResolvedValue({
      quoteId: "QUO-1",
      quoteNumber: "QUO-2026-0001",
      currency: "USD",
      totalAmount: 125,
      accountId: "account-row",
      opportunityId: "opportunity-row",
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({ quote: { create: quoteCreate } } as never),
    );
    vi.mocked(prisma.activity.create).mockResolvedValue({} as never);

    const snapshot = {
      capturedAt: "2026-07-28T12:00:00.000Z",
      selections: { room: "ballroom", layout: "banquet" },
    };
    await createQuote({
      opportunityId: "opportunity-row",
      validUntil: "2026-08-31",
      lineItems: [{
        catalogItemId: "catalog-row",
        catalogSkuId: "sku-row",
        configurationSnapshot: snapshot,
        description: "Private event",
        quantity: 1,
        unitPrice: 125,
      }],
    });

    expect(prisma.catalogSku.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["sku-row"] },
        status: "active",
        effectiveFrom: { lte: expect.any(Date) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: expect.any(Date) } },
        ],
      },
      select: { id: true, catalogItemId: true },
    });
    expect(quoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lineItems: {
            create: [
              expect.objectContaining({
                productId: null,
                catalogItemId: "catalog-row",
                catalogSkuId: "sku-row",
                configurationSnapshot: snapshot,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("rejects an exact SKU that does not belong to the selected catalog item", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opportunity-row",
      accountId: "account-row",
    } as never);
    vi.mocked(prisma.catalogSku.findMany).mockResolvedValue([
      { id: "sku-row", catalogItemId: "different-catalog-row" },
    ] as never);

    await expect(
      createQuote({
        opportunityId: "opportunity-row",
        validUntil: "2026-08-31",
        lineItems: [{
          catalogItemId: "catalog-row",
          catalogSkuId: "sku-row",
          description: "Configured item",
          quantity: 1,
          unitPrice: 125,
        }],
      }),
    ).rejects.toThrow(
      "Every selected SKU must belong to its quote-line catalog item",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("acceptQuote Product Sold traceability", () => {
  it("materializes each catalog-linked quote line, appends SalesOrder evidence, and links only the real account", async () => {
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: "quote-row",
      status: "sent",
    } as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { nextval: 1n },
    ] as never);
    vi.mocked(prisma.quote.update).mockResolvedValue({
      id: "quote-row",
      quoteNumber: "QUO-2026-0001",
      accountId: "account-row",
      opportunityId: "opportunity-row",
      totalAmount: 200,
      currency: "USD",
      account: {
        id: "account-row",
        accountId: "ACC-001",
        name: "Acme",
      },
      lineItems: [
        {
          id: "quote-line-row",
          description: "Private event",
          quantity: 1,
          unitPrice: { toNumber: () => 200 },
          discountPercent: { toNumber: () => 0 },
          taxPercent: { toNumber: () => 0 },
          lineTotal: { toNumber: () => 200 },
          configurationSnapshot: {
            version: 1,
            configuration: { kind: "one-off", values: { layout: "banquet" } },
          },
          catalogSku: null,
          catalogItem: {
            id: "catalog-row",
            catalogItemId: "CATALOG-EVENT",
            name: "Private event",
            organizationId: "org-one",
            offering: {
              id: "offering-row",
              offeringId: "OFFERING-EVENT",
              name: "Hosted private event",
              organizationId: "org-one",
              providerOrganizationId: "org-one",
              product: {
                id: "product-row",
                productId: "PRODUCT-EVENT",
                name: "Private events",
                organizationId: "org-one",
              },
            },
          },
        },
      ],
    } as never);
    vi.mocked(prisma.salesOrder.create).mockResolvedValue({
      id: "sales-order-row",
      orderRef: "SO-2026-0001",
      status: "confirmed",
    } as never);
    vi.mocked(prisma.opportunity.update).mockResolvedValue({} as never);
    vi.mocked(prisma.productSold.upsert).mockResolvedValue({
      id: "sold-row",
      productSoldId: "PS-ONE",
      evidence: [{ id: "quote-evidence-row" }],
    } as never);
    vi.mocked(prisma.productSoldEvidence.upsert).mockResolvedValue({
      id: "sales-evidence-row",
    } as never);
    vi.mocked(prisma.productSoldParty.upsert).mockResolvedValue({
      id: "party-row",
    } as never);
    vi.mocked(prisma.activity.create).mockResolvedValue({} as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(prisma as never),
    );

    await acceptQuote("quote-row");

    expect(prisma.productSold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materializationKey: "quote-line:quote-line-row" },
        create: expect.objectContaining({
          organizationId: "org-one",
          providerOrganizationId: "org-one",
          catalogItemId: "catalog-row",
          configurationSnapshot: expect.objectContaining({
            configuration: expect.objectContaining({ kind: "one-off" }),
          }),
          evidence: {
            create: expect.objectContaining({
              evidenceKind: "quote-line",
              quoteLineItemId: "quote-line-row",
            }),
          },
        }),
      }),
    );
    expect(prisma.productSoldEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productSoldId_salesOrderId: {
            productSoldId: "sold-row",
            salesOrderId: "sales-order-row",
          },
        },
      }),
    );
    expect(prisma.productSoldParty.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          role: "account",
          accountId: "account-row",
          contactId: null,
        }),
      }),
    );
  });
});
