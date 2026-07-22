import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { SectionsManager } from "@/components/storefront-admin/SectionsManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { loadStorefrontContentFit } from "@/lib/storefront/content-fit.server";

export default async function SectionsPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      isPublished: true,
      archetype: { select: { category: true, customVocabulary: true } },
    },
  });
  if (!config) redirect("/storefront/setup");

  const sections = await prisma.storefrontSection.findMany({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, type: true, title: true, sortOrder: true, isVisible: true },
  });

  const vocabulary = getVocabulary(
    config.archetype.category,
    config.archetype.customVocabulary as Record<string, string> | null,
  );

  const fit = await loadStorefrontContentFit({
    storefrontId: config.id,
    currentCategory: config.archetype.category,
    vocabulary,
    sections,
  });

  return (
    <SectionsManager
      storefrontId={config.id}
      sections={sections}
      vocabulary={vocabulary}
      isPublished={config.isPublished}
      residueGroups={fit.groups.filter((g) => g.sectionIds.length > 0)}
    />
  );
}
