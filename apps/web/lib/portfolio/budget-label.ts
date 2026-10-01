// The budget label (BI-9EC60FE0, AC-3), pure so the tie-out panel can render it in
// the browser: a missing budget reads "No budget set", never zero. It imports
// nothing that reaches the database; portfolio-budget.ts re-exports it.
// Pass formatLocale from getLocaleContext(); the default is only for callers
// that have no viewer (tests, and a label asked for outside a request).

import { DEFAULT_LOCALE } from "@dpf/i18n/runtime";

import { formatMoney } from "@/lib/org-locale/org-locale";

export function portfolioBudgetLabel(
  budget: { allocatedPoints: number; usdPerPoint: number | null } | null,
  formatLocale: string = DEFAULT_LOCALE,
): string {
  if (!budget) return "No budget set";
  const points = `${budget.allocatedPoints.toLocaleString(formatLocale)} points`;
  if (budget.usdPerPoint === null) return points;
  const usd = formatMoney(budget.allocatedPoints * budget.usdPerPoint, "USD", formatLocale, { maximumFractionDigits: 0 });
  const rate = formatMoney(
    budget.usdPerPoint,
    "USD",
    formatLocale,
    Number.isInteger(budget.usdPerPoint) ? { maximumFractionDigits: 0 } : undefined,
  );
  return `${points} (${usd} at ${rate}/point)`;
}
