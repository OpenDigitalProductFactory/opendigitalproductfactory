// apps/web/lib/mcp-catalog-types.ts

// ─── External API response shapes ────────────────────────────────────────────

/** Minimal shape returned by registry.modelcontextprotocol.io/v0/servers */
export interface RegistryServerEntry {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  repositoryUrl?: string;
  documentationUrl?: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  isVerified?: boolean;
}

/** Minimal shape returned by glama.ai/api/mcp/v1/servers/{id} */
export interface GlamaServerEntry {
  id: string;
  logoUrl?: string;
  rating?: number;
  ratingCount?: number;
  installCount?: number;
  pricingModel?: string;
}

// ─── Tag → Archetype ruleset ──────────────────────────────────────────────────

/**
 * Maps registry/Glama tags to StorefrontArchetype.archetypeId values.
 * Values must match the exact archetypeId strings seeded in StorefrontArchetype.
 * Update this config in the same PR as any archetype addition/removal.
 */
export const ARCHETYPE_TAG_RULESET: Record<string, string[]> = {
  // Payments / commerce
  payments:     ["retail-goods", "food-hospitality", "fitness-recreation", "education-training", "pet-grooming", "pet-care"],
  ecommerce:    ["retail-goods", "artisan-goods", "florist"],
  commerce:     ["retail-goods", "artisan-goods", "restaurant", "catering", "bakery"],
  pos:          ["retail-goods", "food-hospitality"],
  // Booking / scheduling
  booking:      ["veterinary-clinic", "dental-practice", "physiotherapy", "counselling", "optician", "hair-salon", "barber-shop", "nail-salon", "beauty-spa", "personal-trainer", "pet-grooming", "pet-care", "gym", "yoga-studio", "dance-studio"],
  scheduling:   ["veterinary-clinic", "dental-practice", "physiotherapy", "counselling", "optician", "hair-salon", "barber-shop"],
  calendar:     ["veterinary-clinic", "dental-practice", "corporate-training", "tutoring"],
  // Marketing / email
  email:        ["retail-goods", "fitness-recreation", "nonprofit-community", "charity", "sports-club"],
  marketing:    ["retail-goods", "food-hospitality", "fitness-recreation", "professional-services"],
  crm:          ["it-managed-services", "legal-services", "accounting", "marketing-agency", "consulting", "facilities-maintenance"],
  // Website / content
  cms:          ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  wordpress:    ["retail-goods", "food-hospitality", "professional-services", "nonprofit-community"],
  // Cloud / infrastructure
  cloud:        ["it-managed-services", "consulting", "marketing-agency"],
  storage:      ["it-managed-services", "consulting"],
  // Source control
  git:          ["it-managed-services", "consulting", "corporate-training"],
  // Donations / nonprofit
  donations:    ["pet-rescue", "animal-shelter", "community-shelter", "charity", "sports-club"],
  nonprofit:    ["pet-rescue", "animal-shelter", "community-shelter", "charity", "sports-club"],
  // Communication
  messaging:    ["it-managed-services", "consulting", "facilities-maintenance"],
  slack:        ["it-managed-services", "consulting"],
  // Finance / accounting
  accounting:   ["accounting", "legal-services", "it-managed-services"],
  invoicing:    ["accounting", "it-managed-services", "consulting", "facilities-maintenance", "plumber", "electrician"],
};

/**
 * Derives archetypeIds for a set of tags using ARCHETYPE_TAG_RULESET.
 * Returns deduplicated array of matching archetypeId strings.
 */
export function deriveArchetypeIds(tags: string[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const matches = ARCHETYPE_TAG_RULESET[tag.toLowerCase()];
    if (matches) matches.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}
