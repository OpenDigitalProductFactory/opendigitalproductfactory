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

// ── The W-4 in force (BI-2BC8D614) ───────────────────────────────────────────
// A W-4 is recorded as an EmploymentEvent of type "withholding_recorded" whose
// metadata holds the form's answers, plus the two-letter state where the work
// is done. effectiveAt is the first pay date the form governs, so a new form
// never re-prices an earlier run.

export const WITHHOLDING_EVENT_TYPE = "withholding_recorded";

export interface RecordedW4 extends W4Election {
  /** Two-letter US state where the work is performed. */
  workStateCode: string;
}

const FILING_STATUSES = new Set<string>(["single", "married_jointly", "head_of_household"]);

/** Read a W-4 from event metadata, or null when it is not a complete form. */
export function parseRecordedW4(metadata: unknown): RecordedW4 | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const status = typeof m.filingStatus === "string" && FILING_STATUSES.has(m.filingStatus) ? (m.filingStatus as FilingStatus) : null;
  const state = typeof m.workStateCode === "string" && /^[A-Z]{2}$/.test(m.workStateCode) ? m.workStateCode : null;
  const amounts = [m.step3Credits, m.step4aOtherIncome, m.step4bDeductions, m.step4cExtraWithholding].map(num);
  if (!status || !state || amounts.some((a) => a === null) || typeof m.step2Checked !== "boolean" || typeof m.exempt !== "boolean") {
    return null;
  }
  return {
    filingStatus: status,
    step2Checked: m.step2Checked,
    step3Credits: amounts[0]!,
    step4aOtherIncome: amounts[1]!,
    step4bDeductions: amounts[2]!,
    step4cExtraWithholding: amounts[3]!,
    exempt: m.exempt,
    workStateCode: state,
  };
}

/** The latest complete W-4 effective on or before `on`, or null. */
export function w4InForce(
  events: ReadonlyArray<{ eventType: string; effectiveAt: Date; metadata: unknown; createdAt?: Date }>,
  on: Date,
): RecordedW4 | null {
  const candidates = events
    .filter((e) => e.eventType === WITHHOLDING_EVENT_TYPE && e.effectiveAt.getTime() <= on.getTime())
    .sort((a, b) =>
      b.effectiveAt.getTime() - a.effectiveAt.getTime()
      || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  for (const event of candidates) {
    const parsed = parseRecordedW4(event.metadata);
    if (parsed) return parsed;
  }
  return null;
}
