import { PrismaClient } from "../generated/client/client";
import { ARCHETYPE_SEED_DATA } from "@dpf/storefront-templates/seed";

// Prisma 7 Json fields accept plain objects at runtime but the generated types
// are strict. Seed data is static JSON — safe to widen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as any;

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
        itemTemplates: json(archetype.itemTemplates),
        sectionTemplates: json(archetype.sectionTemplates),
        formSchema: json(archetype.formSchema),
        tags: archetype.tags,
        isActive: true,
      },
      update: {
        // isActive intentionally excluded: re-seeding must not reactivate
        // an archetype that an operator has soft-deleted.
        name: archetype.name,
        category: archetype.category,
        ctaType: archetype.ctaType,
        itemTemplates: json(archetype.itemTemplates),
        sectionTemplates: json(archetype.sectionTemplates),
        formSchema: json(archetype.formSchema),
        tags: archetype.tags,
      },
    });
  }

  console.log(`[seed] storefront archetypes done`);
}
