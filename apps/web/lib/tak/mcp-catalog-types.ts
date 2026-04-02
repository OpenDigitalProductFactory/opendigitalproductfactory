// apps/web/lib/mcp-catalog-types.ts

// ─── External API response shapes ────────────────────────────────────────────

/** Minimal shape returned by registry.modelcontextprotocol.io/v0/servers */
export interface RegistryServerEntry {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  repository?: { url: string };
  category?: string;
  subcategory?: string;
  tags?: string[];
  isVerified?: boolean;
}

/** Minimal shape returned by glama.ai/api/mcp/v1/servers/{id} */
export interface GlamaServerEntry {
  id: string;
  shortDescription?: string;
  logoUrl?: string;
  pricing?: { model: string };
  stats?: { rating: number; ratingCount: number; installCount: number };
}

// ─── Tag → Archetype ruleset ──────────────────────────────────────────────────

/**
 * Maps registry/Glama tags to StorefrontArchetype.category strings.
 * Values must match the exact category strings seeded in StorefrontArchetype.
 * Update this config in the same PR as any archetype addition/removal.
 */
export const ARCHETYPE_TAG_RULESET: Record<string, string[]> = {
  // Payments / commerce
  payments:    ["retail-goods", "food-hospitality", "fitness-recreation", "education-training", "pet-services", "professional-services"],
  ecommerce:   ["retail-goods", "food-hospitality"],
  commerce:    ["retail-goods", "food-hospitality"],
  pos:         ["retail-goods", "food-hospitality"],
  // Booking / scheduling
  booking:     ["healthcare-wellness", "beauty-personal-care", "pet-services", "fitness-recreation"],
  scheduling:  ["healthcare-wellness", "beauty-personal-care"],
  calendar:    ["healthcare-wellness", "education-training"],
  // Marketing / email
  email:       ["retail-goods", "fitness-recreation", "nonprofit-community"],
  marketing:   ["retail-goods", "food-hospitality", "fitness-recreation", "professional-services"],
  crm:         ["professional-services", "trades-maintenance"],
  // Website / content
  cms:         ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  wordpress:   ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  // Cloud / infrastructure
  cloud:       ["professional-services"],
  storage:     ["professional-services"],
  // Source control
  git:         ["professional-services", "education-training"],
  // Donations / nonprofit
  donations:   ["nonprofit-community"],
  nonprofit:   ["nonprofit-community"],
  // Communication
  messaging:   ["professional-services", "trades-maintenance"],
  slack:       ["professional-services"],
  // Finance / accounting
  accounting:  ["professional-services"],
  invoicing:   ["professional-services", "trades-maintenance"],
  // Analytics (cross-cutting — applies to all categories)
  analytics:   [
    "retail-goods", "food-hospitality", "fitness-recreation", "education-training", "pet-services",
    "professional-services", "trades-maintenance", "nonprofit-community", "healthcare-wellness", "beauty-personal-care",
  ],
};

/**
 * Derives category strings for a set of tags using ARCHETYPE_TAG_RULESET.
 * Returns deduplicated array of matching StorefrontArchetype.category strings.
 */
export function deriveArchetypeIds(tags: string[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const matches = ARCHETYPE_TAG_RULESET[tag.toLowerCase()];
    if (matches) matches.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}
