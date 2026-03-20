import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { SectionsManager } from "@/components/storefront-admin/SectionsManager";

export default async function SectionsPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/storefront/setup");

  const sections = await prisma.storefrontSection.findMany({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, type: true, title: true, sortOrder: true, isVisible: true },
  });

  return <SectionsManager storefrontId={config.id} sections={sections} />;
}
