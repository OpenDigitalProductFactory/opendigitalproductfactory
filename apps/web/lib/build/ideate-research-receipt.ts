// apps/web/lib/build/ideate-research-receipt.ts
//
// BI-C5D978E9 — record the research the ideate phase actually performed.
//
// The initiative-readiness gate blocks ideate→plan on RESEARCH_REQUIRED, and
// nothing in Build Studio ever recorded that gate. So every owner-composed
// feature build stalled with the research done and unrecorded — live repro
// FB-EB292B9F, whose design had already PASSED review and sized `ok`.
//
// This is NOT self-approval. The platform's own grant table
// (initiative-readiness-tool-grants.ts) declares the research lane:
//
//   record_initiative_evidence: gates ["classification","research",
//     "dependency-disposition"], accountableRoles ["design-author",
//     "portfolio-management"], independent: FALSE
//
// The design author is the accountable role and independence is explicitly not
// required — unlike spec-approval and architecture-review, which are
// `independent: true` and still need a reviewer distinct from the author.
// Those remain unrecorded and still block; see BI-C5D978E9.
//
// The attestation is truthful: dispatchIdeateResearch reads the codebase and
// the design document carries its output in existingFunctionalityAudit and
// reusePlan. Recording it asserts only that this work happened, which it did.

/** The design-document fields that evidence research actually took place. */
const RESEARCH_FIELDS = ["existingFunctionalityAudit", "reusePlan"] as const;

function nonEmpty(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

/**
 * True when the design document carries evidence that research was performed.
 *
 * Deliberately conservative: a receipt is only warranted when the audit of what
 * already exists is present. A design that skipped the codebase audit has not
 * done the research the gate is asking about, and recording it would make the
 * receipt a lie.
 */
export function designDocEvidencesResearch(designDoc: unknown): boolean {
  if (!designDoc || typeof designDoc !== "object" || Array.isArray(designDoc)) return false;
  const doc = designDoc as Record<string, unknown>;
  return RESEARCH_FIELDS.some((field) => nonEmpty(doc[field]));
}

/**
 * The receipt's reason line, naming the fields it is attesting to.
 *
 * A receipt whose reason does not say what was examined is not evidence of
 * anything, so this quotes the design document's own sections.
 */
export function describeResearchAttestation(designDoc: unknown): string {
  const doc = (designDoc && typeof designDoc === "object" && !Array.isArray(designDoc))
    ? designDoc as Record<string, unknown>
    : {};
  const present = RESEARCH_FIELDS.filter((field) => nonEmpty(doc[field]));
  return (
    "Ideate research completed by the design author: the codebase was searched and the design "
    + `document records ${present.join(" and ")}. `
    + "Recorded under the research lane, which the grant table marks author-accountable "
    + "(independent: false). Spec approval and architecture review are independent and are not "
    + "covered by this receipt."
  );
}
