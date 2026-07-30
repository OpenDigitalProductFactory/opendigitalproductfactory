import { notFound } from "next/navigation";
import { ProductLineHeader } from "@/components/product/ProductLineHeader";
import { ProductLineTabNav } from "@/components/product/ProductLineTabNav";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";

export default async function ProductLineDirectionLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  let context;
  try {
    context = await loadCurrentProductOperatingContextByKey("product-line", id);
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

  return (
    <div>
      <ProductLineHeader
        line={productLine}
        providerName={context.provider.name}
      />
      <ProductLineTabNav productLineId={productLine.id} />
      <div className="mt-dpf-lg">{children}</div>
    </div>
  );
}
