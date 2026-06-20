/**
 * Job-completion evidence wire shape — what the field tech captures alongside
 * a WorkItem before billing the customer. Stored on `WorkItem.evidence` as
 * JSON (no schema migration needed) and projected through this shared type
 * so the producer (apps/web/lib/api/work-item-evidence) and the consumer
 * (apps/mobile/src/features/job-evidence) cannot drift.
 *
 * v1 covers photos (the primary HVAC use-case: "before/after, model sticker,
 * leak, etc"). Signatures, voice notes, geolocation stamps follow in
 * subsequent slices once their capture primitives are wired.
 */

export interface JobEvidencePhoto {
  /** Returned by POST /api/v1/upload — the canonical id of a stored MediaAsset. */
  fileId: string;
  /** Canonical URL — same value the upload endpoint returns. */
  url: string;
  /** ISO date-time the tech captured the photo (client clock). */
  capturedAt: string;
  /** Optional free-text caption ("before", "leak in unit B", etc). */
  caption?: string;
}

/** Aggregate evidence persisted on a WorkItem. Additive — future fields go here. */
export interface JobEvidence {
  photos: JobEvidencePhoto[];
}

/** Request body for the append-evidence endpoint. */
export interface AppendJobEvidenceRequest {
  photo: JobEvidencePhoto;
}

/** Response — the full evidence after append (server is the source of truth). */
export interface JobEvidenceResponse {
  evidence: JobEvidence;
}
