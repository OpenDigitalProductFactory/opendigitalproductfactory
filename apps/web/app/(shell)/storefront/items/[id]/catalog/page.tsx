import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

import {
  CatalogBuilderPanel,
  type CatalogBuilderView,
} from "@/components/storefront-admin/CatalogBuilderPanel";
import {
  currentEffectiveWindowFilter,
  deriveCatalogFulfillmentRoute,
} from "@/lib/products/catalog-builder";

export default async function CatalogBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asOf = new Date();
  const storefrontItem = await prisma.storefrontItem.findUnique({
    where: { id },
    include: {
      catalogItem: {
        include: {
          bundleComponents: {
            where: currentEffectiveWindowFilter(asOf),
            orderBy: { sortOrder: "asc" },
            include: {
              componentCatalogItem: {
                select: { id: true, catalogItemId: true, name: true },
              },
            },
          },
          priceListEntries: {
            orderBy: { effectiveFrom: "desc" },
            include: {
              priceList: {
                select: {
                  id: true,
                  name: true,
                  currency: true,
                  status: true,
                  effectiveFrom: true,
                  effectiveTo: true,
                },
              },
              catalogSku: { select: { code: true } },
            },
          },
          promotionItems: {
            include: {
              promotion: true,
              priceList: { select: { name: true } },
            },
          },
          configurations: {
            where: {
              status: "active",
              ...currentEffectiveWindowFilter(asOf),
            },
            orderBy: { name: "asc" },
            include: {
              skus: {
                where: {
                  status: "active",
                  ...currentEffectiveWindowFilter(asOf),
                },
                orderBy: { code: "asc" },
                select: { code: true },
              },
            },
          },
          channelEligibility: {
            where: currentEffectiveWindowFilter(asOf),
            orderBy: { channelKey: "asc" },
          },
        },
      },
    },
  });
  if (!storefrontItem?.catalogItem) notFound();

  const catalogItem = storefrontItem.catalogItem;
  const candidates = await prisma.catalogItem.findMany({
    where: {
      organizationId: catalogItem.organizationId,
      id: { not: catalogItem.id },
      status: "active",
      ...currentEffectiveWindowFilter(asOf),
    },
    orderBy: { name: "asc" },
    select: { id: true, catalogItemId: true, name: true },
  });

  const view: CatalogBuilderView = {
    storefrontItemId: storefrontItem.id,
    catalogItemRowId: catalogItem.id,
    catalogItemId: catalogItem.catalogItemId,
    name: catalogItem.name,
    fulfillmentRoute: deriveCatalogFulfillmentRoute({
      storedRoute: catalogItem.fulfillmentRoute,
      quoteRequired: catalogItem.quoteRequired,
      storefrontCtaType: storefrontItem.ctaType,
    }),
    bundleComponents: catalogItem.bundleComponents.map((component) => ({
      catalogItemId: component.componentCatalogItem.id,
      name: component.componentCatalogItem.name,
      quantity: component.quantity.toString(),
      eligibility: component.eligibility,
      allocationMode: component.allocationMode,
      allocationPercent: component.allocationPercent?.toString() ?? null,
    })),
    candidateItems: candidates,
    priceEntries: catalogItem.priceListEntries.map((entry) => ({
      id: entry.id,
      listName: entry.priceList.name,
      skuCode: entry.catalogSku?.code ?? null,
      amount: entry.priceAmount.toString(),
      currency: entry.priceList.currency,
      effectiveFrom: entry.effectiveFrom.toISOString(),
      effectiveTo: entry.effectiveTo?.toISOString() ?? null,
    })),
    promotions: catalogItem.promotionItems.map(({ promotion }) => ({
      id: promotion.id,
      name: promotion.name,
      adjustmentType: promotion.adjustmentType,
      adjustmentValue: promotion.adjustmentValue.toString(),
      effectiveFrom: promotion.effectiveFrom.toISOString(),
      effectiveTo: promotion.effectiveTo?.toISOString() ?? null,
    })),
    configurations: catalogItem.configurations.map((configuration) => ({
      id: configuration.id,
      name: configuration.name,
      skuCodes: configuration.skus.map((sku) => sku.code),
      promotedFromQuote: Boolean(configuration.promotedFromQuoteLineItemId),
    })),
    channels: catalogItem.channelEligibility.map((channel) => ({
      channelKey: channel.channelKey,
      eligibility: channel.eligibility,
      effectiveFrom: channel.effectiveFrom.toISOString(),
      effectiveTo: channel.effectiveTo?.toISOString() ?? null,
    })),
  };

  return <CatalogBuilderPanel initial={view} />;
}
