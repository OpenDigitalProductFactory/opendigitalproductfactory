import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { ItemsManager } from "@/components/storefront-admin/ItemsManager";
import { getVocabulary, getCategorySuggestions } from "@/lib/storefront/archetype-vocabulary";
import { loadStorefrontContentFit } from "@/lib/storefront/content-fit.server";
import { projectStorefrontCatalogRow } from "@/lib/products/commercial-catalog";

export default async function ItemsPage() {
  const [config, orgSettings] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      select: {
        id: true,
        organizationId: true,
        isPublished: true,
        archetype: {
          select: {
            archetypeId: true,
            category: true,
            ctaType: true,
            customVocabulary: true,
          },
        },
      },
    }),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);
  if (!config) redirect("/storefront/setup");

  const [items, productLines] = await Promise.all([
    prisma.storefrontItem.findMany({
      where: { storefrontId: config.id },
      orderBy: { sortOrder: "asc" },
      include: {
        catalogItem: {
          select: {
            catalogItemId: true,
            name: true,
            description: true,
            priceType: true,
            priceAmount: true,
            priceCurrency: true,
            quoteRequired: true,
            status: true,
          },
        },
      },
    }),
    prisma.productLine.findMany({
      where: {
        organizationId: config.organizationId,
        effectiveTo: null,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

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
      items={items.map((item) => {
        return {
          ...projectStorefrontCatalogRow(item),
          bookingConfig: item.bookingConfig as Record<string, unknown> | null,
        };
      })}
      vocabulary={vocabulary}
      archetypeCategory={config.archetype.category}
      categorySuggestions={categorySuggestions}
      defaultCtaType={config.archetype.ctaType}
      defaultCurrency={orgSettings?.baseCurrency ?? "USD"}
      isPublished={config.isPublished}
      residueGroups={fit.groups.filter((g) => g.itemIds.length > 0)}
      productLines={productLines}
    />
  );
}
