// EP-27FD96BC · P2 (BI-E8BCA547) — spend-aware routing.
//
// The daily per-agent budget gate MEASURED spend and, at 95%, wrote a warning
// event — but nothing acted on it: the promised "downgrade to a routine-tier
// model" was a comment, and the `downgrade` budget-event kind was defined and
// never written. So an agent near its budget kept routing to the same expensive
// model until it hit 100% and was hard-rejected.
//
// This closes the loop by biasing the agent's routing BUDGET CLASS from its live
// spend. Only the class changes — the router still honours every capability floor
// (minimum tier, tool-use, vision, context), so a near-budget turn routes to the
// cheapest CAPABLE model, never a broken one. Pure.

import type { BudgetStatus } from "./budget-gate";

export type BudgetClass = "minimize_cost" | "balanced" | "quality_first";

// Cheapest → most expensive.
const ORDER: readonly BudgetClass[] = ["minimize_cost", "balanced", "quality_first"];

function coerce(value: string | undefined): BudgetClass {
  return value && (ORDER as readonly string[]).includes(value) ? (value as BudgetClass) : "balanced";
}

/**
 * Bias a budget class by the agent's live daily-spend status:
 *   - `warning_95` (95–100%) → `minimize_cost` — the cheapest capable model.
 *   - `warning_80` (80–95%)  → one notch cheaper (quality_first→balanced→minimize_cost).
 *   - `ok` / `rejected`      → unchanged (`rejected` is hard-thrown by the gate,
 *                              not downgraded).
 * Never raises the class. Pure.
 */
export function spendAwareBudgetClass(current: string | undefined, status: BudgetStatus): BudgetClass {
  const cls = coerce(current);
  if (status === "warning_95") return "minimize_cost";
  if (status === "warning_80") {
    const i = ORDER.indexOf(cls);
    return i > 0 ? ORDER[i - 1]! : cls;
  }
  return cls;
}
