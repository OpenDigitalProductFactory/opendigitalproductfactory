// lib/mileage/monetisation.ts — turning classified drives into reimbursable
// expense lines (BI-E17E0034).
//
// Mileage does NOT get its own reimbursement path. It monetises onto the
// ExpenseClaim / ExpenseItem spine the platform already has, so approval,
// GL posting and payment stay in exactly one place. This module is the pure
// mapping; lib/mileage/mileage-service.ts does the Prisma writes.
//
// Only BUSINESS trips are reimbursable. Commute and personal drives are logged
// (an IRS-compliant log needs total, business and personal miles) but never
// produce money.

import { resolveRateForTrip, reimbursableAmount, metresToMiles, type ResolvableRate } from "./rates";
import type { TripClassification } from "./classification";

export type PriceableTrip = {
  id: string;
  tripId: string;
  startedAt: Date;
  distanceMetres: number;
  classification: TripClassification;
  startPlaceLabel: string | null;
  endPlaceLabel: string | null;
  customerAccountId: string | null;
  /** ISO 3166-1 alpha-2 the device derived, or null when it could not. */
  countryCode?: string | null;
};

export type MileageExpenseLine = {
  tripId: string;
  date: Date;
  category: "mileage";
  description: string;
  amount: number;
  currency: string;
  /** The rate row that priced this line — kept so the money is reproducible. */
  mileageRateId: string;
  customerAccountId: string | null;
};

export type PricingSkip = {
  tripId: string;
  reason: "not-business" | "no-rate-in-force" | "zero-distance";
};

export type PricingResult = {
  lines: readonly MileageExpenseLine[];
  skipped: readonly PricingSkip[];
  totalAmount: number;
  currency: string;
};

function describe(trip: PriceableTrip): string {
  const miles = metresToMiles(trip.distanceMetres).toFixed(1);
  const from = trip.startPlaceLabel?.trim();
  const to = trip.endPlaceLabel?.trim();
  // Place labels are optional — a drive with no resolved places still needs a
  // human-readable line on the claim.
  return from && to ? `${miles} mi — ${from} to ${to}` : `${miles} mi business drive`;
}

/**
 * Price a set of trips into expense lines.
 *
 * Every trip is accounted for: it either produces a line or appears in `skipped`
 * with a reason. A trip is never silently dropped, because a driver noticing
 * missing mileage after the fact is how trust in automatic capture dies.
 */
export function priceTrips(
  trips: readonly PriceableTrip[],
  rates: readonly ResolvableRate[],
  currencyFallback = "USD",
  /**
   * The driver's country of record, governing any trip whose own country is
   * unknown or has no plan. Undefined prices every trip on an unscoped plan,
   * which is exactly how this behaved before jurisdictions existed.
   */
  employeeCountryCode?: string | null,
): PricingResult {
  const lines: MileageExpenseLine[] = [];
  const skipped: PricingSkip[] = [];

  for (const trip of trips) {
    if (trip.classification !== "business") {
      skipped.push({ tripId: trip.tripId, reason: "not-business" });
      continue;
    }
    if (trip.distanceMetres <= 0) {
      skipped.push({ tripId: trip.tripId, reason: "zero-distance" });
      continue;
    }

    // Where the mile was actually driven selects the plan, falling back to the
    // employee's country of record (DI-5E5AFE040A1F).
    const rate = resolveRateForTrip(rates, trip.startedAt, {
      tripCountryCode: trip.countryCode,
      employeeCountryCode,
      purpose: "business",
    });
    if (!rate) {
      // Cannot price yet — surfaced, never zero-filled.
      skipped.push({ tripId: trip.tripId, reason: "no-rate-in-force" });
      continue;
    }

    lines.push({
      tripId: trip.tripId,
      date: trip.startedAt,
      category: "mileage",
      description: describe(trip),
      amount: reimbursableAmount(trip.distanceMetres, rate.amountPerMile),
      currency: rate.currency,
      mileageRateId: rate.id,
      customerAccountId: trip.customerAccountId,
    });
  }

  const currency = lines[0]?.currency ?? currencyFallback;
  const totalAmount = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;

  return { lines, skipped, totalAmount, currency };
}

export type MileageLogTotals = {
  totalMiles: number;
  businessMiles: number;
  personalMiles: number;
  commuteMiles: number;
  unclassifiedMiles: number;
};

/**
 * Totals for an IRS-compliant mileage log. Commute is reported separately from
 * personal because a taxpayer has to be able to show it was excluded, not merely
 * absent.
 */
export function mileageLogTotals(trips: readonly PriceableTrip[]): MileageLogTotals {
  const round = (n: number) => Math.round(n * 10) / 10;
  const sum = (predicate: (t: PriceableTrip) => boolean) =>
    trips.filter(predicate).reduce((t, x) => t + metresToMiles(x.distanceMetres), 0);

  return {
    totalMiles: round(sum(() => true)),
    businessMiles: round(sum((t) => t.classification === "business")),
    personalMiles: round(sum((t) => t.classification === "personal")),
    commuteMiles: round(sum((t) => t.classification === "commute")),
    unclassifiedMiles: round(sum((t) => t.classification === "unclassified")),
  };
}
