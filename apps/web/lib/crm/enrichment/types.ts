/**
 * Proactive, permissioned CRM enrichment — shared types (BI-B2497DFB).
 *
 * When a prospect/account/contact is created with scant detail, the coworker
 * offers (permission + scope confirmed) to enrich it from public sources, then
 * writes the augmented fields back WITH provenance and WITHOUT fabrication.
 * These types are the contract the deterministic core (completeness → offer →
 * proposal → apply) shares with the MCP tool layer.
 */

/** The record kinds enrichment understands. */
export type EnrichmentRecordKind = "customer-account" | "customer-contact";

/**
 * Public sources the coworker may research. `website` is the record's own
 * stored site (fetched by the platform, inside the egress boundary); the other
 * two are gathered by the coworker via its granted web-research tools.
 */
export type EnrichmentSourceKind = "website" | "linkedin" | "web-search";

export const ENRICHMENT_SOURCE_KINDS: readonly EnrichmentSourceKind[] = [
  "website",
  "linkedin",
  "web-search",
] as const;

/**
 * Enrichable fields, per record kind. Deliberately a closed set — the coworker
 * can only propose values for fields the platform knows how to store, and each
 * carries provenance. Values are strings as written to the record.
 */
export const ACCOUNT_ENRICHABLE_FIELDS = [
  "name",
  "website",
  "industry",
  "employeeCount",
  "location",
  "notes",
] as const;

export const CONTACT_ENRICHABLE_FIELDS = [
  "firstName",
  "lastName",
  "jobTitle",
  "phone",
  "linkedinUrl",
] as const;

export type AccountEnrichableField = (typeof ACCOUNT_ENRICHABLE_FIELDS)[number];
export type ContactEnrichableField = (typeof CONTACT_ENRICHABLE_FIELDS)[number];
export type EnrichableField = AccountEnrichableField | ContactEnrichableField;

/**
 * A single researched fact the coworker proposes to write. `value` is the raw
 * researched value; the no-fabrication guard decides whether it is
 * materializable. `sourceRef` is the citation (URL or search result id).
 */
export type EnrichmentFinding = {
  field: EnrichableField;
  value: string;
  source: EnrichmentSourceKind;
  sourceRef: string;
  /** 0..1 self-reported confidence; informational, not a gate. */
  confidence?: number;
};

/**
 * The human-confirmed scope of an enrichment run: which sources may be
 * consulted and which fields may be touched. A finding outside the scope is
 * dropped (AC2 — no research/write beyond what the human confirmed).
 */
export type EnrichmentScope = {
  sources: EnrichmentSourceKind[];
  fields: EnrichableField[];
};

/** Result of scoring how complete a record is. */
export type CompletenessResult = {
  recordKind: EnrichmentRecordKind;
  /** 0..1 — filled weighted fields over total weighted fields. */
  score: number;
  filled: EnrichableField[];
  missing: EnrichableField[];
  /** True when the record is thin enough to warrant an enrichment offer. */
  belowThreshold: boolean;
};

/**
 * The proactive offer surfaced to the human. `null` offer = suppressed (quiet
 * proactivity or an already-complete record). Names the sources + fields so the
 * human can confirm scope before any research runs.
 */
export type EnrichmentOffer = {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  /** Human-facing one-liner: "I can enrich this from public sources — want me to?" */
  message: string;
  proposedSources: EnrichmentSourceKind[];
  proposedFields: EnrichableField[];
  proactivityLevel: string;
  policyId: string;
};

/** One field the proposal will change, with before/after and provenance. */
export type EnrichmentFieldChange = {
  field: EnrichableField;
  current: string | null;
  proposed: string;
  source: EnrichmentSourceKind;
  sourceRef: string;
};

/** A field the human asked to fill that could not be verified from any source. */
export type EnrichmentGap = {
  field: EnrichableField;
  reason: string;
};

/**
 * The built enrichment proposal: the scant→enriched diff (changes), the
 * confirm-what's-needed gaps, and the findings that were rejected as
 * non-materializable (kept for transparency/audit, never written).
 */
export type EnrichmentProposal = {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  changes: EnrichmentFieldChange[];
  unresolvedGaps: EnrichmentGap[];
  /** Findings dropped by the no-fabrication guard (field + why). */
  rejected: Array<{ field: EnrichableField; value: string; reason: string }>;
  scope: EnrichmentScope;
};

/** Structured `reasons` payload persisted on the enrichment MdmStewardTask. */
export type EnrichmentTaskReasons = {
  changes: EnrichmentFieldChange[];
  unresolvedGaps: EnrichmentGap[];
  scope: EnrichmentScope;
  proactivity?: { level: string; policyId: string };
};

export function enrichableFieldsFor(kind: EnrichmentRecordKind): readonly EnrichableField[] {
  return kind === "customer-account" ? ACCOUNT_ENRICHABLE_FIELDS : CONTACT_ENRICHABLE_FIELDS;
}
