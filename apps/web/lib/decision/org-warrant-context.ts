// apps/web/lib/decision/org-warrant-context.ts
//
// WWWD context for the work warrant (EP-7B169558 / BI-EE211BFA).
//
// deriveWarrant already escalates evidence to "compliance" when the warrant
// carries a vertical/jurisdiction obligation — but nothing ever populated
// contextScope, so the company/industry/location dimension was inert. This loads
// the org's WWWD scope at promote so a regulated install's builds automatically
// demand compliance evidence rather than the generic profile.
//
// Structural db type (not the Prisma client) so the loader is unit-testable and
// callable from inside the promote transaction.

import type { WarrantContext } from "./work-warrant";

export type OrgWarrantContextDb = {
  organization?: {
    findFirst(args: { select: { industry: true } }): Promise<{ industry: string | null } | null>;
  };
  storefrontConfig?: {
    findFirst(args: { select: { archetypeId: true } }): Promise<{ archetypeId: string | null } | null>;
  };
};

/**
 * Load the org's WWWD context (industry + chosen archetype). Best-effort: a
 * missing row or an unavailable storefrontConfig delegate yields nulls rather
 * than throwing — an absent context simply means no compliance escalation, and
 * promote must never fail because the stance is not yet configured.
 *
 * `jurisdiction` is not yet modelled on Organization; it stays null until a
 * jurisdiction field exists (the compliance archetype work is the likely home).
 */
export async function loadOrgWarrantContext(db: OrgWarrantContextDb): Promise<WarrantContext> {
  let industry: string | null = null;
  let archetype: string | null = null;

  try {
    const org = await db.organization?.findFirst({ select: { industry: true } });
    industry = org?.industry ?? null;
  } catch {
    // best-effort — leave null
  }

  try {
    const sf = await db.storefrontConfig?.findFirst({ select: { archetypeId: true } });
    archetype = sf?.archetypeId ?? null;
  } catch {
    // best-effort — leave null
  }

  return { industry, jurisdiction: null, archetype };
}
