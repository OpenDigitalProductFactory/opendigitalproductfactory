import { newId } from "@/lib/shared/new-id";

interface SeedableArchetype {
  ctaType: string;
  itemTemplates: unknown;
  sectionTemplates: unknown;
}

export type CompositionArtifactClient = {
  storefrontItem: {
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
  storefrontSection: {
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
};

export async function seedCompositionArtifacts(input: {
  db: CompositionArtifactClient;
  storefrontId: string;
  compositionId: string;
  compositionSortOrder: number;
  seedCurrency: string;
  revealContentSections: boolean;
  archetype: SeedableArchetype;
}): Promise<{ items: number; sections: number }> {
  const itemTemplates = input.archetype.itemTemplates as Array<{
    name: string;
    description?: string;
    priceType: string;
    ctaType?: string;
    ctaLabel?: string;
    priceAmount?: number | null;
  }>;
  const sectionTemplates = input.archetype.sectionTemplates as Array<{
    type: string;
    title: string;
    sortOrder: number;
  }>;
  const sortBase = input.compositionSortOrder * 1000;

  const itemResult =
    itemTemplates.length === 0
      ? { count: 0 }
      : await input.db.storefrontItem.createMany({
          data: itemTemplates.map((template, index) => ({
            itemId: `itm-${newId(8)}`,
            storefrontId: input.storefrontId,
            name: template.name,
            description: template.description ?? null,
            priceType: template.priceType,
            ctaType: template.ctaType ?? input.archetype.ctaType,
            ctaLabel: template.ctaLabel ?? null,
            priceAmount: template.priceAmount ?? null,
            sortOrder: sortBase + index,
            isActive: true,
            priceCurrency: input.seedCurrency,
            sourceCompositionId: input.compositionId,
          })),
        });

  const sectionResult =
    sectionTemplates.length === 0
      ? { count: 0 }
      : await input.db.storefrontSection.createMany({
          data: sectionTemplates.map((section, index) => ({
            storefrontId: input.storefrontId,
            type: section.type,
            title: section.title,
            sortOrder: sortBase + index,
            content: {},
            isVisible:
              input.revealContentSections &&
              !["team", "gallery", "testimonials"].includes(section.type),
            sourceCompositionId: input.compositionId,
          })),
        });

  return { items: itemResult.count, sections: sectionResult.count };
}
