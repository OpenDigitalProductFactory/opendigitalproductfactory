/**
 * Job-completion evidence — pure projection + append logic for
 * WorkItem.evidence (stored as JSON, additive).
 *
 * The endpoint code in apps/web/app/api/v1/work-items/[itemId]/evidence/route.ts
 * owns the Prisma I/O. This module owns:
 *  - validation: a captured photo must carry { fileId, url, capturedAt } and
 *    `capturedAt` must be a parseable ISO date-time string.
 *  - merge: appending a photo to the existing evidence without losing siblings.
 *  - normalization: reading WorkItem.evidence as JSON and projecting it to
 *    the closed JobEvidence wire shape (drops unknown keys, never throws).
 */
import { isRecord } from "@/lib/shared/coerce";
import type {
  JobEvidence,
  JobEvidencePhoto,
} from "@dpf/types";

const EMPTY: JobEvidence = { photos: [] };

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Normalize one persisted-or-incoming photo entry. Returns null on invalid input. */
export function normalizePhoto(raw: unknown): JobEvidencePhoto | null {
  if (!isRecord(raw)) return null;
  const fileId = asString(raw.fileId);
  const url = asString(raw.url);
  const capturedAt = isIsoDate(raw.capturedAt) ? (raw.capturedAt as string) : null;
  if (!fileId || !url || !capturedAt) return null;
  const photo: JobEvidencePhoto = { fileId, url, capturedAt };
  const caption = asString(raw.caption);
  if (caption) photo.caption = caption;
  return photo;
}

/**
 * Normalize a stored WorkItem.evidence JSON value into the closed wire shape.
 * Treats anything malformed as empty rather than throwing — the field is
 * append-only and historical writes pre-dating this contract may be missing
 * keys.
 */
export function normalizeEvidence(raw: unknown): JobEvidence {
  if (!isRecord(raw)) return { ...EMPTY };
  const photosRaw = Array.isArray(raw.photos) ? raw.photos : [];
  const photos: JobEvidencePhoto[] = [];
  for (const entry of photosRaw) {
    const norm = normalizePhoto(entry);
    if (norm) photos.push(norm);
  }
  return { photos };
}

/**
 * Append one validated photo to existing evidence and return the new value
 * (immutable; the input is untouched). The endpoint persists the return
 * value back to WorkItem.evidence in one update.
 */
export function appendPhoto(
  existing: JobEvidence,
  photo: JobEvidencePhoto,
): JobEvidence {
  return { ...existing, photos: [...existing.photos, photo] };
}
