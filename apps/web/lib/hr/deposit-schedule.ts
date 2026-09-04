// lib/hr/deposit-schedule.ts — which deposit cadence was in force on a date
// (BI-947F8703 item 5).
//
// determineDepositCadence already computes a cadence from a lookback total and
// a threshold, but nothing stored the result, so nothing could answer "which
// cadence governed this pay date?" after the fact. That question is the whole
// point: a deposit's timing is judged against the cadence in force WHEN IT WAS
// PAID, not the one in force today.
//
// Pure and DB-free; the caller loads the schedules and hands them in.

/** Mirrors the TaxDepositCadence Prisma enum. */
export type TaxDepositCadence = "semiweekly" | "monthly" | "quarterly" | "annual";

export interface ResolvableDepositSchedule {
  id: string;
  cadence: TaxDepositCadence;
  effectiveFrom: Date;
  /** NULL means still open. */
  effectiveTo: Date | null;
}

/**
 * The schedule governing `on`, or null when none covers it.
 *
 * Null is never "assume monthly". An install that has not recorded a
 * determination has not made one, and guessing the gentler cadence is how a
 * business that should deposit semiweekly silently deposits monthly and takes
 * a penalty. The caller must surface it.
 *
 * effectiveTo is EXCLUSIVE, matching the mileage rate windows, so a schedule
 * ending on the 1st does not govern the 1st. Among overlapping schedules the
 * latest effectiveFrom wins, so a re-determination supersedes cleanly without
 * anyone editing history.
 */
export function resolveDepositSchedule(
  schedules: readonly ResolvableDepositSchedule[],
  on: Date,
): ResolvableDepositSchedule | null {
  const covering = schedules.filter((schedule) => {
    if (schedule.effectiveFrom.getTime() > on.getTime()) return false;
    if (schedule.effectiveTo === null) return true;
    return schedule.effectiveTo.getTime() > on.getTime();
  });

  return (
    [...covering].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}

/**
 * The deposit period a pay date falls into, as [start, endExclusive).
 *
 * Semiweekly is deliberately NOT modelled as a date range here. The federal
 * semiweekly rule keys the due date off which DAY OF THE WEEK the wages were
 * paid, not off a calendar span, and the exact banking-day arithmetic needs the
 * authority's published rule and holiday calendar. Returning a fabricated span
 * would produce a confident wrong due date, so this returns null and the caller
 * must treat semiweekly as operator-determined until that rule is seeded
 * (BI-4EB27955).
 */
export function depositPeriodFor(
  cadence: TaxDepositCadence,
  payDate: Date,
): { start: Date; endExclusive: Date } | null {
  const year = payDate.getUTCFullYear();
  const month = payDate.getUTCMonth();

  switch (cadence) {
    case "monthly":
      return {
        start: new Date(Date.UTC(year, month, 1)),
        endExclusive: new Date(Date.UTC(year, month + 1, 1)),
      };
    case "quarterly": {
      const firstMonthOfQuarter = Math.floor(month / 3) * 3;
      return {
        start: new Date(Date.UTC(year, firstMonthOfQuarter, 1)),
        endExclusive: new Date(Date.UTC(year, firstMonthOfQuarter + 3, 1)),
      };
    }
    case "annual":
      return {
        start: new Date(Date.UTC(year, 0, 1)),
        endExclusive: new Date(Date.UTC(year + 1, 0, 1)),
      };
    case "semiweekly":
      return null;
  }
}
