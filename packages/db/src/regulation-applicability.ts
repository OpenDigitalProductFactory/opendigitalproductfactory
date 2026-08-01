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

/**
 * What an organization DOES with data / how it operates — the triggers that
 * put it in scope of a HORIZONTAL regulation (privacy, payment security, AI
 * governance, consumer-protection, accessibility). Unlike the vertical packs,
 * these regimes bind on activity, not on industry archetype: a software
 * platform, a retailer, and a gym all face CCPA the moment they process
 * personal data of California consumers. Closed set — adding a predicate is a
 * data-model change, not a free-form string, so specs and the setup interview
 * stay in lockstep.
 */
export const DATA_HANDLING_PREDICATES = [
  "processes-personal-data", // any identifiable individual's data → privacy + breach-notification regimes
  "serves-consumers", // sells to / serves individual consumers (not just businesses) → consumer-protection
  "handles-card-data", // stores/processes/transmits payment card data → PCI-DSS
  "deploys-automated-decisioning", // AI/automated decisions affecting people → AI-governance regimes
  "sends-marketing", // commercial email / SMS / calls → CAN-SPAM, TCPA, ePrivacy
  "publicly-accessible-service", // public-facing website/app → accessibility (ADA/WCAG, EAA)
  "handles-health-data", // protected health information → HIPAA overlay
  "handles-financial-data", // consumer financial data → GLBA overlay
  "handles-education-data", // student education records → FERPA overlay
  "government-customers", // sells to government/public sector → FedRAMP / gov overlays
] as const;
export type DataHandlingPredicate = (typeof DATA_HANDLING_PREDICATES)[number];

export function isDataHandlingPredicate(value: string | null | undefined): value is DataHandlingPredicate {
  return typeof value === "string" && (DATA_HANDLING_PREDICATES as readonly string[]).includes(value);
}

/** An org's regional footprint + archetype. Jurisdiction values are bloc slugs (e.g. "eu", "us", "uk"). */
export interface RegionProfile {
  operatesIn: string[];
  sellsTo: string[];
  employsIn: string[];
  dataResidency: string[];
  /**
   * What the org does with data / how it operates (DATA_HANDLING_PREDICATES),
   * as declared at company setup. Drives horizontal-regulation scoping. An
   * empty/undeclared set means a data-handling-gated regulation surfaces as
   * "review" (we need to ask) rather than "reference" (known out of scope).
   */
  dataHandling?: DataHandlingPredicate[];
  /** Business archetype CATEGORY slug (StorefrontArchetype.category), when known. */
  archetype?: string;
  /**
   * Specific archetype id (StorefrontArchetype.archetypeId), when known. Some
   * regimes bind finer than the category: NCUA binds a `credit-union` but not a
   * `community-bank` (both category banking-financial-services); POST/CJIS bind
   * a `law-enforcement-agency` but not a `small-town-municipality` (both
   * category public-sector).
   */
  archetypeId?: string;
  /** Market-listing / legal-form status (LISTING_STATUSES), when declared. */
  listingStatus?: string;
}

export interface RegulationApplicability {
  /** Which region dimensions put an org in scope. `global` = applies everywhere. */
  basis: ProfessionJurisdictionBasis[];
  /** Jurisdiction bloc slugs that trigger it on those bases (ignored for `global`). */
  jurisdictions: string[];
  /**
   * If set, only these business archetypes are in scope; otherwise
   * archetype-agnostic. Entries may be archetype ids (`credit-union`) or
   * category slugs (`banking-financial-services`) — the gate matches either,
   * so a spec can bind a whole category or a single archetype.
   */
  archetypes?: string[];
  /**
   * If set, only these listing statuses are in scope (e.g. `["premium-listed"]`
   * for a rule that binds only UK premium-listed companies). An undeclared
   * listing status is treated as NOT-in-scope by {@link regulationApplies} — the
   * classifier layer decides whether that surfaces as "review" (unknown) rather
   * than "reference" (known out-of-scope). Omitted = listing-status-agnostic.
   */
  listingStatuses?: string[];
  /**
   * If set, the org must declare AT LEAST ONE of these data-handling predicates
   * to be in scope — the trigger for a HORIZONTAL regulation (e.g.
   * `["processes-personal-data"]` for a privacy law, `["handles-card-data"]`
   * for PCI-DSS). Composes with basis/jurisdictions: a privacy law is typically
   * `basis:["operating"], jurisdictions:["us"], dataHandling:["processes-personal-data"]`
   * — in scope only when the org operates in the US AND processes personal data.
   * An undeclared data-handling profile surfaces as "review". Omitted =
   * data-handling-agnostic (the vertical packs).
   */
  dataHandling?: DataHandlingPredicate[];
}

