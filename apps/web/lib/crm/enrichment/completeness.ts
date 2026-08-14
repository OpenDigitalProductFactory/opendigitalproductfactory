/**
 * CRM record completeness / gap detection (BI-B2497DFB, AC1).
 *
 * Pure, DB-free. Scores how much of a record's enrichable surface is filled so
 * the enrichment offer can fire only on genuinely thin intake. "Thin" is not
 * "any field blank" — a record can be legitimately sparse; the threshold is
 * tuned so a bare name+website account does NOT nag, but a name-only prospect
 * (the worked-example shape: "Greg Torosian — franchise owner, TeamLogic IT,
 * Austin") does.
 */
import {
  ACCOUNT_ENRICHABLE_FIELDS,
  CONTACT_ENRICHABLE_FIELDS,
  type CompletenessResult,
  type EnrichableField,
  type EnrichmentRecordKind,
} from "./types";

/**
 * Field weights — identity/anchor fields count more than colour. A record is
 * "complete enough" when its filled weight clears the threshold; missing
 * low-weight fields alone will not drop it below.
 */
const ACCOUNT_WEIGHTS: Record<string, number> = {
  name: 2,
  website: 2,
  industry: 1,
  employeeCount: 1,
  location: 1,
  notes: 1,
};

const CONTACT_WEIGHTS: Record<string, number> = {
  firstName: 2,
  lastName: 1,
  jobTitle: 1,
  phone: 1,
  linkedinUrl: 1,
};

/** At or below this filled-weight fraction the record warrants an offer. */
export const COMPLETENESS_OFFER_THRESHOLD = 0.5;

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

function score(
  recordKind: EnrichmentRecordKind,
  fields: readonly EnrichableField[],
  weights: Record<string, number>,
  record: Record<string, unknown>,
): CompletenessResult {
  const filled: EnrichableField[] = [];
  const missing: EnrichableField[] = [];
  let totalWeight = 0;
  let filledWeight = 0;
  for (const field of fields) {
    const weight = weights[field] ?? 1;
    totalWeight += weight;
    if (isFilled(record[field])) {
      filled.push(field);
      filledWeight += weight;
    } else {
      missing.push(field);
    }
  }
  const ratio = totalWeight === 0 ? 1 : filledWeight / totalWeight;
  return {
    recordKind,
    score: Math.round(ratio * 100) / 100,
    filled,
    missing,
    // Strict `<`: a name+website account (exactly at the threshold) does not
    // nag; a name-only prospect (below it) does.
    belowThreshold: ratio < COMPLETENESS_OFFER_THRESHOLD,
  };
}

/**
 * Score a customer account. Accepts a loose record so callers can pass either a
 * Prisma row or the create-tool input. `location` is derived from any of
 * city/region/location fields the caller supplies.
 */
export function scoreAccountCompleteness(
  account: Record<string, unknown> & { location?: unknown; city?: unknown },
): CompletenessResult {
  const normalized: Record<string, unknown> = {
    ...account,
    location: account["location"] ?? account["city"] ?? account["region"],
  };
  return score("customer-account", ACCOUNT_ENRICHABLE_FIELDS, ACCOUNT_WEIGHTS, normalized);
}

/** Score a customer contact. */
export function scoreContactCompleteness(
  contact: Record<string, unknown>,
): CompletenessResult {
  return score("customer-contact", CONTACT_ENRICHABLE_FIELDS, CONTACT_WEIGHTS, contact);
}

export function scoreCompleteness(
  recordKind: EnrichmentRecordKind,
  record: Record<string, unknown>,
): CompletenessResult {
  return recordKind === "customer-account"
    ? scoreAccountCompleteness(record)
    : scoreContactCompleteness(record);
}
