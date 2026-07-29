import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { ProductSoldTracePanel } from "@/components/storefront-admin/ProductSoldTracePanel";
import { getCatalogItemProductSoldTrace } from "@/lib/products/product-sold-query";

export default async function ProductSoldTracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const storefront = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!storefront) redirect("/storefront/setup");

  const item = await prisma.storefrontItem.findFirst({
    where: { id, storefrontId: storefront.id },
    select: {
      id: true,
      name: true,
      catalogItem: { select: { id: true } },
    },
  });
  if (!item?.catalogItem) notFound();

  const trace = await getCatalogItemProductSoldTrace({
    db: prisma as never,
    organizationId: storefront.organizationId,
    catalogItemId: item.catalogItem.id,
  });

  return (
    <ProductSoldTracePanel
      itemName={item.name}
      trace={trace}
      backHref={`/storefront/items/${item.id}/catalog`}
    />
  );
}
