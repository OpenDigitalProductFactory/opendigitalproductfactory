import {
  isProfessionJurisdiction,
  type ProfessionJurisdiction,
  type ProfessionJurisdictionBasis,
} from "@dpf/db/wiki-taxonomy";

/**
 * Which employment jurisdiction governs a worker (BI-9252B9EA).
 *
 * Jurisdiction is not one tag. An organisation operates in some jurisdictions,
 * sells to others, employs in others and holds data in others, and different
 * obligations key off different dimensions. This module claims EXACTLY ONE of
 * them — the employing basis. Sales-tax, data-residency and marketing-consent
 * bases already resolve from their own `Organization` columns and are untouched.
 *
 * Nothing here decides a legal question. It answers "whose employment rules
 * apply to this worker", so that the co-employment control (BI-B506AD2E) has a
 * key to look a rule up by. Deciding what that rule says is policy data.
 */

/**
 * The jurisdiction-basis this resolver answers for.
 *
 * Exported so callers name the basis by reference rather than typing the string.
 * A caller that hardcodes a different basis is asking a different question and
 * will get an answer that is wrong in a way no test would catch.
 */
export const EMPLOYMENT_JURISDICTION_BASIS: ProfessionJurisdictionBasis = "employing";

/** Why a worker's employment jurisdiction could not be resolved. */
export type UnresolvedJurisdictionReason =
  /** The worker has no work location, so there is nowhere to resolve from. */
  | "no-work-location"
  /** The work location exists but its jurisdiction was never declared. */
  | "location-without-jurisdiction"
  /**
   * The location carries a value that is not in the closed
   * `PROFESSION_JURISDICTIONS` vocabulary. Reachable because the column is a
   * String — see the schema note on why it is not a Prisma enum — so it is
   * handled rather than assumed away.
   */
  | "jurisdiction-not-recognised"
  /**
   * The location's jurisdiction is real, but the organisation has not declared
   * that it employs there. Either the declaration is stale or the worker is
   * placed somewhere the organisation does not believe it employs; both are
   * operator work and neither is safe to resolve past.
   */
  | "jurisdiction-not-in-employs-in";

export type EmploymentJurisdictionResolution =
  | {
      readonly resolved: true;
      readonly jurisdiction: ProfessionJurisdiction;
      readonly basis: ProfessionJurisdictionBasis;
      /** The location the answer came from, for an actionable operator message. */
      readonly workLocationId: string;
    }
  /**
   * No location at all. Split from the other three so the location-bearing
   * reasons carry a non-null `workLocationId` in the type rather than a
   * null-assertion at every use.
   */
  | {
      readonly resolved: false;
      readonly reason: "no-work-location";
      readonly workLocationId: null;
      readonly declaredValue: null;
    }
  | {
      readonly resolved: false;
      readonly reason: "location-without-jurisdiction";
      readonly workLocationId: string;
      readonly declaredValue: null;
    }
  | {
      readonly resolved: false;
      readonly reason: "jurisdiction-not-recognised" | "jurisdiction-not-in-employs-in";
      readonly workLocationId: string;
      /** The value found on the location: unknown to the vocabulary, or undeclared by the org. */
      readonly declaredValue: string;
    };

/** The worker shape this resolver reads. Deliberately structural, not a Prisma row. */
export type JurisdictionResolutionInput = {
  readonly workLocation?: {
    readonly id: string;
    readonly jurisdictionSlug: string | null;
  } | null;
};

/**
 * Resolve the employment jurisdiction governing a worker.
 *
 * Fails LOUDLY, in the same posture `approval-routing.ts` sets and
 * `resolveClassification` follows: an unresolvable jurisdiction is operator work
 * naming its reason. It is never defaulted to `global`.
 *
 * `global` as a fallback would be the worst available answer. It is a real
 * member of the vocabulary, so a policy lookup would succeed against it and
 * return whatever the global row permits — which is the permissive row, because
 * global rules are the floor rather than any jurisdiction's ceiling. The system
 * would then be confidently applying the wrong jurisdiction's employment rules
 * with no signal that it had guessed.
 *
 * @param employsIn The organisation's declared employing jurisdictions
 *   (`Organization.employsIn`). An EMPTY set means undeclared, which does not
 *   filter — matching the no-regression rule the regional profile already sets
 *   for every other basis.
 */
export function resolveEmploymentJurisdiction(
  worker: JurisdictionResolutionInput,
  employsIn: readonly string[],
): EmploymentJurisdictionResolution {
  const location = worker.workLocation;
  if (!location) {
    return { resolved: false, reason: "no-work-location", workLocationId: null, declaredValue: null };
  }

  const declared = location.jurisdictionSlug;
  if (!declared) {
    return {
      resolved: false,
      reason: "location-without-jurisdiction",
      workLocationId: location.id,
      declaredValue: null,
    };
  }

  if (!isProfessionJurisdiction(declared)) {
    return {
      resolved: false,
      reason: "jurisdiction-not-recognised",
      workLocationId: location.id,
      declaredValue: declared,
    };
  }

  // An undeclared employsIn set does not filter. A declared one does.
  if (employsIn.length > 0 && !employsIn.includes(declared)) {
    return {
      resolved: false,
      reason: "jurisdiction-not-in-employs-in",
      workLocationId: location.id,
      declaredValue: declared,
    };
  }

  return {
    resolved: true,
    jurisdiction: declared,
    basis: EMPLOYMENT_JURISDICTION_BASIS,
    workLocationId: location.id,
  };
}

/**
 * The lookup key a resolved jurisdiction presents to the policy spine.
 *
 * This is the whole of AC-ELA-004: the resolved slug IS the
 * `RegulatoryAutonomyPolicy.jurisdiction` value and the basis IS its
 * `jurisdictionBasis`. There is no mapping table, no normalisation and no
 * translation — this function only names the pairing so a caller cannot pass the
 * jurisdiction under the wrong basis.
 */
export function employmentPolicyKey(
  resolution: Extract<EmploymentJurisdictionResolution, { resolved: true }>,
): { readonly jurisdiction: string; readonly jurisdictionBasis: string } {
  return { jurisdiction: resolution.jurisdiction, jurisdictionBasis: resolution.basis };
}

/**
 * Operator-facing explanation for an unresolved jurisdiction. Plain language,
 * names the fix — the same contract `describeUnresolvedRouting` follows, because
 * an unresolved state that does not tell an operator what to do is a dead end.
 */
export function describeUnresolvedEmploymentJurisdiction(
  resolution: Extract<EmploymentJurisdictionResolution, { resolved: false }>,
  workerName: string,
  locationNameOf: (workLocationId: string) => string,
): string {
  switch (resolution.reason) {
    case "no-work-location":
      return `${workerName} has no work location, so there is no way to tell which employment rules apply to them. Set their work location.`;
    case "location-without-jurisdiction":
      return `${locationNameOf(resolution.workLocationId)} has no employment jurisdiction set, so the rules for ${workerName} cannot be looked up. Set the jurisdiction on that location.`;
    case "jurisdiction-not-recognised":
      return `${locationNameOf(resolution.workLocationId)} is set to "${resolution.declaredValue}", which is not a jurisdiction this platform knows. Set it to one of the supported jurisdictions.`;
    case "jurisdiction-not-in-employs-in":
      return `${locationNameOf(resolution.workLocationId)} is in ${resolution.declaredValue}, but your organisation has not declared that it employs people there. Either add ${resolution.declaredValue} to where you employ staff, or move ${workerName} to a location you do employ in.`;
  }
}
