import { prisma } from "@dpf/db";
import {
  parseReadabilityPolicy,
  resolveReadingLevel,
  asReadingLevel,
  READABILITY_POLICY_KEY,
  type ReadabilityPolicy,
  type ReadingLevel,
} from "@dpf/validators";

// ============================================================================
// Runtime resolution of the platform readability policy (BI-8F8C5F28).
// Stored on the existing PlatformConfig key/value table — no new surface.
// Policy doc: docs/platform-usability-standards.md → Readability & Plain Language
// ============================================================================

export { READABILITY_POLICY_KEY };

/** The platform default policy (operator-adjustable from /admin/settings). */
export async function loadReadabilityPolicy(): Promise<ReadabilityPolicy> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: READABILITY_POLICY_KEY },
    select: { value: true },
  });
  return parseReadabilityPolicy(row?.value ?? null);
}

/**
 * Per-archetype override from the active storefront archetype's
 * `marketingSkillRules.readingLevel` (existing JSONB; null when unset).
 * Mirrors the read pattern in getMarketingSkillRules().
 */
export async function getArchetypeReadingLevel(): Promise<ReadingLevel | null> {
  const config = await prisma.storefrontConfig.findFirst({ select: { archetypeId: true } });
  if (!config) return null;
  const archetype = await prisma.storefrontArchetype.findUnique({ where: { id: config.archetypeId } });
  const rules = (archetype as Record<string, unknown> | null)?.["marketingSkillRules"];
  if (!rules || typeof rules !== "object") return null;
  return asReadingLevel((rules as Record<string, unknown>)["readingLevel"]);
}

/**
 * Coworkers on external / customer-copy surfaces (marketing, storefront) get a
 * reading-level directive; internal surfaces don't (no constraint).
 */
export function isExternalCopyRoute(routeContext: string | null | undefined): boolean {
  if (!routeContext) return false;
  const r = routeContext.toLowerCase();
  return r.includes("marketing") || r.includes("storefront");
}

/**
 * The reading level a coworker should target for the current route, or null
 * when the route doesn't produce customer-facing copy. Resolution order:
 * per-archetype override → platform policy (marketing tier).
 */
export async function resolveReadingLevelForRoute(
  routeContext: string | null | undefined,
): Promise<ReadingLevel | null> {
  if (!isExternalCopyRoute(routeContext)) return null;
  const [policy, archetypeOverride] = await Promise.all([
    loadReadabilityPolicy(),
    getArchetypeReadingLevel(),
  ]);
  return resolveReadingLevel(policy, { audience: "marketing", archetypeOverride });
}
