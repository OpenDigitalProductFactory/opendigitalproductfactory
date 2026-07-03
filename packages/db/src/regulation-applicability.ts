/**
 * Region- and archetype-scoped regulatory applicability.
 *
 * A region-specific regulation (CADA, GDPR, DORA, CCPA, …) only carries impact
 * for an organization that has a NEXUS on one of its triggering dimensions —
 * and some regulations are specific to a business archetype. You must decide
 * *whether a regulation applies* (given where the org operates / sells / employs
 * / keeps data, and what kind of business it is) before assessing impact against
 * it. Assess only the regulations that apply; scoring an out-of-scope regulation
 * is noise.
 *
 * This reuses the same jurisdiction-with-basis model the profession corpus uses
 * to decide which knowledge to inject (`PROFESSION_JURISDICTION_BASES` in
 * wiki-taxonomy.ts) — so applicability is consistent across the knowledge layer
 * and the governance/assessment layer.
 */
import { type ProfessionJurisdictionBasis } from "./wiki-taxonomy";

/**
 * Corporate-law legal form / market-listing status — orthogonal to the industry
 * archetype (any archetype can be a listed or private company). Some governance
 * regimes gate on this dimension rather than industry: the UK Corporate
 * Governance Code applies to UK premium-listed companies, not to a "banking" or
 * "retail" archetype per se. `undefined` on a profile means undeclared.
 */
export const LISTING_STATUSES = [
  "premium-listed",
  "standard-listed",
  "aim-listed",
  "private",
  "other",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export function isListingStatus(value: string | null | undefined): value is ListingStatus {
  return typeof value === "string" && (LISTING_STATUSES as readonly string[]).includes(value);
}

/** An org's regional footprint + archetype. Jurisdiction values are bloc slugs (e.g. "eu", "us", "uk"). */
export interface RegionProfile {
  operatesIn: string[];
  sellsTo: string[];
  employsIn: string[];
  dataResidency: string[];
  /** Business archetype slug (storefront/archetype), when known. */
  archetype?: string;
  /** Market-listing / legal-form status (LISTING_STATUSES), when declared. */
  listingStatus?: string;
}

export interface RegulationApplicability {
  /** Which region dimensions put an org in scope. `global` = applies everywhere. */
  basis: ProfessionJurisdictionBasis[];
  /** Jurisdiction bloc slugs that trigger it on those bases (ignored for `global`). */
  jurisdictions: string[];
  /** If set, only these business archetypes are in scope; otherwise archetype-agnostic. */
  archetypes?: string[];
  /**
   * If set, only these listing statuses are in scope (e.g. `["premium-listed"]`
   * for a rule that binds only UK premium-listed companies). An undeclared
   * listing status is treated as NOT-in-scope by {@link regulationApplies} — the
   * classifier layer decides whether that surfaces as "review" (unknown) rather
   * than "reference" (known out-of-scope). Omitted = listing-status-agnostic.
   */
  listingStatuses?: string[];
}

export interface ApplicabilityResult {
  applies: boolean;
  reason: string;
  matchedBasis: ProfessionJurisdictionBasis[];
}

function setForBasis(profile: RegionProfile, basis: ProfessionJurisdictionBasis): string[] {
  switch (basis) {
    case "operating":
      return profile.operatesIn;
    case "selling":
      return profile.sellsTo;
    case "employing":
      return profile.employsIn;
    case "data-residency":
      return profile.dataResidency;
    case "global":
      return [];
  }
}

/** Decide whether a region/archetype-specific regulation applies to an org. */
export function regulationApplies(
  spec: RegulationApplicability,
  profile: RegionProfile,
): ApplicabilityResult {
  // Archetype gate — a regulation can be specific to a business archetype.
  if (spec.archetypes && spec.archetypes.length > 0) {
    const a = profile.archetype;
    if (!a || !spec.archetypes.includes(a)) {
      return {
        applies: false,
        reason: `business archetype ${a ? `'${a}'` : "(undeclared)"} is out of scope (applies to: ${spec.archetypes.join(", ")})`,
        matchedBasis: [],
      };
    }
  }
  // Listing-status gate — a regulation can bind only certain legal forms (e.g.
  // UK premium-listed companies). An undeclared status fails the gate here; the
  // classifier decides whether that reads as "review" (unknown) vs "reference".
  if (spec.listingStatuses && spec.listingStatuses.length > 0) {
    const s = profile.listingStatus;
    if (!s || !spec.listingStatuses.includes(s)) {
      return {
        applies: false,
        reason: `listing status ${s ? `'${s}'` : "(undeclared)"} is out of scope (applies to: ${spec.listingStatuses.join(", ")})`,
        matchedBasis: [],
      };
    }
  }
  // Global regulations apply wherever the relevant capability exists (e.g. PCI-DSS).
  if (spec.basis.includes("global")) {
    return { applies: true, reason: "applies globally — no regional nexus required", matchedBasis: ["global"] };
  }
  // Region-specific: in scope if any triggering dimension intersects the regulation's jurisdictions.
  const jset = new Set(spec.jurisdictions.map((j) => j.toLowerCase()));
  const matched = spec.basis.filter((b) =>
    setForBasis(profile, b).some((j) => jset.has(j.toLowerCase())),
  );
  if (matched.length > 0) {
    return {
      applies: true,
      reason: `regional nexus via ${matched.join("/")} in ${spec.jurisdictions.join("/")}`,
      matchedBasis: matched,
    };
  }
  return {
    applies: false,
    reason: `no ${spec.basis.join("/")} nexus in ${spec.jurisdictions.join("/")} declared — out of scope`,
    matchedBasis: [],
  };
}

/**
 * CADA applies to organizations OPERATING in the EU (public bodies / NIS2
 * essential entities) and their SUPPLIERS SELLING into the EU public sector.
 * Data-residency is an obligation CADA imposes once in scope, not the trigger —
 * an org with no EU operating/selling nexus is out of scope. CADA is not
 * archetype-restricted (it spans public-sector, critical-sector, and suppliers).
 */
export const CADA_APPLICABILITY: RegulationApplicability = {
  basis: ["operating", "selling"],
  jurisdictions: ["eu"],
};

/**
 * The UK Corporate Governance Code (FRC, 2024 edition) — and specifically its
 * Provision 29 board internal-controls accountability declaration — applies to
 * companies with a UK premium listing (in practice the FTSE 350 and other
 * premium-listed companies). It binds on the OPERATING basis (a UK-incorporated /
 * UK-listed company), and gates on listing status: standard-listed, AIM-listed,
 * and private companies are out of scope (the Code is "comply or explain" under
 * the premium-listing regime, not statute). Provision 29 first bites for
 * accounting periods beginning on or after 1 January 2026.
 */
export const UK_CORP_GOV_CODE_APPLICABILITY: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["uk"],
  listingStatuses: ["premium-listed"],
};
