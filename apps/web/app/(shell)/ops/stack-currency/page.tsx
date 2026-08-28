import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

export default async function StackCurrencyPage() {
  const platformProduct = await prisma.digitalProduct.findUnique({
    where: { productId: "dpf-portal" },
    select: { id: true },
  });
  if (!platformProduct) notFound();
  redirect(`/portfolio/product/${platformProduct.id}/inventory#software-composition`);
}
