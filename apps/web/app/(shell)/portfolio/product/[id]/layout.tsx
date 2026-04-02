// apps/web/app/(shell)/portfolio/product/[id]/layout.tsx
//
// Shared layout for the product lifecycle home — renders header + tab nav,
// with each tab as a child route.

import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { ProductHeader } from "@/components/product/ProductHeader";
import { ProductTabNav } from "@/components/product/ProductTabNav";

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export default async function ProductLayout({ params, children }: Props) {
  const { id } = await params;

  const product = await prisma.digitalProduct.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      name: true,
      description: true,
      lifecycleStage: true,
      lifecycleStatus: true,
      version: true,
      portfolio: { select: { name: true, slug: true } },
      taxonomyNode: { select: { name: true, nodeId: true } },
    },
  });

  if (!product) notFound();

  return (
    <div>
      <ProductHeader product={product} />
      <ProductTabNav productId={product.id} />
      {children}
    </div>
  );
}