export interface ApplicabilityResult {
  applies: boolean;
  reason: string;
  matchedBasis: ProfessionJurisdictionBasis[];
  /**
   * When applies=false: true if the org is out of scope ONLY because a required
   * signal is UNDECLARED (empty/null) rather than declared-and-mismatched. This
   * lets a generic classifier map the result to "needs review" (could be in
   * scope once the operator captures the signal) vs "reference" (known out of
   * scope). Always false when applies=true.
   */
  undeclared: boolean;
}

export interface ConfirmedProcessingAuthorityResult {
  confirmed: boolean;
  reason: string;
}

/**
 * Resolve whether an organization-owned, confirmed processing activity links a
 * legacy regulation record. Regional/archetype matching can nominate a record
 * for review, but it cannot create organization-specific processing authority.
 */
export function resolveConfirmedProcessingAuthority(
  regulationId: string,
  confirmedAuthorityRefs: readonly string[],
): ConfirmedProcessingAuthorityResult {
  const normalizedId = regulationId.trim();
  const confirmed = normalizedId.length > 0 && confirmedAuthorityRefs.includes(normalizedId);
  return {
    confirmed,
    reason: confirmed
      ? `confirmed processing activity links ${normalizedId}`
      : `no confirmed processing activity links ${normalizedId || "the regulation"}`,
  };
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

/** One gate's verdict: passing, or failing because a signal is undeclared vs declared-and-mismatched. */
type GateResult =
  | { pass: true; matchedBasis?: ProfessionJurisdictionBasis[] }
  | { pass: false; undeclared: boolean; reason: string };

function archetypeGate(spec: RegulationApplicability, profile: RegionProfile): GateResult {
  if (!spec.archetypes || spec.archetypes.length === 0) return { pass: true };
  const declared = [profile.archetypeId, profile.archetype].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (declared.some((v) => spec.archetypes!.includes(v))) return { pass: true };
  const label = declared.length > 0 ? `'${declared.join("' / '")}'` : "(undeclared)";
  return {
    pass: false,
    undeclared: declared.length === 0, // no archetype declared at all → reviewable, not a definitive miss
    reason: `business archetype ${label} is out of scope (applies to: ${spec.archetypes.join(", ")})`,
  };
}

function listingGate(spec: RegulationApplicability, profile: RegionProfile): GateResult {
  if (!spec.listingStatuses || spec.listingStatuses.length === 0) return { pass: true };
  const s = profile.listingStatus;
  if (s && spec.listingStatuses.includes(s)) return { pass: true };
  return {
    pass: false,
    undeclared: !s,
    reason: `listing status ${s ? `'${s}'` : "(undeclared)"} is out of scope (applies to: ${spec.listingStatuses.join(", ")})`,
  };
}

function dataHandlingGate(spec: RegulationApplicability, profile: RegionProfile): GateResult {
  if (!spec.dataHandling || spec.dataHandling.length === 0) return { pass: true };
  const declared = profile.dataHandling ?? [];
  const matched = spec.dataHandling.filter((p) => declared.includes(p));
  if (matched.length > 0) return { pass: true };
  return {
    pass: false,
    // Nothing declared at all → reviewable (we haven't asked what they do with
    // data yet). A declared set that simply doesn't intersect → definitive miss.
    undeclared: declared.length === 0,
    reason:
      declared.length === 0
        ? `data-handling profile undeclared (applies when the org does: ${spec.dataHandling.join(", ")})`
        : `data-handling profile [${declared.join(", ")}] does not include a trigger (applies to: ${spec.dataHandling.join(", ")})`,
  };
}

function nexusGate(spec: RegulationApplicability, profile: RegionProfile): GateResult {
  // Global regulations apply wherever the relevant capability exists (e.g. PCI-DSS).
  if (spec.basis.includes("global")) return { pass: true, matchedBasis: ["global"] };
  const jset = new Set(spec.jurisdictions.map((j) => j.toLowerCase()));
  const matched = spec.basis.filter((b) => setForBasis(profile, b).some((j) => jset.has(j.toLowerCase())));
  if (matched.length > 0) return { pass: true, matchedBasis: matched };
  // No nexus. If the org has declared NOTHING on any triggering dimension it's
  // undeclared (reviewable); if it declared a footprint that simply doesn't
  // intersect, it's a definitive miss (reference).
  const anyDeclared = spec.basis.some((b) => setForBasis(profile, b).length > 0);
  return {
    pass: false,
    undeclared: !anyDeclared,
    reason: anyDeclared
      ? `no ${spec.basis.join("/")} nexus in ${spec.jurisdictions.join("/")} — out of scope`
      : `no ${spec.basis.join("/")} nexus in ${spec.jurisdictions.join("/")} declared — out of scope`,
  };
}

/**
 * Decide whether a region/archetype/listing-specific regulation applies to an
 * org. Generic and data-driven: the spec fully parameterizes the decision, so
 * one evaluator serves every governance requirement. Gates compose — a
 * DECLARED-and-mismatched signal on any gate is a definitive out-of-scope
 * (reference); otherwise an undeclared signal is reviewable.
 */
export function regulationApplies(
  spec: RegulationApplicability,
  profile: RegionProfile,
): ApplicabilityResult {
  const gates = [
    archetypeGate(spec, profile),
    listingGate(spec, profile),
    dataHandlingGate(spec, profile),
    nexusGate(spec, profile),
  ];
  const failed = gates.filter((g): g is Extract<GateResult, { pass: false }> => !g.pass);

  if (failed.length === 0) {
    const matchedBasis = gates.flatMap((g) => (g.pass ? (g.matchedBasis ?? []) : []));
    const reason = matchedBasis.includes("global")
      ? "applies globally — no regional nexus required"
      : `regional nexus via ${matchedBasis.join("/")} in ${spec.jurisdictions.join("/")}`;
    return { applies: true, reason, matchedBasis, undeclared: false };
  }

  // A declared mismatch is definitive (reference); pick it over an undeclared
  // reason. Only when EVERY failing gate is undeclared is the whole result
  // reviewable.
  const declaredMiss = failed.find((g) => !g.undeclared);
  const chosen = declaredMiss ?? failed[0];
  return {
    applies: false,
    reason: chosen.reason,
    matchedBasis: [],
    undeclared: !declaredMiss,
  };
}

/**
 * Safely parse a stored applicability spec (the `Regulation.applicability` JSON
 * column) into a RegulationApplicability, or null when absent/malformed. A null
 * result means "no data-driven spec" — the caller falls back to legacy matching.
 */
export function parseApplicability(value: unknown): RegulationApplicability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const basis = v.basis;
  const jurisdictions = v.jurisdictions;
  if (!Array.isArray(basis) || !basis.every((b) => typeof b === "string")) return null;
  if (!Array.isArray(jurisdictions) || !jurisdictions.every((j) => typeof j === "string")) return null;
  const spec: RegulationApplicability = {
    basis: basis as ProfessionJurisdictionBasis[],
    jurisdictions: jurisdictions as string[],
  };
  if (Array.isArray(v.archetypes) && v.archetypes.every((a) => typeof a === "string")) {
    spec.archetypes = v.archetypes as string[];
  }
  if (Array.isArray(v.listingStatuses) && v.listingStatuses.every((s) => typeof s === "string")) {
    spec.listingStatuses = v.listingStatuses as string[];
  }
  if (Array.isArray(v.dataHandling) && v.dataHandling.every((p) => typeof p === "string")) {
    // Keep only recognized predicates — an unknown string would silently never
    // match any declared profile, which reads as "always out of scope".
    const known = (v.dataHandling as string[]).filter(isDataHandlingPredicate);
    if (known.length > 0) spec.dataHandling = known;
  }
  return spec;
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
