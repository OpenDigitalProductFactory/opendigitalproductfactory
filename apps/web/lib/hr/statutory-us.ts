// lib/hr/statutory-us.ts — US payroll statutory calculation (BI-4EB27955).
//
// lib/hr/payroll.ts deliberately takes a pluggable StatutoryDeductionFn rather
// than baking in one country's rules. This module supplies the US shape WITHOUT
// baking in the numbers: every rate, wage base and threshold arrives as
// effective-dated DATA (a UsPayrollTaxRuleSet, persisted as PayrollTaxRule rows),
// and this file is only the mechanism that applies them.
//
// That split is not stylistic. US rates change annually and a wage base printed
// into source becomes wrong every January in a way no test catches — the suite
// keeps passing while every payslip is quietly incorrect. Rates as data with a
// cited sourceUrl and an effective window are auditable; rates as constants are
// a silent liability.
//
// SCOPE: this computes withholding and contributions from a supplied rule set.
// It does NOT ship the 2026 IRS/state figures — seeding those is a separate,
// source-cited data task, because publishing a number here that I cannot cite
// would be a fabrication with money attached.

/** One progressive bracket. `upTo` null means "and everything above". */
export interface TaxBracket {
  upTo: number | null;
  rate: number;
}

export interface UsFederalWithholdingRules {
  /** Standard deduction applied before the brackets, per pay period. */
  standardDeductionPerPeriod: number;
  brackets: readonly TaxBracket[];
}

export interface UsFicaRules {
  socialSecurityRate: number;
  /** Annual wage ceiling for Social Security. Above it, no further SS is due. */
  socialSecurityWageBase: number;
  medicareRate: number;
  /** Extra employee-only Medicare above the threshold. Employer does not match. */
  additionalMedicareRate: number;
  additionalMedicareThreshold: number;
}

export interface UsUnemploymentRules {
  /** Employer-only. */
  futaRate: number;
  futaWageBase: number;
  sutaRate: number;
  sutaWageBase: number;
}

export interface UsStateWithholdingRules {
  stateCode: string;
  standardDeductionPerPeriod: number;
  brackets: readonly TaxBracket[];
}

export interface UsPayrollTaxRuleSet {
  taxYear: number;
  periodsPerYear: number;
  federal: UsFederalWithholdingRules;
  fica: UsFicaRules;
  unemployment: UsUnemploymentRules;
  /** Omitted for a no-income-tax state (TX, FL, WA, …). */
  state?: UsStateWithholdingRules;
}

/** Year-to-date figures, needed because caps are annual but pay is periodic. */
export interface YearToDate {
  grossYtd: number;
  socialSecurityWagesYtd: number;
  medicareWagesYtd: number;
  futaWagesYtd: number;
  sutaWagesYtd: number;
}

export const ZERO_YTD: YearToDate = {
  grossYtd: 0,
  socialSecurityWagesYtd: 0,
  medicareWagesYtd: 0,
  futaWagesYtd: 0,
  sutaWagesYtd: 0,
};

export interface UsStatutoryResult {
  federalWithholding: number;
  stateWithholding: number;
  socialSecurityEmployee: number;
  socialSecurityEmployer: number;
  medicareEmployee: number;
  medicareEmployer: number;
  additionalMedicareEmployee: number;
  futaEmployer: number;
  sutaEmployer: number;
  totalEmployee: number;
  totalEmployer: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Wages still subject to a capped tax this period, given the annual ceiling and
 * what has already been taxed. Returns 0 once the cap is reached — never a
 * negative, which would refund tax that was correctly withheld.
 */
export function cappedWages(periodWages: number, ytdWages: number, wageBase: number): number {
  const remaining = wageBase - ytdWages;
  if (remaining <= 0) return 0;
  return Math.min(periodWages, remaining);
}

/** Progressive bracket tax on an annualized amount. */
export function bracketTax(annualTaxable: number, brackets: readonly TaxBracket[]): number {
  let remaining = annualTaxable;
  let previousCeiling = 0;
  let tax = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const ceiling = bracket.upTo ?? Number.POSITIVE_INFINITY;
    const span = ceiling - previousCeiling;
    const taxedHere = Math.min(remaining, span);
    tax += taxedHere * bracket.rate;
    remaining -= taxedHere;
    previousCeiling = ceiling;
  }
  return tax;
}

