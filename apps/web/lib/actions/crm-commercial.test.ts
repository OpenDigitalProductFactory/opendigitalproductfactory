import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    opportunity: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    customerAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
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
    lifecycleEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// acceptQuote is capability-guarded (BI-1017777D); these cases exercise the
// commercial lineage behind the guard, so sign in as a role holding
// operate_customer. Authorization itself is covered by
// crm-quote-authorization.test.ts.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u-revenue", platformRole: "HR-200", isSuperuser: false },
  })),
}));

vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromSalesOrder: vi.fn(),
}));

vi.mock(
  "@/lib/product-management/product-management-playbook-refresh",
  () => ({
    createProductManagementChangeCollector: vi.fn(() => ({
      collect: vi.fn(),
      flush: vi.fn(async () => undefined),
    })),
  }),
);

import { prisma } from "@dpf/db";
import { createQuote, acceptQuote } from "./crm";
import {
  updateCustomerAccount,
  archiveCustomerAccount,
  removeOpportunity,
  cancelSubscription,
} from "./crm-account-admin";

beforeEach(() => {
  vi.clearAllMocks();
  // Dedup gate candidate fetch: default to "no similar rows".
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  // Lifecycle ledger write (updateCustomerAccount records a status transition).
  vi.mocked(prisma.lifecycleEvent.create).mockResolvedValue({ id: "evt-1" } as never);
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

  // BI-0D1FF269: a quote must inherit its opportunity's currency (deal
  // consistency), not a hardcoded USD — so a GBP opportunity never yields a USD
  // quote by default.
  it("inherits the opportunity currency when the caller omits one", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opportunity-row",
      accountId: "account-row",
      currency: "GBP",
    } as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ nextval: 2n }] as never);

    const quoteCreate = vi.fn().mockResolvedValue({
      quoteId: "QUO-2",
      quoteNumber: "QUO-2026-0002",
      currency: "GBP",
      totalAmount: 100,
      accountId: "account-row",
      opportunityId: "opportunity-row",
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({ quote: { create: quoteCreate } } as never),
    );
    vi.mocked(prisma.activity.create).mockResolvedValue({} as never);

    await createQuote({
      opportunityId: "opportunity-row",
      validUntil: "2026-08-31", // clock-bomb-guard: allow not asserted against the wall clock
      lineItems: [{ description: "Consulting", quantity: 1, unitPrice: 100 }],
    });

    expect(quoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: "GBP" }),
      }),
    );
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

// BI-15AC1B33: account hygiene — edit / status change / archive / record removal.
describe("account hygiene actions", () => {
  it("updateCustomerAccount changes status and logs a status_change", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "acct-1",
      name: "Emma3D",
      status: "active",
      website: null,
    } as never);
    vi.mocked(prisma.customerAccount.update).mockResolvedValue({
      id: "acct-1",
      name: "Emma3D",
      status: "prospect",
    } as never);

    await updateCustomerAccount({ accountId: "acct-1", status: "prospect" });

    expect(prisma.customerAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acct-1" },
        data: expect.objectContaining({ status: "prospect" }),
      }),
    );
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "status_change", accountId: "acct-1" }),
      }),
    );
  });

  it("updateCustomerAccount rejects an invalid status", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "acct-1",
      name: "Emma3D",
      status: "active",
      website: null,
    } as never);

    await expect(
      updateCustomerAccount({ accountId: "acct-1", status: "not-a-status" }),
    ).rejects.toThrow(/Invalid account status/);
    expect(prisma.customerAccount.update).not.toHaveBeenCalled();
  });

  it("updateCustomerAccount refuses to edit a merged (superseded) account", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "acct-1",
      name: "Emma3D",
      status: "superseded",
      website: null,
    } as never);

    await expect(
      updateCustomerAccount({ accountId: "acct-1", name: "New name" }),
    ).rejects.toThrow(/merged account cannot be edited/);
  });

  it("archiveCustomerAccount sets status archived and audits", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "acct-1",
      name: "Emma3D",
      status: "active",
    } as never);
    vi.mocked(prisma.customerAccount.update).mockResolvedValue({
      id: "acct-1",
      status: "archived",
    } as never);

    await archiveCustomerAccount({ accountId: "acct-1" });

    expect(prisma.customerAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "archived" } }),
    );
  });

  it("removeOpportunity refuses when quotes reference it", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opp-1",
      title: "Fabricated deal",
      accountId: "acct-1",
      _count: { quotes: 2 },
    } as never);

    await expect(
      removeOpportunity({ opportunityId: "opp-1" }),
    ).rejects.toThrow(/has quotes/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("removeOpportunity deletes a quote-free opportunity inside a transaction", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opp-1",
      title: "Fabricated deal",
      accountId: "acct-1",
      _count: { quotes: 0 },
    } as never);
    const activityUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const opportunityDelete = vi.fn().mockResolvedValue({ id: "opp-1" });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: unknown) => unknown)({
        activity: { updateMany: activityUpdateMany },
        opportunity: { delete: opportunityDelete },
      }),
    );

    const res = await removeOpportunity({ opportunityId: "opp-1" });

    expect(activityUpdateMany).toHaveBeenCalled();
    expect(opportunityDelete).toHaveBeenCalledWith({ where: { id: "opp-1" } });
    expect(res).toEqual({ ok: true, accountId: "acct-1" });
  });

  it("cancelSubscription sets status cancelled", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      subscriptionRef: "SUB-1",
      accountId: "acct-1",
      status: "active",
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      id: "sub-1",
      status: "cancelled",
    } as never);

    await cancelSubscription({ subscriptionId: "sub-1" });

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled" } }),
    );
  });
});
