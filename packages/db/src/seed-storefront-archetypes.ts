import { PrismaClient } from "../generated/client/client";
import { ARCHETYPE_SEED_DATA } from "@dpf/storefront-templates/seed";

// Prisma 7 Json fields accept plain objects at runtime but the generated types
// are strict. Seed data is static JSON — safe to widen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as any;

// Archetype-driven marketing skill visibility and relabeling.
// Only archetypes that need overrides are listed; the rest get {} (all skills, default labels).
const MARKETING_SKILL_RULES: Record<string, Record<string, unknown>> = {
  // BI-3101AED6: a software platform sells to the businesses that run on it,
  // one buyer type at a time — not to a generic "tech buyer". When the
  // business's own offer is the platform, the buyer-archetype value catalog
  // supplies each buyer's benefits (apps/web/lib/marketing/buyer-archetype-value.ts).
  "software-platform": {
    "campaign-ideas": {
      label: "Buyer-Specific Campaign Ideas",
      reframe: "Plan campaigns for one buyer type at a time — an HVAC contractor, a dental practice, an MSP partner — in that buyer's own words about their day. Lead with the owner's outcome, not product internals, and keep available-today claims separate from planned capability.",
    },
    "competitive-analysis": {
      label: "Alternatives the Buyer Already Uses",
      reframe: "Compare against what this buyer type runs today (spreadsheets, point tools, an existing provider) and the cost of switching — not against other vendors' feature lists.",
    },
    "email-campaign-builder": {
      label: "Evaluation & Adoption Sequences",
      reframe: "Focus on guided evaluation follow-up, onboarding, adoption milestones, release notes framed as customer change, and partner enablement. Tone is plain and honest about what is available today.",
    },
  },
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
  "public-sector": {
    "seo-content-optimizer": { visible: false },
    "competitive-analysis": { visible: false },
    "email-campaign-builder": {
      label: "Public Notice Builder",
      reframe: "Focus on official civic communications: meeting notices, public hearings, service disruptions, budget and levy communications, permit deadlines, and emergency notifications. Tone is official, plain-language, and neutral — public bodies inform every resident equally; they do not market or persuade.",
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
  "real-estate-construction": {
    "seo-content-optimizer": {
      label: "Community & Home Search Visibility",
      reframe: "Focus on community name visibility, suburb-level search terms (new homes near [suburb], custom builders in [region]), and floor-plan content that ranks for home-search queries. Include structured data for property listings where applicable.",
    },
    "competitive-analysis": {
      label: "Market & Community Positioning",
      reframe: "Focus on community differentiators, build quality, included features versus the market, and delivery track record. Avoid unverifiable price-per-sqft claims; any public price comparisons must reflect current listed prices.",
    },
    "email-campaign-builder": {
      label: "Buyer Journey Communication Builder",
      reframe: "Focus on community launch announcements, construction milestone updates for under-contract buyers, design centre appointment reminders, and post-handover warranty follow-ups. Tone is professional, milestone-driven, and celebratory at key moments (slab down, frame up, handover).",
    },
  },
  "banking-financial-services": {
    "competitive-analysis": {
      label: "Local Institution Positioning",
      reframe: "Focus on community trust, service quality, and local presence — never aggressive competitive claims. Any rate or term mentioned must match the institution's current published rates: APY claims follow Truth in Savings (Reg DD) accuracy rules and loan-rate language follows Reg Z trigger-term rules. When in doubt, describe the relationship, not the number.",
    },
    "email-campaign-builder": {
      label: "Customer & Member Communication Builder",
      reframe: "Focus on rate-change notices, financial education, branch and service updates, and product announcements. Tone is clear, factual, and compliance-reviewable — no urgency pressure, no unverifiable claims. Rate figures must match current published rates (Reg DD APY accuracy; Reg Z trigger terms), and required disclosures (Member FDIC / NCUA insurance, Equal Housing) stay attached to deposit and lending content.",
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
        productMix: json(archetype.productMix ?? null),
        customVocabulary: json(archetype.vocabulary ?? null),
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
        productMix: json(archetype.productMix ?? null),
        // Leaf-level vocabulary override (e.g. credit-union "Members",
        // municipal-utility "Ratepayers") — merged over the category vocabulary
        // by applyCustomVocabulary at render time. Conditional on the update
        // path so re-seeding never clobbers operator label edits (the portal
        // rename tool also writes customVocabulary) for templates that carry
        // no override of their own.
        ...(archetype.vocabulary ? { customVocabulary: json(archetype.vocabulary) } : {}),
        marketingSkillRules: json(MARKETING_SKILL_RULES[archetype.category] ?? {}),
      },
    });
  }

  console.log(`[seed] storefront archetypes done`);
}
