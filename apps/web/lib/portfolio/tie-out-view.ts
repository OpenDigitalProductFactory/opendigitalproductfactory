// Display rules for the portfolio tie-out (BI-CBF5D708, design §6). Pure, so the
// wording a person reads is tested: over-commitment is always stated in numbers
// (points and weeks), never by colour alone, and a missing budget reads "No
// budget set", never zero.

import type { TieOutRow } from "./tie-out";
import { portfolioBudgetLabel } from "./budget-label";

export type TieOutTone = "danger" | "warning" | "success" | "neutral";

export function budgetText(row: Pick<TieOutRow, "budget" | "portfolioId">): string {
  if (row.portfolioId === null) return "Not budgeted";
  return portfolioBudgetLabel(row.budget);
}

export function forecastText(row: Pick<TieOutRow, "forecast">): string {
  const { low, high, label } = row.forecast;
  const range = low === high ? `${low}` : `${low}–${high}`;
  return label === "estimated" ? `${range} (estimated)` : range;
}

/** "+582 to +696 over; 22 weeks of work at the current pace" — the commitment stated two ways. */
export function overCommitmentText(row: Pick<TieOutRow, "committedPoints" | "overCommitment">): { text: string; tone: TieOutTone } {
  const { pointsLow, pointsHigh, weeks } = row.overCommitment;
  if (row.committedPoints === 0) return { text: "Nothing committed", tone: "neutral" };
  const pace = weeks === null
    ? "no delivery measured to pace it"
    : weeks > 0
      ? `${weeks} weeks of work beyond the quarter at the current pace`
      : `clears ${Math.abs(weeks)} weeks before the quarter ends at the current pace`;
  if (pointsLow > 0) {
    return { text: `${signed(pointsLow)} to ${signed(pointsHigh)} points over capacity; ${pace}`, tone: "danger" };
  }
  if (pointsHigh > 0) {
    return { text: `Up to ${signed(pointsHigh)} points over, depending on pace; ${pace}`, tone: "warning" };
  }
  return { text: `Within capacity by ${Math.abs(pointsHigh)} to ${Math.abs(pointsLow)} points`, tone: "success" };
}

export function tracedText(row: Pick<TieOutRow, "tracedShare">): string {
  return row.tracedShare === null ? "Nothing delivered yet" : `${Math.round(row.tracedShare * 100)}% traced`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * The one sentence the panel shows on arrival; the table sits behind a
 * disclosure (UX route budget). It names how many portfolios are committed past
 * capacity and how much delivered work the platform can trace.
 */
export function tieOutHeadline(tieOut: { rows: Array<Pick<TieOutRow, "portfolioId" | "overCommitment" | "committedPoints" | "deliveredPoints" | "tracedShare">> }): string {
  const portfolios = tieOut.rows.filter((r) => r.portfolioId !== null);
  const over = portfolios.filter((r) => r.committedPoints > 0 && r.overCommitment.pointsLow > 0).length;
  const delivered = tieOut.rows.reduce((sum, r) => sum + r.deliveredPoints, 0);
  const traced = tieOut.rows.reduce((sum, r) => sum + (r.tracedShare ?? 0) * r.deliveredPoints, 0);
  const commitment = over === 0
    ? `All ${portfolios.length} portfolios fit their measured capacity`
    : `${over} of ${portfolios.length} portfolios are committed past capacity`;
  const tracing = delivered > 0 ? `; ${Math.round((traced / delivered) * 100)}% of delivered work is traced` : "";
  return `${commitment}${tracing}.`;
}
