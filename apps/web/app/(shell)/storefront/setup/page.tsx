import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { SetupWizard } from "@/components/storefront-admin/SetupWizard";

export default async function StorefrontSetupPage() {
  const existing = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (existing) redirect("/storefront");

  const archetypes = await prisma.storefrontArchetype.findMany({
    where: { isActive: true },
    select: {
      archetypeId: true,
      name: true,
      category: true,
      ctaType: true,
      tags: true,
      itemTemplates: true,
      sectionTemplates: true,
    },
    orderBy: { category: "asc" },
  });

  return <SetupWizard archetypes={archetypes} />;
}
