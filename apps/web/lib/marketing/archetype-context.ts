// Storefront archetype + playbook resolution for marketing reads.
//
// Three marketing-ops tool handlers (get_marketing_summary,
// suggest_campaign_ideas, analyze_seo_opportunity) each re-inlined the same
// storefrontConfig.findFirst({ include: { archetype } }) + getPlaybook() +
// "No storefront configured" guard. Three copies meant three chances for the
// archetype resolution to drift apart, and the "storefront configured?" answer
// was already phrased three slightly different ways. This is the one resolver.
//
// Archetype is read from StorefrontConfig.archetype per AGENTS.md §2 —
// StorefrontConfig.archetypeId is the single source of truth for portal
// industry; Organization.industry and BusinessContext.industry are derived.

import { prisma } from "@dpf/db";
import { getPlaybook, type MarketingPlaybook } from "@/lib/tak/marketing-playbooks";

/** The one message shown when marketing is asked to reason before setup. */
export const MARKETING_NO_STOREFRONT_MESSAGE =
  "No storefront configured. Set up your storefront first at /storefront/setup.";

export type MarketingArchetype = {
  archetypeId: string;
  name: string;
  category: string;
  ctaType: string;
};

export type MarketingStorefrontItem = {
  name: string;
  description?: string | null;
  priceType?: string | null;
  ctaType?: string | null;
};

export type MarketingStorefrontSection = {
  type: string;
  title: string | null;
};

export type MarketingArchetypeContext = {
  storefrontId: string;
  archetype: MarketingArchetype;
  playbook: MarketingPlaybook;
  items: MarketingStorefrontItem[];
  sections: MarketingStorefrontSection[];
};

/**
 * Resolve the active storefront archetype and its marketing playbook.
 * Returns null when no storefront has been configured — callers surface
 * MARKETING_NO_STOREFRONT_MESSAGE rather than inventing an archetype.
 */
export async function resolveMarketingArchetypeContext(options?: {
  includeItems?: boolean;
  includeSections?: boolean;
  itemLimit?: number;
}): Promise<MarketingArchetypeContext | null> {
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: { select: { archetypeId: true, name: true, category: true, ctaType: true } },
      ...(options?.includeItems
        ? {
            items: {
              where: { isActive: true },
              select: { name: true, description: true, priceType: true, ctaType: true },
              orderBy: { sortOrder: "asc" as const },
              take: options.itemLimit ?? 20,
            },
          }
        : {}),
      ...(options?.includeSections
        ? {
            sections: {
              where: { isVisible: true },
              select: { type: true, title: true },
              orderBy: { sortOrder: "asc" as const },
            },
          }
        : {}),
    },
  });

  if (!config) return null;

  return {
    storefrontId: config.id,
    archetype: {
      archetypeId: config.archetype.archetypeId,
      name: config.archetype.name,
      category: config.archetype.category,
      ctaType: config.archetype.ctaType,
    },
    playbook: getPlaybook(config.archetype.category, config.archetype.ctaType),
    items: ((config as { items?: MarketingStorefrontItem[] }).items ?? []) as MarketingStorefrontItem[],
    sections: ((config as { sections?: MarketingStorefrontSection[] }).sections ?? []) as MarketingStorefrontSection[],
  };
}
