// EP-DATA-RETENTION — Archetype / industry retention floors.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md §7
//
// "Research and implement what makes sense ... and archetype considerations."
// A retention window that is fine for a coffee shop is illegal for a bank. The
// archetype/industry an install operates as (StorefrontConfig.archetypeId →
// category, mirrored on Organization.industry) raises the floor on certain
// categories. Floors only ever LENGTHEN retention — effective = max(base,
// floor) — so an industry rule can never make the platform delete sooner than a
// regulator allows, and the conservative base always wins when no floor exists.
//
// Keys are archetype CATEGORY ids (the values used by Organization.industry and
// the storefront-templates archetype categories), not leaf archetype ids, so a
// whole industry inherits one floor set. A leaf archetype that needs more can be
// added as its own key later.

import {
  YEARS_7_IN_DAYS,
  YEARS_6_IN_DAYS,
  YEARS_3_IN_DAYS,
  DAYS_365,
} from "./constants";
import type { RetentionCategory, RetentionPrismaClient } from "./policies";

export type IndustryRetentionFloor = Partial<Record<RetentionCategory, number>>;

/**
 * Minimum retention days per category, keyed by archetype/industry category.
 * Sources cited in the spec's Research & Benchmarking section. These are
 * deliberately conservative defaults an operator can extend; they encode the
 * "many business models require 7-year financial records" requirement and its
 * sector cousins (HIPAA ~6y clinical, public-records ~3y).
 */
export const INDUSTRY_RETENTION_FLOORS: Record<string, IndustryRetentionFloor> = {
  // Banks / credit unions / lenders — BSA/AML + financial-advice record rules.
  "banking-financial-services": {
    "audit-log": YEARS_7_IN_DAYS,
    "security-audit": YEARS_7_IN_DAYS,
    "routing-log": DAYS_365,
    "ai-telemetry": DAYS_365,
    "coworker-chat": YEARS_7_IN_DAYS, // coworker may give financial guidance
    "coworker-metrics": DAYS_365,
  },
  // Accounting / legal / consultancy — 7-year professional record norms.
  "professional-services": {
    "audit-log": YEARS_7_IN_DAYS,
    "security-audit": YEARS_7_IN_DAYS,
    "coworker-chat": YEARS_7_IN_DAYS,
  },
  // Clinics / dental / therapy — HIPAA-adjacent ~6-year floor.
  "healthcare-wellness": {
    "audit-log": YEARS_6_IN_DAYS,
    "security-audit": YEARS_6_IN_DAYS,
    "coworker-chat": YEARS_6_IN_DAYS,
  },
  // Municipal / civic — public-records-law ~3-year floor.
  "public-sector": {
    "audit-log": YEARS_3_IN_DAYS,
    "security-audit": YEARS_3_IN_DAYS,
    "coworker-chat": YEARS_3_IN_DAYS,
  },
};

/**
 * Aliases mapping the many ways an industry is spelled (Organization.industry
 * is freeform / seed-derived, e.g. "financial"; archetype categories are
 * "banking-financial-services") onto a canonical floor key. Resilience here is
 * deliberate: a missed alias only means floors don't apply (safe — base
 * windows + RETAINED_DATASETS still protect regulated records), never an
 * over-eager delete.
 */
export const INDUSTRY_ALIASES: Record<string, string> = {
  // banking / financial
  financial: "banking-financial-services",
  finance: "banking-financial-services",
  banking: "banking-financial-services",
  bank: "banking-financial-services",
  "community-bank": "banking-financial-services",
  "credit-union": "banking-financial-services",
  "mortgage-lending": "banking-financial-services",
  fintech: "banking-financial-services",
  "banking-financial-services": "banking-financial-services",
  // professional services
  legal: "professional-services",
  law: "professional-services",
  "law-firm": "professional-services",
  accounting: "professional-services",
  consulting: "professional-services",
  "professional-services": "professional-services",
  // healthcare
  health: "healthcare-wellness",
  healthcare: "healthcare-wellness",
  medical: "healthcare-wellness",
  wellness: "healthcare-wellness",
  "healthcare-wellness": "healthcare-wellness",
  // public sector
  government: "public-sector",
  municipal: "public-sector",
  civic: "public-sector",
  "public-sector": "public-sector",
};

/**
 * Effective retention for a policy under an install's industry.
 * `max(base, floor)` — floors lengthen, never shorten. Unknown industry or
 * uncovered category falls through to the policy's conservative base.
 */
export function resolveEffectiveRetentionDays(
  policy: { category: RetentionCategory; baseRetentionDays: number },
  industryKey: string | null | undefined,
  confirmedProcessingActivityFloorDays = 0,
): number {
  const floorKey = industryKey != null ? toFloorKey(industryKey) : null;
  const floor =
    floorKey != null
      ? INDUSTRY_RETENTION_FLOORS[floorKey]?.[policy.category]
      : undefined;
  return Math.max(
    policy.baseRetentionDays,
    floor ?? 0,
    confirmedProcessingActivityFloorDays,
  );
}

/**
 * Resolve the install's industry for floor lookup. DPF is single-org-per-install
 * (project: single-org-per-install), so this reads the one Organization's
 * industry. Returns null when unset — the conservative base windows then apply
 * unchanged, and regulated records remain protected by RETAINED_DATASETS
 * regardless of industry.
 *
 * Defensive: any read failure resolves to null (apply base windows) rather than
 * throwing — a retention sweep must never abort because industry is unreadable.
 */
export async function resolveOrgIndustryKey(
  prisma: unknown,
): Promise<string | null> {
  try {
    const db = prisma as {
      organization?: {
        findFirst(args: unknown): Promise<{ industry: string | null } | null>;
      };
    };
    const org = await db.organization?.findFirst({
      where: { industry: { not: null } },
      select: { industry: true },
    });
    return org?.industry ? toFloorKey(org.industry) : null;
  } catch {
    // Industry is an optimization for floors; never block a sweep on it.
    return null;
  }
}

/** Normalize a raw industry string to its canonical floor key (or normalized
 *  form when no alias matches — still safe, it just won't hit a floor). */
export function toFloorKey(raw: string): string {
  const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return INDUSTRY_ALIASES[normalized] ?? normalized;
}

// Re-export for callers that only need the type.
export type { RetentionPrismaClient };
