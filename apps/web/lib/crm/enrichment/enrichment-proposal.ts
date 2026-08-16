/**
 * Enrichment proposal builder (BI-B2497DFB, AC3/AC5/AC6).
 *
 * Pure. Turns researched findings into a governed proposal:
 *   - drops findings outside the human-confirmed scope (AC2 enforcement here);
 *   - routes every in-scope finding through the no-fabrication guard, moving
 *     rejects to `rejected` (never written) — AC4;
 *   - computes the scant→enriched diff (current → proposed) — AC5;
 *   - surfaces requested fields that no source could verify as
 *     `unresolvedGaps` — the confirm-what's-needed loop (AC6).
 *
 * No field is written here; this only shapes the proposal. The service layer
 * files it to the steward queue and (on approval) applies it with provenance.
 */
import { evaluateMaterializability } from "./no-fabrication";
import { assessIdentity } from "./identity-resolution";
import {
  type EnrichableField,
  type EnrichmentAnchor,
  type EnrichmentFieldChange,
  type EnrichmentFinding,
  type EnrichmentGap,
  type EnrichmentProposal,
  type EnrichmentRecordKind,
  type EnrichmentScope,
  enrichableFieldsFor,
} from "./types";

export type BuildProposalInput = {
  recordKind: EnrichmentRecordKind;
  recordId: string;
  /** Current record values (Prisma row or equivalent). */
  current: Record<string, unknown>;
  findings: EnrichmentFinding[];
  scope: EnrichmentScope;
  /**
   * The identity the coworker resolved during research (domain it settled on,
   * etc.). Optional — when omitted the anchor is inferred from a `website`
   * finding. Used by the identity-resolution gate (BI-E2449835).
   */
  anchor?: EnrichmentAnchor | null;
};

function currentString(current: Record<string, unknown>, field: EnrichableField): string | null {
  const value = current[field];
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function sameValue(a: string | null, b: string): boolean {
  if (a === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Build the proposal. Multiple findings for one field are resolved by highest
 * confidence, then first-seen; a finding equal to the current value is a no-op
 * (not a change). A scoped field left with no materializable value becomes a
 * gap only when the record is currently empty for it.
 */
export function buildEnrichmentProposal(input: BuildProposalInput): EnrichmentProposal {
  const { recordKind, recordId, current, scope } = input;

  // Identity-resolution gate (BI-E2449835): confirm the researched entity is the
  // SAME company as the record BEFORE harvesting anything. A domain conflict is
  // decisive — refuse and file nothing (a same-named different company).
  const { recordAnchor, researchedAnchor, match } = assessIdentity(current, input.findings, input.anchor);
  if (match.verdict === "conflict") {
    return {
      recordKind,
      recordId,
      changes: [],
      unresolvedGaps: [],
      rejected: [],
      scope,
      identity: match,
      blocked: {
        reason:
          `Identity conflict: the record's domain (${recordAnchor.domain ?? "?"}) does not match the ` +
          `researched domain (${researchedAnchor.domain ?? "?"}). This looks like a different company ` +
          `with a similar name — confirm the right company before enriching.`,
        recordAnchor,
        researchedAnchor,
      },
    };
  }

  const allowedFields = new Set<EnrichableField>(
    scope.fields.filter((f) => (enrichableFieldsFor(recordKind) as readonly string[]).includes(f)),
  );
  const allowedSources = new Set(scope.sources);

  const rejected: EnrichmentProposal["rejected"] = [];
  // field -> best candidate finding
  const bestByField = new Map<EnrichableField, EnrichmentFinding>();

  for (const finding of input.findings) {
    if (!allowedFields.has(finding.field)) continue; // out of confirmed field scope
    if (!allowedSources.has(finding.source)) continue; // out of confirmed source scope

    const verdict = evaluateMaterializability(finding.field, finding.value);
    if (!verdict.materializable) {
      rejected.push({ field: finding.field, value: finding.value, reason: verdict.reason });
      continue;
    }

    const incumbent = bestByField.get(finding.field);
    if (!incumbent) {
      bestByField.set(finding.field, finding);
      continue;
    }
    const incumbentConf = incumbent.confidence ?? 0;
    const challengerConf = finding.confidence ?? 0;
    if (challengerConf > incumbentConf) {
      bestByField.set(finding.field, finding);
    }
  }

  const changes: EnrichmentFieldChange[] = [];
  for (const [field, finding] of bestByField) {
    const current_ = currentString(current, field);
    if (sameValue(current_, finding.value)) continue; // no-op, already correct
    changes.push({
      field,
      current: current_,
      proposed: finding.value.trim(),
      source: finding.source,
      sourceRef: finding.sourceRef,
      ...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
      ...(finding.retrievedAt ? { retrievedAt: finding.retrievedAt } : {}),
      ...(finding.supportingPassage ? { supportingPassage: finding.supportingPassage } : {}),
    });
  }
  changes.sort((a, b) => a.field.localeCompare(b.field));

  // Confirm-what's-needed: a scoped field that is currently empty and got no
  // materializable value. Fields that were rejected as masked/partial are the
  // canonical case (the worked example's masked work email).
  const unresolvedGaps: EnrichmentGap[] = [];
  for (const field of allowedFields) {
    if (bestByField.has(field)) continue; // filled by a change
    if (currentString(current, field) !== null) continue; // already had a value
    const wasRejected = rejected.find((r) => r.field === field);
    unresolvedGaps.push({
      field,
      reason: wasRejected
        ? `only a masked/partial value was public (${wasRejected.reason}) — left blank; please confirm`
        : "no public source verified this — left blank; please confirm",
    });
  }
  unresolvedGaps.sort((a, b) => a.field.localeCompare(b.field));

  return { recordKind, recordId, changes, unresolvedGaps, rejected, scope, identity: match };
}
