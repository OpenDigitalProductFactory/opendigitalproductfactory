import { notFound } from "next/navigation";
import { ProductOutcomes } from "@/components/product/direction/ProductOutcomes";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";

export default async function ProductOutcomesPage({
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

  return (
    <ProductOutcomes
      product={{ id: product.id, name: product.name }}
      objectives={context.objectives.items}
      requestedAt={context.requestedAt}
    />
  );
}
