// lib/hr/federal-withholding.ts — US federal income tax withholding by IRS
// Publication 15-T Worksheet 1A, the percentage method for automated payroll
// systems, for a Form W-4 from 2020 or later (BI-2BC8D614).
//
// statutory-us.ts withheld with one standard deduction and one bracket list,
// which is not how the IRS method works: the employee's W-4 decides which
// table applies (filing status, and the Step 2 checkbox), adds and subtracts
// annual amounts before the table (Steps 4(a), 4(b) and the line 1g amount),
// and takes credits and extra withholding after it (Steps 3 and 4(c)).
//
// Pure and figure-free. Every bracket and the line 1g amounts arrive as data
// built from person-confirmed PayrollTaxRule rows; nothing here is a rate.

export type FilingStatus = "single" | "married_jointly" | "head_of_household";

/** One row of an Annual Percentage Method table: wages over `over` are taxed at `rate`. */
export interface WithholdingBracket {
  over: number;
  rate: number;
}

export interface FederalWithholdingTables {
  /** Worksheet 1A line 1g, used only when the Step 2 box is NOT checked. */
  line1g: { married_jointly: number; other: number };
  schedules: Record<FilingStatus, { standard: readonly WithholdingBracket[]; step2: readonly WithholdingBracket[] }>;
}

/** What the employee wrote on Form W-4 (2020 or later). All amounts are annual except 4(c). */
export interface W4Election {
  filingStatus: FilingStatus;
  step2Checked: boolean;
  step3Credits: number;
  step4aOtherIncome: number;
  step4bDeductions: number;
  /** Extra withholding per pay period. */
  step4cExtraWithholding: number;
  /** "Exempt" written below Step 4(c): no federal income tax is withheld. */
  exempt: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Tax on an annual amount from a table of `over` thresholds, lowest first. */
export function annualTableTax(adjustedAnnualWage: number, brackets: readonly WithholdingBracket[]): number {
  const rows = [...brackets].sort((a, b) => a.over - b.over);
  let tax = 0;
  for (let i = 0; i < rows.length; i++) {
    const floor = rows[i]!.over;
    if (adjustedAnnualWage <= floor) break;
    const ceiling = rows[i + 1]?.over ?? Number.POSITIVE_INFINITY;
    tax += (Math.min(adjustedAnnualWage, ceiling) - floor) * rows[i]!.rate;
  }
  return tax;
}

/**
 * Federal income tax to withhold for one pay period.
 *
 * Steps mirror the worksheet so the arithmetic can be checked line by line.
 * Intermediate values keep full precision; only the result is rounded to cents.
 */
export function federalWithholdingWorksheet1A(
  input: { periodWages: number; periodsPerYear: number; w4: W4Election },
  tables: FederalWithholdingTables,
): number {
  const { periodWages, periodsPerYear, w4 } = input;
  if (w4.exempt) return 0;

  // Step 1 — adjust the employee's payment amount.
  const line1c = periodWages * periodsPerYear;
  const line1e = line1c + w4.step4aOtherIncome;
  const line1g = w4.step2Checked
    ? 0
    : w4.filingStatus === "married_jointly" ? tables.line1g.married_jointly : tables.line1g.other;
  const line1h = w4.step4bDeductions + line1g;
  const line1i = Math.max(line1e - line1h, 0);

  // Step 2 — tentative withholding from the table the W-4 selects.
  const schedule = tables.schedules[w4.filingStatus];
  const table = w4.step2Checked ? schedule.step2 : schedule.standard;
  const line2h = annualTableTax(line1i, table) / periodsPerYear;

  // Step 3 — credits, never below zero.
  const line3c = Math.max(line2h - w4.step3Credits / periodsPerYear, 0);

  // Step 4 — extra withholding the employee asked for.
  return round2(line3c + w4.step4cExtraWithholding);
}
