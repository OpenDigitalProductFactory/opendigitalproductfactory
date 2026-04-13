// apps/web/lib/recurring-utils.ts
// Pure date-calculation utilities for recurring schedules.
// NOT a server action — safe to import from both client and server modules.

function addMonthsUTC(year: number, month: number, day: number, addMonths: number): Date {
  const targetMonth = month + addMonths;
  const lastDayOfMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDayOfMonth)));
}

export function calculateNextDate(currentDate: Date, frequency: string): Date {
  // Work in UTC to avoid timezone-driven date drift
  const y = currentDate.getUTCFullYear();
  const m = currentDate.getUTCMonth();
  const d = currentDate.getUTCDate();

  switch (frequency) {
    case "weekly":
      return new Date(Date.UTC(y, m, d + 7));
    case "fortnightly":
      return new Date(Date.UTC(y, m, d + 14));
    case "monthly":
      return addMonthsUTC(y, m, d, 1);
    case "quarterly":
      return addMonthsUTC(y, m, d, 3);
    case "annually":
      return addMonthsUTC(y, m + 12, d, 0);
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}
