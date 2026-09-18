// Workroom declared-boundary claim.
//
// WHY THIS EXISTS. The room detail page computes a boundary and reports what is
// missing — "Outcome not defined", "Accountable owner not assigned", and nine
// more. Until now nothing could ever satisfy it: workspace-case-loader.ts built
// the boundary with every field hardcoded to null except `purpose` (the item
// description) and `dueAt`. So the notice was permanently red on every room on
// every install, the page printed "NEXT ACTION: Assign owner" with no way to
// assign one, and a reader could not tell a room nobody had bounded from a room
// the product could not bound.
//
// That is worse than showing nothing. A surface that names the next action and
// withholds the affordance reads as broken rather than incomplete, and gives no
// way to distinguish a missing permission from a missing feature.
//
// WHERE IT LIVES. Inside `Workroom.scopeClaims`, under the key
// "workroomBoundary" — the same deliberately schema-free home the declared
// SHAPE claim uses (workroom-shape-claim.ts), and for the same reason: W2
// (Workroom referential integrity, BI-640B011D) has not landed. When it does,
// this claim folds into first-class columns and this module becomes the
// read-compat shim for pre-migration rows.
//
// scopeClaims is canonically an ARRAY of ScopeClaim records, and
// lib/work-capsules.ts parseScopeClaims strictly filters entries it does not
// recognise — so this entry is invisible to existing readers, exactly as the
// shape claim is.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not infer. An unstated outcome
// stays unstated: deriving one from the title would produce a boundary nobody
// declared, and the whole point of the notice is to distinguish a room somebody
// has bounded from one nobody has.

/** The fields an operator can declare. Free text by design — a boundary is a
 *  statement of intent, and forcing it into enums before anyone has written one
 *  would constrain the vocabulary before we know what people say. */
export type WorkroomBoundaryClaim = {
  /** What this room is for. */
  purpose?: string | null;
  /** What being finished looks like. */
  outcome?: string | null;
  /** Who answers for it — a principal ref, role ref, or a name. */
  accountablePrincipalRef?: string | null;
  /** What is in scope. */
  scopeIncluded?: readonly string[];
  /** What is explicitly out of scope — often the more useful half. */
  scopeExcluded?: readonly string[];
  /** What the room may decide without escalating. */
  authoritySummary?: readonly string[];
  /** The highest data sensitivity admitted here. */
  sensitivityCeiling?: string | null;
  /** How anyone would know it worked. */
  measures?: readonly string[];
  /** When it stops, successfully or otherwise. */
  closureRuleSummary?: string | null;
  /** When the boundary was last declared. */
  recordedAt?: string;
};

export type WorkroomBoundaryClaimEntry = {
  workroomBoundary: WorkroomBoundaryClaim;
  recordedAt: string;
};

const TEXT_FIELDS = [
  "purpose",
  "outcome",
  "accountablePrincipalRef",
  "sensitivityCeiling",
  "closureRuleSummary",
] as const;

const LIST_FIELDS = [
  "scopeIncluded",
  "scopeExcluded",
  "authoritySummary",
  "measures",
] as const;

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry))
    .filter((entry): entry is string => entry !== null);
}

function claimFrom(candidate: unknown): WorkroomBoundaryClaim | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const raw = (candidate as Record<string, unknown>).workroomBoundary;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const source = raw as Record<string, unknown>;
  const claim: WorkroomBoundaryClaim = {};
  for (const field of TEXT_FIELDS) claim[field] = cleanText(source[field]);
  for (const field of LIST_FIELDS) claim[field] = cleanList(source[field]);
  const recordedAt = cleanText(source.recordedAt);
  if (recordedAt) claim.recordedAt = recordedAt;

  // An entry that declares nothing is not a declaration. Returning it would let
  // an empty save read as "somebody bounded this room", which is the exact
  // distinction this claim exists to preserve.
  const declaredSomething =
    TEXT_FIELDS.some((field) => claim[field])
    || LIST_FIELDS.some((field) => (claim[field] ?? []).length > 0);
  return declaredSomething ? claim : null;
}

/**
 * Read the room's declared boundary out of its scopeClaims JSON, or null when
 * no valid declaration exists. Never throws: malformed JSON reads as null.
 *
 * Tolerant of both the canonical array form and a legacy bare object, matching
 * readWorkroomShapeClaim.
 */
export function readWorkroomBoundaryClaim(scopeClaims: unknown): WorkroomBoundaryClaim | null {
  if (Array.isArray(scopeClaims)) {
    for (const entry of scopeClaims) {
      const claim = claimFrom(entry);
      if (claim) return claim;
    }
    return null;
  }
  return claimFrom(scopeClaims);
}

/**
 * Merge a declared boundary into an existing scopeClaims value, returning the
 * array to persist. Replaces any prior boundary entry rather than appending, so
 * the claim list does not grow by one on every edit; every other entry —
 * including the shape claim — is preserved untouched.
 */
export function withWorkroomBoundaryClaim(
  scopeClaims: unknown,
  claim: WorkroomBoundaryClaim,
  now: Date = new Date(),
): unknown[] {
  const existing = Array.isArray(scopeClaims)
    ? scopeClaims
    : scopeClaims && typeof scopeClaims === "object"
      ? [scopeClaims]
      : [];
  const others = existing.filter((entry) => claimFrom(entry) === null);

  const normalized: WorkroomBoundaryClaim = {};
  for (const field of TEXT_FIELDS) normalized[field] = cleanText(claim[field]);
  for (const field of LIST_FIELDS) normalized[field] = cleanList(claim[field]);

  const declaredSomething =
    TEXT_FIELDS.some((field) => normalized[field])
    || LIST_FIELDS.some((field) => (normalized[field] ?? []).length > 0);

  // Clearing every field removes the claim rather than storing an empty one:
  // "nobody has bounded this room" and "somebody bounded it to nothing" must
  // not become indistinguishable.
  if (!declaredSomething) return others;

  const entry: WorkroomBoundaryClaimEntry = {
    workroomBoundary: { ...normalized, recordedAt: now.toISOString() },
    recordedAt: now.toISOString(),
  };
  return [...others, entry];
}
