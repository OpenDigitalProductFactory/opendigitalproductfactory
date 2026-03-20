import { PrismaClient } from "../generated/client";
import { ARCHETYPE_SEED_DATA } from "@dpf/storefront-templates/seed";

export async function seedStorefrontArchetypes(prisma: PrismaClient): Promise<void> {
  console.log(`[seed] upserting ${ARCHETYPE_SEED_DATA.length} storefront archetypes…`);

  for (const archetype of ARCHETYPE_SEED_DATA) {
    await prisma.storefrontArchetype.upsert({
      where: { archetypeId: archetype.archetypeId },
      create: {
        archetypeId: archetype.archetypeId,
        name: archetype.name,
        category: archetype.category,
        ctaType: archetype.ctaType,
        itemTemplates: archetype.itemTemplates,
        sectionTemplates: archetype.sectionTemplates,
        formSchema: archetype.formSchema,
        tags: archetype.tags,
        isActive: true,
      },
      update: {
        name: archetype.name,
        category: archetype.category,
        ctaType: archetype.ctaType,
        itemTemplates: archetype.itemTemplates,
        sectionTemplates: archetype.sectionTemplates,
        formSchema: archetype.formSchema,
        tags: archetype.tags,
      },
    });
  }

  console.log(`[seed] storefront archetypes done`);
}
