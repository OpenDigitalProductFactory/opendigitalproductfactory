import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProductIntelligence } from "@/components/product/intelligence/ProductIntelligence";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";
import { buildProductIntelligenceView } from "@/lib/product-management/product-intelligence-view";
import {
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

export default async function ProductIntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let context;
  try {
    context = await loadCurrentProductOperatingContextByKey("product", id);
  } catch (error) {
    if (
      error instanceof ProductOperatingContextNotFoundError ||
      error instanceof ProductManagementAccessError ||
      error instanceof ProductManagementOrganizationNotFoundError
    ) {
      notFound();
    }
    throw error;
  }
  const product = context.products.find((candidate) => candidate.id === id);
  if (!product) notFound();

  const navMode = resolveNavModeFromCookie(
    (await cookies()).get(NAV_MODE_COOKIE)?.value,
  );
  const view = buildProductIntelligenceView({
    requestedAt: context.requestedAt,
    audience: navMode === "worker" ? "guided" : "professional",
    product: {
      id: product.id,
      name: product.name,
      productLineId: product.productLineId,
    },
    intelligence: context.intelligence.items,
    watches: context.scheduledPlaybooks.items,
  });

  return <ProductIntelligence context={context} view={view} />;
}
