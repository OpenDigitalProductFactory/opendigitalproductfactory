import { z } from "zod";

// Field Dispatch — job lifecycle application contract (F1).
//
// `WorkItem` is a shared work substrate; its `status` column is a generic string
// (DB default "queued"), NOT a Prisma enum. Field dispatch therefore owns its
// lifecycle vocabulary as a typed application contract validated here (ADR-7),
// shared by the dispatcher coworker (F2) and the dispatch board (F3). Pure — no
// Prisma, no React, no Date.now — so it is instant-testable and reusable.
//
// See docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md
// (ADR-7, ADR-8, ADR-10, §7.1).

/** `WorkItem.sourceType` value that marks a row as a field-service job. */
export const FIELD_DISPATCH_SOURCE_TYPE = "field-service-job" as const;

/**
 * The field-service job lifecycle, in canonical order. `needs-review` is the
 * sentinel for any persisted status that is not a known lifecycle value (a
 * freshly-created `WorkItem` defaulting to "queued", a legacy row, or a typo) so
 * the board always has a place to surface "this job has no valid dispatch state."
 */
export const FIELD_DISPATCH_JOB_STATUSES = [
  "quoted",
  "scheduled",
  "confirmed",
  "en-route",
  "on-site",
  "complete",
  "invoiced",
  "paid",
  "cancelled",
  "needs-review",
] as const;

export const fieldDispatchJobStatusSchema = z.enum(FIELD_DISPATCH_JOB_STATUSES);
export type FieldDispatchJobStatus = z.infer<typeof fieldDispatchJobStatusSchema>;

/** The report-kit `STATUS_INTENT` domain key for field-dispatch job statuses. */
export const FIELD_DISPATCH_STATUS_DOMAIN = "fieldDispatchJob" as const;

/** Operator-facing labels (per-vertical vocabulary overrides come from the FieldDispatchProfile). */
export const FIELD_DISPATCH_JOB_STATUS_LABEL: Record<FieldDispatchJobStatus, string> = {
  quoted: "Quoted",
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  "en-route": "En route",
  "on-site": "On site",
  complete: "Complete",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
  "needs-review": "Needs review",
};

/** True when `value` is exactly one of the known lifecycle statuses. */
export function isFieldDispatchJobStatus(value: unknown): value is FieldDispatchJobStatus {
  return fieldDispatchJobStatusSchema.safeParse(value).success;
}

/**
 * Parse a persisted `WorkItem.status` into the dispatch lifecycle. Known values
 * pass through; anything else (the "queued" default, legacy values, typos,
 * null/undefined) maps to `needs-review` so the board never renders a job in an
 * unrecognized state and never silently drops it (ADR-7).
 */
export function parseFieldDispatchStatus(value: unknown): FieldDispatchJobStatus {
  const result = fieldDispatchJobStatusSchema.safeParse(value);
  return result.success ? result.data : "needs-review";
}

/** Canonical sort index (lifecycle order); `needs-review` sorts first as an exception. */
export function fieldDispatchStatusOrder(status: FieldDispatchJobStatus): number {
  return status === "needs-review" ? -1 : FIELD_DISPATCH_JOB_STATUSES.indexOf(status);
}

const TERMINAL: ReadonlySet<FieldDispatchJobStatus> = new Set(["paid", "cancelled"]);
const WORK_COMPLETE: ReadonlySet<FieldDispatchJobStatus> = new Set(["complete", "invoiced", "paid"]);
const ATTENTION: ReadonlySet<FieldDispatchJobStatus> = new Set(["needs-review", "quoted", "scheduled"]);

/** No further dispatch action expected (paid or cancelled). */
export function isTerminalStatus(status: FieldDispatchJobStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * The on-site work is done (complete/invoiced/paid). The persistence layer sets
 * `WorkItem.completedAt` the first time a job enters this band (ADR-7) — this
 * helper is the predicate; it does not itself mutate anything.
 */
export function isWorkComplete(status: FieldDispatchJobStatus): boolean {
  return WORK_COMPLETE.has(status);
}

/**
 * The job needs a dispatcher's attention to progress: no valid state
 * (`needs-review`), still a quote, or scheduled-but-unconfirmed. The board's
 * critical strip is built from these plus the running-late/unassigned signals
 * derived elsewhere (F3/F4).
 */
export function needsDispatcherAttention(status: FieldDispatchJobStatus): boolean {
  return ATTENTION.has(status);
}

// ---------------------------------------------------------------------------
// Evidence metadata (ADR-10): non-sensitive metadata + references only. Photos,
// signed forms, and regulated artifacts are linked by id (MediaAsset / future
// ComplianceArtifact), never stored inline here. PHI-heavy verticals (home
// health, etc.) are NOT first-slice consumers.
// ---------------------------------------------------------------------------

export const fieldDispatchEvidenceKindSchema = z.enum([
  "note", // free-text job note
  "parts-used", // parts consumed on the job (links to inventory in F11)
  "photo", // reference to a MediaAsset id
  "signoff", // customer sign-off reference
  "compliance", // reference to a compliance artifact (F9 owns the content)
  "status-change", // audit of a lifecycle transition
]);
export type FieldDispatchEvidenceKind = z.infer<typeof fieldDispatchEvidenceKindSchema>;

export const fieldDispatchPartLineSchema = z.object({
  sku: z.string().min(1),
  label: z.string().optional(),
  quantity: z.number(),
});
export type FieldDispatchPartLine = z.infer<typeof fieldDispatchPartLineSchema>;

export const fieldDispatchEvidenceEntrySchema = z.object({
  kind: fieldDispatchEvidenceKindSchema,
  /** ISO-8601 timestamp, supplied by the caller (this module stays pure). */
  at: z.string().min(1),
  byUserId: z.string().optional(),
  byAgentId: z.string().optional(),
  note: z.string().optional(),
  partsUsed: z.array(fieldDispatchPartLineSchema).optional(),
  /** Reference to a MediaAsset row — never an inline image (ADR-10). */
  mediaAssetId: z.string().optional(),
  /** Reference to a compliance artifact — never the regulated content (ADR-10). */
  complianceArtifactRef: z.string().optional(),
  fromStatus: fieldDispatchJobStatusSchema.optional(),
  toStatus: fieldDispatchJobStatusSchema.optional(),
});
export type FieldDispatchEvidenceEntry = z.infer<typeof fieldDispatchEvidenceEntrySchema>;

export interface FieldDispatchEvidence {
  entries: FieldDispatchEvidenceEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensively parse `WorkItem.evidence` Json into the field-dispatch shape.
 * `evidence` is shared Json other domains may also write, so this never throws:
 * a non-object, a missing `entries` array, or individual malformed entries all
 * degrade to dropping the bad data. Returns `{ entries: [] }` for absent/invalid
 * input so callers can treat the result uniformly.
 */
export function parseFieldDispatchEvidence(raw: unknown): FieldDispatchEvidence {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return { entries: [] };
  const entries: FieldDispatchEvidenceEntry[] = [];
  for (const candidate of raw.entries) {
    const parsed = fieldDispatchEvidenceEntrySchema.safeParse(candidate);
    if (parsed.success) entries.push(parsed.data);
  }
  return { entries };
}

/** All parts consumed across a job's evidence entries, flattened. */
export function collectPartsUsed(evidence: FieldDispatchEvidence): FieldDispatchPartLine[] {
  return evidence.entries.flatMap((entry) => entry.partsUsed ?? []);
}
