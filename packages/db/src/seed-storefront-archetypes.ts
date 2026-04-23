import { PrismaClient } from "../generated/client/client";
import { ARCHETYPE_SEED_DATA } from "@dpf/storefront-templates/seed";

// Prisma 7 Json fields accept plain objects at runtime but the generated types
// are strict. Seed data is static JSON — safe to widen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as any;

// Archetype-driven marketing skill visibility and relabeling.
// Only archetypes that need overrides are listed; the remaining 7 get {} (all skills, default labels).
const MARKETING_SKILL_RULES: Record<string, Record<string, unknown>> = {
  "hoa-property-management": {
    "seo-content-optimizer": { visible: false },
    "competitive-analysis": { visible: false },
    "email-campaign-builder": {
      label: "Community Notice Builder",
      reframe: "Focus on official community communications: bylaw updates, assessment notices, meeting invitations, maintenance schedules. Tone is official and transparent, not promotional.",
    },
  },
  "healthcare-wellness": {
    "competitive-analysis": {
      label: "Local Practice Positioning",
      reframe: "Focus on patient experience differentiation and local practice awareness. Avoid aggressive competitive language -- healthcare is regulated and trust-based.",
    },
    "email-campaign-builder": {
      label: "Patient Communication Builder",
      reframe: "Focus on patient recall reminders, health tips, new service announcements, and practice updates. Tone is reassuring and professional.",
    },
  },
  "education-training": {
    "email-campaign-builder": {
      label: "Enrolment Communication Builder",
      reframe: "Focus on term launches, open day invitations, student success stories, and enrolment drives. Tone is encouraging and achievement-focused.",
    },
  },
  "nonprofit-community": {
    "seo-content-optimizer": {
      label: "Cause Visibility Advisor",
      reframe: "Focus on mission awareness, cause-related search visibility, and being found by potential donors, volunteers, and grant makers.",
    },
    "competitive-analysis": {
      label: "Peer Landscape Review",
      reframe: "Focus on peer organizations serving similar causes. Help differentiate for donors and identify collaboration opportunities rather than competitive positioning.",
    },
    "email-campaign-builder": {
      label: "Donor & Volunteer Communication Builder",
      reframe: "Focus on impact storytelling, donor stewardship, volunteer appreciation, and fundraising event promotion. Tone is mission-focused and gratitude-first.",
    },
  },
};

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
        activationProfile: json(archetype.activationProfile ?? null),
        marketingSkillRules: json(MARKETING_SKILL_RULES[archetype.category] ?? {}),
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
        activationProfile: json(archetype.activationProfile ?? null),
        marketingSkillRules: json(MARKETING_SKILL_RULES[archetype.category] ?? {}),
      },
    });
  }

  console.log(`[seed] storefront archetypes done`);
}
