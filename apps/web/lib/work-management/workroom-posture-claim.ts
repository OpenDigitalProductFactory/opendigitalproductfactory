// EP-WORK-POSTURE Slice D (BI-4F468192) — the room's DECLARED posture.
//
// Stored inside the Workroom's `scopeClaims` JSON under the key
// "workroomPosture", exactly as the declared collaboration shape already rides
// there (see workroom-shape-claim.ts). Deliberately schema-free: W2 (Workroom
// referential integrity, BI-640B011D) has not landed, so this claim folds into
// a first-class column when it does and this module becomes the read-compat
// shim for pre-migration rows.
//
// scopeClaims is canonically an ARRAY of ScopeClaim records (lib/work-capsules.ts
// parseScopeClaims), which strictly filters entries it does not recognize — so
// this entry is invisible to existing readers, and this reader tolerates both
// the array form and a legacy object form.
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
} from "@/lib/proactivity/proactivity-types";
import { PROACTIVITY_LEVELS } from "@/lib/proactivity/proactivity-types";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import { isGoldenTrianglePreference } from "@/lib/golden-triangle/persistence";
import type { RoomPostureDeclaration } from "@/lib/work-posture";

export type WorkroomPostureClaimEntry = {
  workroomPosture: RoomPostureDeclaration;
  recordedAt: string;
};

const LEVEL_SET = new Set<string>(PROACTIVITY_LEVELS);
const BOUNDARY_SET = new Set<string>(["advise", "propose", "preauthorized"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrow an untyped JSON blob to a declaration, dropping anything unrecognised. */
function declarationFrom(candidate: unknown): RoomPostureDeclaration | null {
  const outer = asRecord(candidate);
  const declared = outer ? asRecord(outer.workroomPosture) : null;
  if (!declared) return null;

  const declaration: RoomPostureDeclaration = {};
  if (typeof declared.proactivityLevel === "string" && LEVEL_SET.has(declared.proactivityLevel)) {
    declaration.proactivityLevel = declared.proactivityLevel as ProactivityLevel;
  }
  if (typeof declared.actionBoundary === "string" && BOUNDARY_SET.has(declared.actionBoundary)) {
    declaration.actionBoundary = declared.actionBoundary as ProactivityActionBoundary;
  }
  if (isGoldenTrianglePreference(declared.priority)) {
    declaration.priority = declared.priority as GoldenTrianglePreference;
  }
  if (typeof declared.declaredBy === "string") declaration.declaredBy = declared.declaredBy;
  if (typeof declared.declaredAt === "string") declaration.declaredAt = declared.declaredAt;

  // An entry that declared nothing recognisable is not a declaration. Returning
  // an empty object here would read downstream as "the room chose defaults",
  // which is a different and wrong statement.
  return declaration.proactivityLevel || declaration.actionBoundary || declaration.priority
    ? declaration
    : null;
}

/**
 * Read the room's declared posture out of its scopeClaims JSON, or null when
 * no valid declaration exists. Never throws: malformed JSON reads as null.
 */
export function readWorkroomPostureClaim(scopeClaims: unknown): RoomPostureDeclaration | null {
  if (Array.isArray(scopeClaims)) {
    for (const entry of scopeClaims) {
      const declaration = declarationFrom(entry);
      if (declaration) return declaration;
    }
    return null;
  }
  return declarationFrom(scopeClaims);
}

/**
 * Build the claim entry to append to the room's scopeClaims array. Callers
 * replace any existing posture-claim entry rather than appending a second one
 * (readWorkroomPostureClaim returns the first valid declaration).
 */
export function buildWorkroomPostureClaim(
  declaration: RoomPostureDeclaration,
  now: Date = new Date(),
): WorkroomPostureClaimEntry {
  return { workroomPosture: declaration, recordedAt: now.toISOString() };
}

/** Replace (or insert) the posture claim in an existing scopeClaims array. */
export function withWorkroomPostureClaim(
  scopeClaims: unknown,
  declaration: RoomPostureDeclaration,
  now: Date = new Date(),
): unknown[] {
  const existing = Array.isArray(scopeClaims) ? scopeClaims : [];
  const preserved = existing.filter((entry) => declarationFrom(entry) === null);
  return [...preserved, buildWorkroomPostureClaim(declaration, now)];
}
