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
