import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { ProductSupplyChainPanel } from "@/components/product/ProductSupplyChainPanel";
import { getLatestBomComponentsForProduct } from "@/lib/assurance/bom-read";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductSupplyChainPage({ params }: Props) {
  const { id } = await params;
  const product = await prisma.digitalProduct.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!product) notFound();

  const { latestBom, components } = await getLatestBomComponentsForProduct(prisma, id);

  return (
    <ProductSupplyChainPanel
      productId={id}
      latestBom={latestBom}
      components={components}
    />
  );
}
