import { prisma } from "@dpf/db";
import { generateInvoiceFromSalesOrder } from "@/lib/actions/finance";
import {
  appendProductSoldEvidence,
  createProductSoldDraft,
  createProductSoldPartyLinks,
  materializeProductSold,
  persistProductSoldPartyLinks,
} from "@/lib/products/product-sold";
import {
  persistProductSoldComponentAllocations,
  snapshotProductSoldComponents,
} from "@/lib/products/product-sold-commercial-persistence";
import { createProductManagementChangeCollector } from "@/lib/product-management/product-management-playbook-refresh";

 type LogSystemActivity = (
  subject: string,
  opts?: { type?: string; body?: string; accountId?: string; contactId?: string; opportunityId?: string },
) => Promise<unknown>;
async function nextSalesOrderRef(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('sales_order_number_seq')`,
  );
  const seq = Number(result[0]!.nextval);
  return `SO-${year}-${String(seq).padStart(4, "0")}`;
}
export async function acceptQuoteImpl(
  quoteId: string,
  userId: string | undefined,
  logSystemActivity: LogSystemActivity,
) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { opportunity: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.status === "accepted") throw new Error("Quote already accepted");

  const orderRef = await nextSalesOrderRef();

  const productManagementChanges = createProductManagementChangeCollector();
  const result = await prisma.$transaction(async (tx) => {
    // Accept quote
    const accepted = await tx.quote.update({
      where: { id: quoteId },
      data: { status: "accepted", acceptedAt: new Date() },
      include: {
        lineItems: {
          orderBy: { sortOrder: "asc" },
          include: {
            catalogItem: {
              include: {
                offering: { include: { product: true } },
                bundleComponents: {
                  where: { effectiveTo: null },
                  orderBy: { sortOrder: "asc" },
                  include: { componentCatalogItem: true },
                },
              },
            },
            catalogSku: { include: { configuration: true } },
          },
        },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    // Create sales order
    const order = await tx.salesOrder.create({
      data: {
        orderRef,
        status: "confirmed",
        quoteId: accepted.id,
        accountId: accepted.accountId,
        totalAmount: accepted.totalAmount,
        currency: accepted.currency,
      },
    });

    const observedAt = new Date();
    for (const line of accepted.lineItems) {
      const catalogItem = line.catalogItem;
      if (!catalogItem) continue;
      const unitPrice = line.unitPrice.toNumber();
      const discountPercent = line.discountPercent.toNumber();
      const taxPercent = line.taxPercent.toNumber();
      const totalAmount = line.lineTotal.toNumber();
      const configuration = line.catalogSku?.configuration ?? null;
      const pricingSnapshot = {
        version: 1,
        source: "accepted-quote-line",
        quoteNumber: accepted.quoteNumber,
        unitPrice,
        quantity: line.quantity,
        discountPercent,
        taxPercent,
        totalAmount,
        currency: accepted.currency,
      };
      const draft = createProductSoldDraft({
        selection: {
          organizationId: catalogItem.organizationId,
          providerOrganizationId:
            catalogItem.offering.providerOrganizationId,
          product: catalogItem.offering.product,
          offering: catalogItem.offering,
          catalogItem,
          catalogSku: line.catalogSku,
          configuration,
          priceListEntryId: null,
          promotionId: null,
          quantity: line.quantity,
          unitPrice,
          discountAmount:
            unitPrice * line.quantity * (discountPercent / 100),
          taxAmount: totalAmount * (taxPercent / 100),
          totalAmount,
          currency: accepted.currency,
          purchasedAt: observedAt,
          configurationSnapshot: line.configurationSnapshot,
          pricingSnapshot,
        },
        evidence: {
          kind: "quote-line",
          sourceId: line.id,
          sourceRef: `${accepted.quoteNumber}:${line.sortOrder + 1}`,
          observedAt,
          snapshot: {
            quoteId: accepted.id,
            quoteNumber: accepted.quoteNumber,
            description: line.description,
            configurationSnapshot: line.configurationSnapshot,
          },
        },
      });
      const materialized = await materializeProductSold({
        db: tx as never,
        draft,
        collectChange: productManagementChanges.collect,
      });
      await persistProductSoldComponentAllocations({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        packageRevenue: totalAmount,
        components: snapshotProductSoldComponents(
          catalogItem.bundleComponents ?? [],
        ),
      });
      await appendProductSoldEvidence({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        kind: "sales-order",
        sourceId: order.id,
        sourceRef: order.orderRef,
        observedAt,
        snapshot: {
          orderRef: order.orderRef,
          status: order.status,
          accountId: accepted.accountId,
        },
      });
      const parties = createProductSoldPartyLinks({
        evidenceId: materialized.evidenceId,
        observedAt,
        account: accepted.account,
        contact: null,
        subscriber: null,
        evidenceSnapshot: {},
      });
      await persistProductSoldPartyLinks({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        links: parties,
      });
    }

    // Close opportunity as won
    await tx.opportunity.update({
      where: { id: accepted.opportunityId },
      data: {
        stage: "closed_won",
        probability: 100,
        actualClose: new Date(),
        stageChangedAt: new Date(),
        isDormant: false,
      },
    });

    return { quote: accepted, salesOrder: order };
  });
  await productManagementChanges.flush();

  await logSystemActivity(
    `Quote ${result.quote.quoteNumber} accepted → Sales Order ${result.salesOrder.orderRef} created`,
    {
      type: "quote_event",
      accountId: result.quote.accountId,
      opportunityId: result.quote.opportunityId,
    },
  );

  await logSystemActivity("Opportunity closed WON (quote accepted)", {
    type: "status_change",
    accountId: result.quote.accountId,
    opportunityId: result.quote.opportunityId,
  });

  // Auto-generate invoice from sales order
  try {
    await generateInvoiceFromSalesOrder(result.salesOrder.id);
  } catch (err) {
    console.error("Auto-invoice generation failed for SalesOrder", result.salesOrder.orderRef, err);
  }

  return result;
}
