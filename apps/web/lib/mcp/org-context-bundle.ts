// Org-identity context bundle for external MCP callers (BI-HDLEMP-02, Seam 2 of
// EP-HEADLESS-EMPLOYEE).
//
// Inside the platform, the coworker prompt-assembler PUSHES the company mission
// (Block 0) and the org's stance/principle wiki context (Block 5) into every
// turn. An external agent over /api/mcp/v1 gets only a tool list — no mission,
// archetype doctrine, or locale — so its decisions lack the org's context (the
// founder-reported symptom). This module composes that ambient context for
// external callers from the same substrate the WWWD corpus is seeded from
// (seed-org-wwwd-corpus.ts): BusinessContext.mission, the chosen archetype's
// business doctrine (archetype-business-context.ts), OrgSettings locale/currency
// (org-locale.ts), and the archetype stance vectors.
//
// The rendered instructions also route the agent's decisions to the right gate:
// a BUSINESS decision goes to evaluate_org_business_decision (scored against the
// organization's WWWD profile), a PLATFORM decision to principle_decide (the
// founder kernel). Live verification (BI-HDLEMP-07) showed principle_decide does
// not honor a decisionDomain hint — the caller-context route-on-domain axis
// (BI-HDLEMP-01) exists but has no consumer on that tool — so the directive
// names the dedicated org-business gate, which reaches WWWD by construction.

import {
  resolveBusinessProfile,
  resolveStanceVectors,
  type ArchetypeBusinessProfile,
  type ArchetypeStanceVectors,
} from "@/lib/onboarding/archetype-business-context";
import {
  resolveOrgLocale,
  type OrgLocaleClient,
  type OrgLocaleSettings,
} from "@/lib/org-locale/org-locale";

/** Narrow structural client — satisfied by the real PrismaClient and test fakes. */
export interface OrgContextClient extends OrgLocaleClient {
  organization: {
    findFirst: (args: unknown) => Promise<{ id: string; name: string | null } | null>;
  };
  businessContext: {
    findUnique: (args: unknown) => Promise<{
      mission?: string | null;
      description?: string | null;
      targetMarket?: string | null;
      industry?: string | null;
    } | null>;
  };
  storefrontConfig: {
    findFirst: (args: unknown) => Promise<{
      archetypeId?: string | null;
      archetype?: { name?: string | null; category?: string | null } | null;
    } | null>;
  };
}

export interface OrgContextBundle {
  organizationName: string | null;
  mission: string | null;
  archetypeId: string | null;
  archetypeName: string | null;
  industry: string | null;
  locale: OrgLocaleSettings;
  businessProfile: ArchetypeBusinessProfile;
  stanceVectors: ArchetypeStanceVectors;
}

/**
 * Compose the deployment org's identity bundle. Resolves the single-install org
 * (like the other MCP tools) and merges its captured business context with the
 * archetype's editable-starter doctrine and stance vectors. Returns null when no
 * organization exists yet (a brand-new deployment before onboarding) so callers
 * fall back to the base instructions rather than a fabricated context.
 *
 * Read-only and fail-open: every read is guarded, and a failure resolves to null
 * (surfaced via onReadFailure) so a degraded DB never blocks MCP `initialize`.
 * Multi-tenant org selection is out of scope while the platform is single-install
 * (tracked with the rest of tenancy under BI-HDLEMP-03 / EP-MSP-FEDERATION).
 */
export async function buildOrgContextBundle(
  db: OrgContextClient,
  opts?: { onReadFailure?: (error: unknown) => void },
): Promise<OrgContextBundle | null> {
  let org: { id: string; name: string | null } | null = null;
  try {
    org = await db.organization.findFirst({ select: { id: true, name: true } });
  } catch (error) {
    opts?.onReadFailure?.(error);
    return null;
  }
  if (!org) return null;

  const [bc, sf, locale] = await Promise.all([
    db.businessContext
      .findUnique({
        where: { organizationId: org.id },
        select: { mission: true, description: true, targetMarket: true, industry: true },
      })
      .catch((error: unknown) => {
        opts?.onReadFailure?.(error);
        return null;
      }),
    db.storefrontConfig
      .findFirst({
        select: { archetypeId: true, archetype: { select: { name: true, category: true } } },
      })
      .catch((error: unknown) => {
        opts?.onReadFailure?.(error);
        return null;
      }),
    resolveOrgLocale(db, opts),
  ]);

  const archetypeId = sf?.archetypeId ?? null;
  // Industry = the archetype category (the key INDUSTRY_PROFILES is keyed on),
  // falling back to the captured BusinessContext.industry — mirrors the seed.
  const industry = sf?.archetype?.category ?? bc?.industry ?? null;

  return {
    organizationName: org.name ?? null,
    mission: bc?.mission ?? null,
    archetypeId,
    archetypeName: sf?.archetype?.name ?? null,
    industry,
    locale,
    businessProfile: resolveBusinessProfile({ archetypeId, industry }),
    stanceVectors: resolveStanceVectors({ archetypeId, industry }),
  };
}

/** Compact connection orientation. Decision tools resolve detailed live doctrine on demand. */
export function formatOrgContextInstructions(
  base: string,
  bundle: OrgContextBundle | null,
): string {
  if (!bundle) return base;
  // Bound user-editable fields independently; never truncate the decision routes.
  const brief = (value: string | null | undefined, max: number) =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const block = [
    `ORGANIZATION CONTEXT: ${brief(bundle.organizationName, 80) || "this organization"}.`,
    `Mission: ${brief(bundle.mission || bundle.businessProfile.missionTheme, 180)}`,
    `Archetype: ${brief(bundle.archetypeName, 60)}; industry: ${brief(bundle.industry, 60)}.`,
    `Locale: ${brief(bundle.locale.locale, 20)}; currency: ${brief(bundle.locale.currency, 10)}; country: ${brief(bundle.locale.countryCode, 10)}.`,
    'DECISION ROUTING: organization business → evaluate_org_business_decision (decisionScope "wwwd"); practitioner judgment → evaluate_profession_decision; DPF platform → principle_decide. These tools resolve the owning scope’s recorded doctrine. Cross-scope doctrine is advisory. If ownership is unclear, ask the owner. Do not substitute generic defaults for recorded business policy.',
  ].join("\n");
  return `${base}\n\n${block}`;
}