/**
 * Withholding via the annualized method: annualize the period's taxable pay,
 * apply the standard deduction and brackets, then divide back down. This is how
 * a progressive annual schedule is applied to a periodic paycheck without the
 * first pay period of the year being taxed as though it were the whole year.
 */
function periodWithholding(
  taxablePeriodPay: number,
  standardDeductionPerPeriod: number,
  brackets: readonly TaxBracket[],
  periodsPerYear: number,
): number {
  const afterDeduction = Math.max(taxablePeriodPay - standardDeductionPerPeriod, 0);
  const annualized = afterDeduction * periodsPerYear;
  return round2(bracketTax(annualized, brackets) / periodsPerYear);
}

/**
 * Compute US statutory amounts for one pay period.
 *
 * `taxablePay` is gross less pre-tax deductions — the payroll engine has already
 * done that subtraction. FICA is charged on its own base (`ficaWages`), which
 * differs from income-tax-taxable pay because some pre-tax deductions reduce one
 * and not the other; the caller supplies both rather than this module guessing.
 */
export function computeUsStatutory(
  input: {
    taxablePay: number;
    ficaWages: number;
    ytd?: YearToDate;
  },
  rules: UsPayrollTaxRuleSet,
): UsStatutoryResult {
  const ytd = input.ytd ?? ZERO_YTD;
  const { fica, unemployment, federal, state } = rules;

  const federalWithholding = periodWithholding(
    input.taxablePay,
    federal.standardDeductionPerPeriod,
    federal.brackets,
    rules.periodsPerYear,
  );

  const stateWithholding = state
    ? periodWithholding(
        input.taxablePay,
        state.standardDeductionPerPeriod,
        state.brackets,
        rules.periodsPerYear,
      )
    : 0;

  const ssWages = cappedWages(input.ficaWages, ytd.socialSecurityWagesYtd, fica.socialSecurityWageBase);
  const socialSecurityEmployee = round2(ssWages * fica.socialSecurityRate);

  const medicareEmployee = round2(input.ficaWages * fica.medicareRate);

  // Additional Medicare applies only to the portion above the threshold, and
  // only to the employee — the employer does not match it.
  const overThreshold = Math.max(
    input.ficaWages + ytd.medicareWagesYtd - fica.additionalMedicareThreshold,
    0,
  );
  const additionalMedicareBase = Math.min(overThreshold, input.ficaWages);
  const additionalMedicareEmployee = round2(additionalMedicareBase * fica.additionalMedicareRate);

  const futaWages = cappedWages(input.ficaWages, ytd.futaWagesYtd, unemployment.futaWageBase);
  const sutaWages = cappedWages(input.ficaWages, ytd.sutaWagesYtd, unemployment.sutaWageBase);

  const socialSecurityEmployer = socialSecurityEmployee;
  const medicareEmployer = medicareEmployee;
  const futaEmployer = round2(futaWages * unemployment.futaRate);
  const sutaEmployer = round2(sutaWages * unemployment.sutaRate);

  const totalEmployee = round2(
    federalWithholding +
      stateWithholding +
      socialSecurityEmployee +
      medicareEmployee +
      additionalMedicareEmployee,
  );
  const totalEmployer = round2(
    socialSecurityEmployer + medicareEmployer + futaEmployer + sutaEmployer,
  );

  return {
    federalWithholding,
    stateWithholding,
    socialSecurityEmployee,
    socialSecurityEmployer,
    medicareEmployee,
    medicareEmployer,
    additionalMedicareEmployee,
    futaEmployer,
    sutaEmployer,
    totalEmployee,
    totalEmployer,
  };
}

/**
 * Adapt the US calculation to the StatutoryDeductionFn the gross-to-net engine
 * expects. The engine's shape has one income-tax slot and one employee/employer
 * social-security pair, so federal and state withholding are summed into
 * incomeTax and the FICA family into the NI slots. The full breakdown stays
 * available from computeUsStatutory for payslip lines and tax filing.
 */
export function usStatutory(rules: UsPayrollTaxRuleSet, ytd: YearToDate = ZERO_YTD) {
  return ({ gross, taxable }: { gross: number; taxable: number }) => {
    const r = computeUsStatutory({ taxablePay: taxable, ficaWages: gross, ytd }, rules);
    return {
      incomeTax: round2(r.federalWithholding + r.stateWithholding),
      employeeNI: round2(
        r.socialSecurityEmployee + r.medicareEmployee + r.additionalMedicareEmployee,
      ),
      employerNI: r.totalEmployer,
    };
  };
}
