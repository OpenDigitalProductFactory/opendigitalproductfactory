/**
 * Proactive enrichment offer (BI-B2497DFB, AC1/AC2/AC8).
 *
 * Pure. Given a record's completeness and the resolved proactivity plan,
 * decides whether to OFFER enrichment and, if so, states which sources + fields
 * it would touch (the scope the human confirms before any research runs).
 *
 * Proactivity binding (AC8): the offer follows the resolved plan end-to-end —
 *   - quiet (`actionBoundary: "advise"`, maxAttempts 0) → suppressed (null);
 *   - balanced/assertive → an offer is returned.
 * A complete record never triggers an offer regardless of level.
 */
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import { scoreCompleteness } from "./completeness";
import {
  ENRICHMENT_SOURCE_KINDS,
  type CompletenessResult,
  type EnrichableField,
  type EnrichmentOffer,
  type EnrichmentRecordKind,
  type EnrichmentSourceKind,
} from "./types";

export type BuildOfferInput = {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  recordLabel: string;
  completeness: CompletenessResult;
  plan: ProactivityPlan;
};

/**
 * Contacts have no own-website to fetch, so a contact offer defaults to
 * linkedin + web-search; accounts default to all three (own website + public).
 */
function defaultSourcesFor(recordKind: EnrichmentRecordKind): EnrichmentSourceKind[] {
  if (recordKind === "customer-contact") {
    return ["linkedin", "web-search"];
  }
  return [...ENRICHMENT_SOURCE_KINDS];
}

export function buildEnrichmentOffer(input: BuildOfferInput): EnrichmentOffer | null {
  const { recordKind, recordId, recordLabel, completeness, plan } = input;

  // Suppressed at quiet (advise boundary = never volunteers an action) or when
  // the coworker has explicitly muted this suggestion.
  if (plan.actionBoundary === "advise" || plan.suggestionSuppressed) {
    return null;
  }
  // Nothing to offer on an already-complete record.
  if (!completeness.belowThreshold || completeness.missing.length === 0) {
    return null;
  }

  const proposedFields: EnrichableField[] = completeness.missing;
  const proposedSources = defaultSourcesFor(recordKind);
  const sourceLabel = proposedSources
    .map((s) => (s === "web-search" ? "web search" : s === "website" ? "their website" : "LinkedIn"))
    .join(", ");
  const fieldLabel = proposedFields.join(", ");

  const message =
    `"${recordLabel}" looks thin (${Math.round(completeness.score * 100)}% complete). ` +
    `I can research public sources (${sourceLabel}) to fill in ${fieldLabel} — ` +
    `want me to? I'll cite every source, leave anything I can't verify blank, and show you ` +
    `the changes before they're saved.`;

  return {
    recordKind,
    recordId,
    message,
    proposedSources,
    proposedFields,
    proactivityLevel: plan.resolvedLevel,
    policyId: plan.policyId,
  };
}

/**
 * Convenience for the create/import path (AC1): score the just-created record's
 * intake and build the offer in one step. `intake` is the raw create input or
 * the new row. Returns null when suppressed or complete.
 */
export function buildEnrichmentOfferForIntake(input: {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  recordLabel: string;
  intake: Record<string, unknown>;
  plan: ProactivityPlan;
}): EnrichmentOffer | null {
  const completeness = scoreCompleteness(input.recordKind, input.intake);
  return buildEnrichmentOffer({
    recordKind: input.recordKind,
    recordId: input.recordId,
    recordLabel: input.recordLabel,
    completeness,
    plan: input.plan,
  });
}
