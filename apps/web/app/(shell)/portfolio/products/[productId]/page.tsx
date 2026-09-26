import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@dpf/db";

type Props = {
  params: Promise<{ productId: string }>;
};

// EP-2FB6C0CC (BI-DD763B93): superseded by /portfolio/product/[id], which every
// product link opens (nav-coherence spec 2026-06-21 names this a duplicate
// tree). Saved links keyed by productId still land on the product.
export default async function DigitalProductRedirect({ params }: Props) {
  const { productId } = await params;
  const product = await prisma.digitalProduct.findUnique({ where: { productId }, select: { id: true } });
  if (!product) notFound();
  permanentRedirect(`/portfolio/product/${product.id}`);
}
