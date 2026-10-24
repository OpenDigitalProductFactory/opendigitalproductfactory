// Investment points: the one unit the portfolio budget, reservations and
// admission share (BI-298A7202, design §5.1). Points are relative investment on
// the existing demand scale; they carry no unit of time or money, and an item
// with no size is `unsized`, never guessed.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { resolveJobSize } from "@/lib/demand/scoring";

export type InvestmentPointsSource = "agreed" | "estimate" | "size-default" | "unsized";

export type InvestmentPointsInputs = {
  estimateAgreed?: boolean | null;
  jobSize?: number | null;
  effortSize?: string | null;
};

export type InvestmentPoints =
  | { points: number; source: Exclude<InvestmentPointsSource, "unsized"> }
  | { points: null; source: "unsized" };

export function resolveInvestmentPoints(item: InvestmentPointsInputs): InvestmentPoints {
  const estimated = typeof item.jobSize === "number" && item.jobSize > 0;
  if (item.estimateAgreed === true && estimated) return { points: item.jobSize as number, source: "agreed" };
  const points = resolveJobSize({ jobSize: item.jobSize, effortSize: item.effortSize });
  if (points === null) return { points: null, source: "unsized" };
  return { points, source: estimated ? "estimate" : "size-default" };
}

/** The UTC calendar quarter containing `now`: budgets are quarterly (design §1). */
export function quarterBounds(now: Date): { start: Date; end: Date } {
  const firstMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), firstMonth, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), firstMonth + 3, 1)),
  };
}
