// Docs-impact disposition at Workroom handoff (BI-9B17E889).
//
// The doc-impact graph (apps/web/lib/docs/doc-impact.generated.json) says which
// published pages describe a file. Until this record, a Workroom learned that only
// at push time, when the Docs Impact Gate demanded a `Docs-Impact-Decision:`
// trailer, so authors wrote the trailer instead of the page. A room's edit-path
// claim now carries the affected docs in its change-impact contract
// (`gateContext.docsImpact`, from scripts/lib/gate-context.mjs). This module
// holds the other half: before the room hands off for review, each pending doc
// has a recorded disposition, `updated` or `not-affected` with a reason.
//
// It reads two records the room already has and adds no table: the persisted
// change-impact contract, and `docs-impact-disposition` evidence on the room's
// activity log. A room whose claimed paths touch no documented code owes nothing.

import { WorkCapsulePublicationRefusedError } from "./work-capsule-terminal-status";

export const DOCS_IMPACT_DISPOSITION_EVIDENCE_KIND = "docs-impact-disposition";
export const DOCS_IMPACT_DISPOSITIONS = ["updated", "not-affected"] as const;
export type DocsImpactDisposition = (typeof DOCS_IMPACT_DISPOSITIONS)[number];

/** A `not-affected` call must say why, the same bar the PR trailer sets. */
const MIN_REASON_LENGTH = 10;

/** Statuses that hand the room to someone else. `complete` is excluded: a delivered room closes through archive. */
const HANDOFF_STATUSES = new Set(["ready-for-review", "ready-for-promotion"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Docs the room's change-impact contract lists as affected and not yet in the change. */
export function pendingDocsFromVerificationState(verificationState: unknown): string[] {
  const contract = asRecord(asRecord(verificationState)?.changeImpactContract);
  const entries = asRecord(contract?.gateContext)?.docsImpact;
  if (!Array.isArray(entries)) return [];
  return [...new Set(entries
    .map(asRecord)
    .filter((entry) => entry?.status === "pending" && typeof entry.doc === "string")
    .map((entry) => entry!.doc as string))].sort();
}

/** Docs a disposition evidence payload settles. Malformed entries settle nothing. */
export function disposedDocsFromEvidence(payload: unknown): string[] {
  const record = asRecord(payload);
  if (record?.kind !== DOCS_IMPACT_DISPOSITION_EVIDENCE_KIND) return [];
  const docs = asRecord(record.result)?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.map(asRecord).flatMap((entry) => {
    if (typeof entry?.doc !== "string") return [];
    if (entry.disposition === "updated") return [entry.doc];
    if (entry.disposition === "not-affected"
      && typeof entry.reason === "string" && entry.reason.trim().length >= MIN_REASON_LENGTH) return [entry.doc];
    return [];
  });
}

export function undisposedDocs(pending: string[], evidencePayloads: unknown[]): string[] {
  const settled = new Set(evidencePayloads.flatMap(disposedDocsFromEvidence));
  return pending.filter((doc) => !settled.has(doc));
}

/**
 * Refuse a handoff status while the room's affected docs have no disposition.
 * Rooms without an activity reader (test doubles, narrow callers) are not judged.
 */
export async function assertDocsImpactDisposed(input: {
  status: string;
  capsuleRowId: string;
  verificationState: unknown;
  workroomActivity: { findMany?(args: unknown): Promise<Array<{ payload: unknown }>> };
}): Promise<void> {
  if (!HANDOFF_STATUSES.has(input.status)) return;
  const pending = pendingDocsFromVerificationState(input.verificationState);
  if (pending.length === 0 || !input.workroomActivity.findMany) return;
  const rows = await input.workroomActivity.findMany({
    where: {
      workCapsuleId: input.capsuleRowId,
      kind: "evidence-recorded",
      payload: { path: ["kind"], equals: DOCS_IMPACT_DISPOSITION_EVIDENCE_KIND },
    },
    select: { payload: true },
  });
  const missing = undisposedDocs(pending, rows.map((row) => row.payload));
  if (missing.length === 0) return;
  throw new WorkCapsulePublicationRefusedError({
    code: "docs_impact_disposition_required",
    reason: `The doc-impact graph links this room's changes to ${missing.length} doc(s) with no recorded disposition: ${missing.join(", ")}.`,
    undisposedDocs: missing,
  });
}
