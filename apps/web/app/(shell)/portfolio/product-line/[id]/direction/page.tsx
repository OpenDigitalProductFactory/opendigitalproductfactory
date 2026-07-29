import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProductDirectionBrief } from "@/components/product/direction/ProductDirectionBrief";
import { ProductLinePerformance } from "@/components/product/ProductLinePerformance";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";
import { buildProductDirectionView } from "@/lib/product-management/product-direction-view";
import { buildProductLinePerformance } from "@/lib/product-management/product-performance";
import {
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

export default async function ProductLineDirectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let context;
  try {
    context = await loadCurrentProductOperatingContextByKey(
      "product-line",
      id,
    );
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
  const productLine = context.productLine;
  if (!productLine) notFound();
  const navMode = resolveNavModeFromCookie(
    (await cookies()).get(NAV_MODE_COOKIE)?.value,
  );
  const view = buildProductDirectionView(
    context,
    navMode === "worker" ? "guided" : "professional",
  );
  const performance = buildProductLinePerformance(context);

  return (
    <div className="space-y-dpf-xl">
      <ProductLinePerformance
        view={performance}
        audience={
          navMode === "worker" ? "owner-operator" : "professional-pm"
        }
      />
      <ProductDirectionBrief context={context} view={view} showLead={false} />
    </div>
  );
}
