import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { ItemsManager } from "@/components/storefront-admin/ItemsManager";

export default async function ItemsPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/admin/storefront/setup");

  const items = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      itemId: true,
      name: true,
      description: true,
      priceAmount: true,
      priceCurrency: true,
      priceType: true,
      ctaType: true,
      isActive: true,
      sortOrder: true,
    },
  });

  return (
    <ItemsManager
      storefrontId={config.id}
      items={items.map((item) => ({ ...item, priceAmount: item.priceAmount?.toString() ?? null }))}
    />
  );
}
