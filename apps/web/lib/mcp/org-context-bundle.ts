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
// The rendered instructions also tell the agent to declare
// decisionDomain="org-business" on business decisions, which activates the
// route-on-domain engine (BI-HDLEMP-01) so those decisions are scored against
// the organization's WWWD profile rather than founder/platform doctrine.

import {
  resolveBusinessProfile,
  resolveStanceVectors,
  STANCE_VECTOR_KEYS,
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

/**
 * Render the MCP `initialize` instructions: the base surface note plus, when an
 * organization is resolved, an ORGANIZATION CONTEXT block carrying the mission,
 * archetype, operating locale/currency, who-we-serve / how-we-decide doctrine,
 * the stance vectors, and the decision-routing directive. Returns exactly the
 * base string when `bundle` is null (uninitialized deployment).
 *
 * The block is composed from a fixed set of short fields (no per-tool or
 * per-turn growth), so it stays economical in the model's context — it is sent
 * once at connect, not on every call.
 */
export function formatOrgContextInstructions(
  base: string,
  bundle: OrgContextBundle | null,
): string {
  if (!bundle) return base;

  const p = bundle.businessProfile;
  const who = bundle.organizationName ?? "this organization";
  const localeBits = [
    `operating locale ${bundle.locale.locale}`,
    `currency ${bundle.locale.currency}`,
    bundle.locale.countryCode ? `country ${bundle.locale.countryCode}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const archetypeBits = [bundle.archetypeName, bundle.industry]
    .filter(Boolean)
    .join(" · ");

  const stances = STANCE_VECTOR_KEYS.map((key) => {
    const s = bundle.stanceVectors[key];
    const ceiling =
      typeof s.ceilingUsd === "number" ? ` (authority ceiling ~$${s.ceilingUsd})` : "";
    return `- ${s.title}: ${s.stance}${ceiling}`;
  }).join("\n");

  const block = [
    `ORGANIZATION CONTEXT — you are interacting with the platform on behalf of ${who}. Ground every business decision, recommendation, and action in this context, not in generic defaults.`,
    bundle.mission ? `Mission: ${bundle.mission}` : `Mission theme: ${p.missionTheme}.`,
    archetypeBits ? `Business archetype: ${archetypeBits}.` : null,
    `Operating model: ${p.businessModel}`,
    localeBits ? `Where it operates: ${localeBits}.` : null,
    `Who we serve: ${p.whoWeServe}`,
    `How we decide: ${p.howWeDecide}`,
    `Supply/vendor posture: ${p.supplyChain}`,
    `Standing stances (owner-editable starters):\n${stances}`,
    `DECISION ROUTING: when you make a decision about operating THIS organization's business (pricing, staffing, customers, spend, growth), you act under the organization's own doctrine — call decision tools (e.g. principle_decide) with decisionDomain="org-business" so they are governed by the organization's WWWD profile, not platform/founder doctrine. For decisions about building the DPF platform itself, use decisionDomain="platform-development".`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `${base}\n\n${block}`;
}
