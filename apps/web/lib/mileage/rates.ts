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

export type ResolvableRate = {
  id: string;
  purposeKind: MileagePurpose;
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
  const candidates = rates
    .filter((r) => r.purposeKind === purpose && coversDate(r, on))
    .sort((a, b) => {
      if (a.isOrgOverride !== b.isOrgOverride) return a.isOrgOverride ? -1 : 1;
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

  return candidates[0] ?? null;
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
