// lib/mileage/rates.ts — effective-dated mileage rate resolution (BI-E17E0034).
//
// The whole point of this module is that a trip prices at the rate in force on
// the day it was DRIVEN, never at today's rate. A reimbursement claimed in
// January must still reconcile in December after the statutory rate changed, so
// resolution is always a function of the trip date — there is deliberately no
// "current rate" accessor to reach for by mistake.
//
// Pure and DB-free so every rule is unit-testable; the caller loads candidate
// rates and hands them in.

/** Metres in one statute mile. Mileage rates are per mile, capture is in metres. */
export const METRES_PER_MILE = 1609.344;

export type MileagePurpose = "business" | "medical" | "moving" | "charitable";

/**
 * ISO 3166-1 alpha-2, uppercased, or null when unknown.
 *
 * Normalised at the boundary so "us", "US" and " us " cannot resolve to
 * different plans — a country that fails to match silently prices the trip on
 * the fallback, which is exactly the kind of quiet wrong answer money code
 * must not produce.
 */
export function normaliseCountryCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export type ResolvableRate = {
  id: string;
  purposeKind: MileagePurpose;
  /**
   * Country of the rate plan's jurisdiction, or null for a plan that is not
   * scoped to one (an org-wide override, or a statutory plan seeded before
   * jurisdictions were recorded).
   */
  jurisdictionCountryCode?: string | null;
  /** Money per mile, e.g. 0.725. */
  amountPerMile: number;
  currency: string;
  effectiveFrom: Date;
  /** NULL means still open. */
  effectiveTo: Date | null;
  /** True when this rate belongs to an org's own override plan. */
  isOrgOverride: boolean;
};

function coversDate(rate: ResolvableRate, on: Date): boolean {
  if (rate.effectiveFrom.getTime() > on.getTime()) return false;
  if (rate.effectiveTo === null) return true;
  // effectiveTo is exclusive: a rate ending on the 1st does not price the 1st.
  return rate.effectiveTo.getTime() > on.getTime();
}

/**
 * Resolve the rate that prices a trip driven on `on`.
 *
 * An organization's own override wins over the statutory rate for the same day —
 * that is the "custom company-wide rate" job. Among rates of equal precedence the
 * latest effectiveFrom wins, so a mid-year correction supersedes cleanly without
 * anyone editing history.
 *
 * Returns null when nothing covers the date; callers must treat that as "cannot
 * price yet", never as zero.
 */
export function resolveRateForDate(
  rates: readonly ResolvableRate[],
  on: Date,
  purpose: MileagePurpose = "business",
): ResolvableRate | null {
  return pickWithinTier(rates.filter((r) => r.purposeKind === purpose && coversDate(r, on)));
}

/**
 * Resolve the rate for a trip, honouring where it was driven (DI-5E5AFE040A1F).
 *
 * The organization operates in several countries and sends people abroad, so a
 * mile driven in Mexico may reimburse differently from one driven in the US.
 * The governing jurisdiction is still usually the employee's country of record,
 * which is what makes this a fallback chain rather than a single lookup:
 *
 *   1. a plan for the country the trip was DRIVEN in, when the org has one
 *   2. otherwise a plan for the employee's country of record
 *   3. otherwise an unscoped plan (org-wide override, or an unjurisdictioned
 *      statutory plan)
 *
 * Within whichever tier wins, the existing rules still apply unchanged: an org
 * override beats a statutory rate, and the latest effectiveFrom beats an older
 * one. Tier is decided FIRST and never mixed — an org override for the wrong
 * country must not outrank the statutory rate for the right one, which is the
 * bug a single flat sort would introduce.
 *
 * `tripCountryCode` null (older client, no signal, permission withheld) simply
 * skips tier 1. That is the whole reason the chain degrades instead of holding
 * the trip: a driver who declined location still gets paid, at their home rate.
 */
export function resolveRateForTrip(
  rates: readonly ResolvableRate[],
  on: Date,
  args: {
    tripCountryCode?: string | null;
    employeeCountryCode?: string | null;
    purpose?: MileagePurpose;
  } = {},
): ResolvableRate | null {
  const purpose = args.purpose ?? "business";
  const trip = normaliseCountryCode(args.tripCountryCode);
  const employee = normaliseCountryCode(args.employeeCountryCode);

  const covering = rates.filter((r) => r.purposeKind === purpose && coversDate(r, on));
  const inCountry = (country: string) =>
    covering.filter((r) => normaliseCountryCode(r.jurisdictionCountryCode) === country);

  const tiers: ResolvableRate[][] = [];
  if (trip) tiers.push(inCountry(trip));
  // Only a distinct home country adds a tier; when the drive is domestic the
  // second pass would re-examine the same rates for nothing.
  if (employee && employee !== trip) tiers.push(inCountry(employee));
  tiers.push(covering.filter((r) => normaliseCountryCode(r.jurisdictionCountryCode) === null));

  for (const tier of tiers) {
    const winner = pickWithinTier(tier);
    if (winner) return winner;
  }
  return null;
}

/** Org override first, then the latest effectiveFrom — the pre-jurisdiction rule. */
function pickWithinTier(rates: readonly ResolvableRate[]): ResolvableRate | null {
  return (
    [...rates].sort((a, b) => {
      if (a.isOrgOverride !== b.isOrgOverride) return a.isOrgOverride ? -1 : 1;
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    })[0] ?? null
  );
}

/** Metres to miles, unrounded — rounding belongs at the money boundary only. */
export function metresToMiles(metres: number): number {
  return metres / METRES_PER_MILE;
}

/**
 * Money for a distance at a rate. Rounded half-up to cents at the last step so
 * a long trip does not accumulate per-mile rounding drift.
 */
export function reimbursableAmount(distanceMetres: number, amountPerMile: number): number {
  const raw = metresToMiles(distanceMetres) * amountPerMile;
  return Math.round((raw + Number.EPSILON) * 100) / 100;
}
