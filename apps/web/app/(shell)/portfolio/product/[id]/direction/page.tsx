import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProductDirectionBrief } from "@/components/product/direction/ProductDirectionBrief";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";
import { buildProductDirectionView } from "@/lib/product-management/product-direction-view";
import {
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductDirectionPage({ params }: Props) {
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
  const navMode = resolveNavModeFromCookie(
    (await cookies()).get(NAV_MODE_COOKIE)?.value,
  );
  const view = buildProductDirectionView(
    context,
    navMode === "worker" ? "guided" : "professional",
  );

  return <ProductDirectionBrief context={context} view={view} />;
}
