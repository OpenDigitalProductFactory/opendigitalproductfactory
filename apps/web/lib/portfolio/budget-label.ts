// The budget label (BI-9EC60FE0, AC-3), pure so the tie-out panel can render it in
// the browser: a missing budget reads "No budget set", never zero. It imports
// nothing that reaches the database; portfolio-budget.ts re-exports it.

export function portfolioBudgetLabel(budget: { allocatedPoints: number; usdPerPoint: number | null } | null): string {
  if (!budget) return "No budget set";
  const points = `${budget.allocatedPoints.toLocaleString("en-US")} points`;
  if (budget.usdPerPoint === null) return points;
  const usd = (budget.allocatedPoints * budget.usdPerPoint).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return `${points} (${usd} at $${budget.usdPerPoint}/point)`;
}
