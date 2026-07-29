import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProductRoadmap } from "@/components/product/direction/ProductRoadmap";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";
import {
  resolveProductRoadmapAudience,
  resolveProductRoadmapView,
} from "@/lib/product-management/product-roadmap";
import { projectProductRoadmapFromOperatingContext } from "@/lib/product-management/product-roadmap-operating-context";
import {
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    view?: string | string[];
    audience?: string | string[];
  }>;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProductRoadmapPage({
  params,
  searchParams,
}: Props) {
  const [{ id }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
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
    cookieStore.get(NAV_MODE_COOKIE)?.value,
  );
  const audience = resolveProductRoadmapAudience(
    one(query.audience),
    navMode === "worker" ? "owner-operator" : "product-manager",
  );

  return (
    <ProductRoadmap
      scopeId={id}
      scopeHref={`/portfolio/product/${encodeURIComponent(id)}/direction/roadmap`}
      workspace={projectProductRoadmapFromOperatingContext(context)}
      view={resolveProductRoadmapView(one(query.view))}
      audience={audience}
    />
  );
}
