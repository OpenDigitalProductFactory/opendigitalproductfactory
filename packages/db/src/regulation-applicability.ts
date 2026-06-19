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

/** An org's regional footprint + archetype. Jurisdiction values are bloc slugs (e.g. "eu", "us", "uk"). */
export interface RegionProfile {
  operatesIn: string[];
  sellsTo: string[];
  employsIn: string[];
  dataResidency: string[];
  /** Business archetype slug (storefront/archetype), when known. */
  archetype?: string;
}

export interface RegulationApplicability {
  /** Which region dimensions put an org in scope. `global` = applies everywhere. */
  basis: ProfessionJurisdictionBasis[];
  /** Jurisdiction bloc slugs that trigger it on those bases (ignored for `global`). */
  jurisdictions: string[];
  /** If set, only these business archetypes are in scope; otherwise archetype-agnostic. */
  archetypes?: string[];
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
