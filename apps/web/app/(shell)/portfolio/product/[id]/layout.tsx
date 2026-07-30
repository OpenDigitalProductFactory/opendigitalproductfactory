// apps/web/app/(shell)/portfolio/product/[id]/layout.tsx
//
// Shared layout for the product lifecycle home — renders header + tab nav,
// with each tab as a child route.

import { notFound } from "next/navigation";
import { ProductHeader } from "@/components/product/ProductHeader";
import { ProductTabNav } from "@/components/product/ProductTabNav";
import { BusinessProductHeader } from "@/components/product/BusinessProductHeader";
import { BusinessProductTabNav } from "@/components/product/BusinessProductTabNav";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  resolveCurrentProductRouteAuthority,
} from "@/lib/product-management/current-product-operating-context.server";

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export default async function ProductLayout({ params, children }: Props) {
  const { id } = await params;

  let authority;
  try {
    authority = await resolveCurrentProductRouteAuthority(id);
  } catch (error) {
    if (
      error instanceof ProductManagementAccessError ||
      error instanceof ProductManagementOrganizationNotFoundError
    ) {
      notFound();
    }
    throw error;
  }
  if (!authority) notFound();

  return (
    <div>
      {authority.kind === "business-product" ? (
        <>
          <BusinessProductHeader product={authority.product} />
          <BusinessProductTabNav productId={authority.product.id} />
        </>
      ) : (
        <>
          <ProductHeader product={authority.product} />
          <ProductTabNav productId={authority.product.id} />
        </>
      )}
      {children}
    </div>
  );
}
