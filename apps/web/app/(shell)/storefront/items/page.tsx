import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { ItemsManager } from "@/components/storefront-admin/ItemsManager";
import { getVocabulary, getCategorySuggestions } from "@/lib/storefront/archetype-vocabulary";
import { loadStorefrontContentFit } from "@/lib/storefront/content-fit.server";

export default async function ItemsPage() {
  const [config, orgSettings] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: { select: { archetypeId: true, category: true, ctaType: true, customVocabulary: true } },
      },
    }),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);
  if (!config) redirect("/storefront/setup");

  const items = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "asc" },
  });

  const vocabulary = getVocabulary(
    config.archetype.category,
    config.archetype.customVocabulary as Record<string, string> | null,
  );
  const categorySuggestions = getCategorySuggestions(config.archetype.archetypeId);

  const fit = await loadStorefrontContentFit({
    storefrontId: config.id,
    currentCategory: config.archetype.category,
    vocabulary,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      isActive: item.isActive,
    })),
  });

  return (
    <ItemsManager
      storefrontId={config.id}
      items={items.map((item) => ({
        ...item,
        priceAmount: item.priceAmount?.toString() ?? null,
        bookingConfig: item.bookingConfig as Record<string, unknown> | null,
      }))}
      vocabulary={vocabulary}
      categorySuggestions={categorySuggestions}
      defaultCtaType={config.archetype.ctaType}
      defaultCurrency={orgSettings?.baseCurrency ?? "USD"}
      isPublished={config.isPublished}
      residueGroups={fit.groups.filter((g) => g.itemIds.length > 0)}
    />
  );
}
