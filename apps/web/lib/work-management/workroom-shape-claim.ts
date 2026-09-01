// Workroom declared-shape claim (W14 — BI-E0BFFF77, EP-1C37C089).
//
// The room's declared collaboration shape is stored INSIDE the Workroom's
// scopeClaims JSON (packages/db/prisma/schema.prisma, Workroom.scopeClaims)
// under the key "workroomShape" — deliberately schema-free because W2
// (Workroom referential integrity, BI-640B011D) has not landed. When the W2
// migration ships, this claim folds into a first-class column and this module
// becomes the read-compat shim for pre-migration rows.
//
// scopeClaims is canonically an ARRAY of ScopeClaim records
// (lib/work-capsules.ts parseScopeClaims), which strictly filters entries it
// does not recognize — so the shape-claim entry is invisible to existing
// readers and this reader is tolerant of both the array form and a legacy
// object form.

import { getWorkShape, type WorkShapeDefinition } from "./work-shapes";
import { WORKROOM_SHAPE_KEYS, type WorkroomShapeKey } from "./room-shapes";

export type WorkroomShapeClaimEntry = {
  workroomShape: WorkroomShapeKey;
  recordedAt: string;
};

const SHAPE_KEY_SET = new Set<string>(WORKROOM_SHAPE_KEYS);

function claimFrom(candidate: unknown): WorkroomShapeKey | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const shape = (candidate as Record<string, unknown>).workroomShape;
  return typeof shape === "string" && SHAPE_KEY_SET.has(shape)
    ? (shape as WorkroomShapeKey)
    : null;
}

/**
 * Read the room's declared shape out of its scopeClaims JSON, or null when no
 * valid declaration exists. Never throws: malformed JSON shapes read as null.
 */
export function readWorkroomShapeClaim(scopeClaims: unknown): WorkroomShapeKey | null {
  if (Array.isArray(scopeClaims)) {
    for (const entry of scopeClaims) {
      const shape = claimFrom(entry);
      if (shape) return shape;
    }
    return null;
  }
  return claimFrom(scopeClaims);
}

/**
 * Build the claim entry to append to the room's scopeClaims array. Callers
 * should replace any existing shape-claim entry rather than appending a second
 * one (readWorkroomShapeClaim returns the first valid declaration).
 */
export function buildWorkroomShapeClaim(
  shape: WorkroomShapeKey,
  now: Date = new Date(),
): WorkroomShapeClaimEntry {
  return { workroomShape: shape, recordedAt: now.toISOString() };
}

/** Declared standing-activity shape (`key@version`) on the same scopeClaims carrier. */
export type WorkShapeRef = {
  key: string;
  version: string;
};

export type WorkShapeClaimEntry = {
  workShape: string;
  recordedAt: string;
};

const WORK_SHAPE_REF = /^([^@\s]+)@(\d+\.\d+\.\d+)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse `key@version`. Unknown or unparseable values resolve null and never throw.
 */
export function parseWorkShapeRef(value: unknown): WorkShapeRef | null {
  if (typeof value !== "string") return null;
  const match = WORK_SHAPE_REF.exec(value.trim());
  if (!match) return null;
  return { key: match[1], version: match[2] };
}

function workShapeRefFrom(candidate: unknown): WorkShapeRef | null {
  const row = asRecord(candidate);
  if (!row) return null;
  if (typeof row.workShape === "string") return parseWorkShapeRef(row.workShape);
  if (typeof row.workShapeKey === "string" && typeof row.workShapeVersion === "string") {
    return parseWorkShapeRef(`${row.workShapeKey}@${row.workShapeVersion}`);
  }
  return null;
}

/**
 * Read the room's declared work-shape ref, or null when no valid declaration exists.
 * Never throws.
 */
export function readWorkShapeClaim(scopeClaims: unknown): WorkShapeRef | null {
  if (Array.isArray(scopeClaims)) {
    for (const entry of scopeClaims) {
      const ref = workShapeRefFrom(entry);
      if (ref) return ref;
    }
    return null;
  }
  return workShapeRefFrom(scopeClaims);
}

export function buildWorkShapeClaim(
  ref: WorkShapeRef | string,
  now: Date = new Date(),
): WorkShapeClaimEntry | null {
  const parsed = typeof ref === "string"
    ? parseWorkShapeRef(ref)
    : parseWorkShapeRef(`${ref.key}@${ref.version}`);
  if (!parsed) return null;
  return { workShape: `${parsed.key}@${parsed.version}`, recordedAt: now.toISOString() };
}

export function withWorkShapeClaim(
  scopeClaims: unknown,
  ref: WorkShapeRef | string,
  now: Date = new Date(),
): unknown[] {
  const claim = buildWorkShapeClaim(ref, now);
  const existing = Array.isArray(scopeClaims) ? scopeClaims : [];
  const preserved = existing.filter((entry) => workShapeRefFrom(entry) === null);
  return claim ? [...preserved, claim] : preserved;
}

/**
 * Resolve the declared `key@version` against the canonical registry.
 * Unknown key, version mismatch, or unparseable claim → null, never throws.
 */
export function resolveWorkShapeClaim(scopeClaims: unknown): WorkShapeDefinition | null {
  const ref = readWorkShapeClaim(scopeClaims);
  if (!ref) return null;
  const shape = getWorkShape(ref.key);
  return shape && shape.version === ref.version ? shape : null;
}
