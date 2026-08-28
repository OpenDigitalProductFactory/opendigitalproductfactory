import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductSupplyChainPage({ params }: Props) {
  const { id } = await params;
  redirect(`/portfolio/product/${id}/inventory#software-composition`);
}
