/**
 * Reference-data / locations merge planning (MDM-5, spec §7 step 5).
 *
 * Pure planning logic for merging a duplicate Region/City into a survivor.
 * Implements the duplicate-merge that the 2026-03-17 admin reference-data spec
 * explicitly deferred. A merge is link + supersede (tombstone), never a
 * hard-delete (resolved merge-severity decision, spec §6.6).
 *
 * Merging a region must respect the per-region case-insensitive city-name
 * uniqueness index (`City_regionId_name_ci`): a loser city whose normalized
 * name already exists in the survivor region cannot simply be repointed — it
 * must itself be merged into the colliding survivor city. This module computes
 * that plan; the server action executes it transactionally.
 */

/** Status flag marking a row that was merged away (distinct from manual "inactive"). */
export const SUPERSEDED_STATUS = "superseded" as const;

export type RefCity = { id: string; nameNormalized: string };

export type RegionMergePlan = {
  /** Loser cities with no name collision in the survivor — repoint regionId. */
  cityRepoints: string[];
  /** Loser cities colliding with a survivor city by normalized name — merge into it. */
  cityMerges: Array<{ loserCityId: string; survivorCityId: string }>;
};

/**
 * Plan a region merge: decide which loser cities repoint to the survivor region
 * and which must be merged into a same-named survivor city to avoid violating
 * the per-region name-uniqueness index.
 */
export function planRegionMerge(
  loserCities: readonly RefCity[],
  survivorCities: readonly RefCity[],
): RegionMergePlan {
  const survivorByName = new Map<string, string>();
  for (const city of survivorCities) {
    // First occurrence wins; the DB unique index guarantees at most one active.
    if (!survivorByName.has(city.nameNormalized)) {
      survivorByName.set(city.nameNormalized, city.id);
    }
  }

  const cityRepoints: string[] = [];
  const cityMerges: Array<{ loserCityId: string; survivorCityId: string }> = [];

  for (const city of loserCities) {
    const collision = survivorByName.get(city.nameNormalized);
    if (collision) {
      cityMerges.push({ loserCityId: city.id, survivorCityId: collision });
    } else {
      cityRepoints.push(city.id);
    }
  }

  return { cityRepoints, cityMerges };
}

export type MergeValidationError =
  | "same-record"
  | "different-country"
  | "different-region";

/** Validate a region merge pair. Returns null when the pair is mergeable. */
export function validateRegionMergePair(
  loser: { id: string; countryId: string },
  survivor: { id: string; countryId: string },
): MergeValidationError | null {
  if (loser.id === survivor.id) return "same-record";
  if (loser.countryId !== survivor.countryId) return "different-country";
  return null;
}

/** Validate a city merge pair (both must live in the same region). */
export function validateCityMergePair(
  loser: { id: string; regionId: string },
  survivor: { id: string; regionId: string },
): MergeValidationError | null {
  if (loser.id === survivor.id) return "same-record";
  if (loser.regionId !== survivor.regionId) return "different-region";
  return null;
}
