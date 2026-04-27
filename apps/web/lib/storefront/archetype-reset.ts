import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";

type ResetMode = "replace-seeded-content";

export async function resetStorefrontArchetype(input: {
  organizationId: string;
  targetArchetypeId: string;
  mode: ResetMode;
}) {
  const { organizationId, targetArchetypeId, mode } = input;

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const storefront = await tx.storefrontConfig.findUnique({
      where: { organizationId },
      select: { id: true, organizationId: true },
    });

    if (!storefront) {
      throw new Error(`Storefront for organization ${organizationId} not found`);
    }

    const targetArchetype = await tx.storefrontArchetype.findUnique({
      where: { archetypeId: targetArchetypeId },
      select: {
        id: true,
        category: true,
        ctaType: true,
        sectionTemplates: true,
        itemTemplates: true,
      },
    });

    if (!targetArchetype) {
      throw new Error(`Target archetype ${targetArchetypeId} not found`);
    }

    await tx.storefrontConfig.update({
      where: { id: storefront.id },
      data: { archetypeId: targetArchetype.id },
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: { industry: targetArchetype.category },
    });

    await tx.businessContext.updateMany({
      where: { organizationId },
      data: {
        industry: targetArchetype.category,
        ctaType: targetArchetype.ctaType,
      },
    });

    let sectionsCreated = 0;
    let itemsCreated = 0;

    if (mode === "replace-seeded-content") {
      const existingItems = await tx.storefrontItem.findMany({
        where: { storefrontId: storefront.id },
        select: { id: true },
      });
      const existingItemIds = existingItems.map((item) => item.id);

      if (existingItemIds.length > 0) {
        await tx.providerService.deleteMany({
          where: { itemId: { in: existingItemIds } },
        });
        await tx.bookingHold.deleteMany({
          where: { itemId: { in: existingItemIds } },
        });
      }

      await tx.storefrontSection.deleteMany({
        where: { storefrontId: storefront.id },
      });
      await tx.storefrontItem.deleteMany({
        where: { storefrontId: storefront.id },
      });

      const sectionTemplates = targetArchetype.sectionTemplates as Array<{
        type: string;
        title?: string | null;
        sortOrder: number;
      }>;
      const itemTemplates = targetArchetype.itemTemplates as Array<{
        name: string;
        description?: string | null;
        category?: string | null;
        priceType?: string | null;
        ctaType?: string | null;
        ctaLabel?: string | null;
      }>;

      const sectionResult = await tx.storefrontSection.createMany({
        data: sectionTemplates.map((section) => ({
          storefrontId: storefront.id,
          type: section.type,
          title: section.title ?? null,
          content: {},
          sortOrder: section.sortOrder,
          isVisible: true,
        })),
      });

      const itemResult = await tx.storefrontItem.createMany({
        data: itemTemplates.map((item, index) => ({
          storefrontId: storefront.id,
          itemId: `itm-${nanoid(8)}`,
          name: item.name,
          description: item.description ?? null,
          category: item.category ?? null,
          priceType: item.priceType ?? null,
          priceCurrency: "GBP",
          ctaType: item.ctaType ?? targetArchetype.ctaType,
          ctaLabel: item.ctaLabel ?? null,
          sortOrder: index,
          isActive: true,
        })),
      });

      sectionsCreated = sectionResult.count;
      itemsCreated = itemResult.count;
    }

    return {
      storefrontId: storefront.id,
      archetypeId: targetArchetypeId,
      category: targetArchetype.category,
      sectionsCreated,
      itemsCreated,
    };
  });
}
