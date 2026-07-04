// lib/hr/payroll.ts — gross-to-net payroll engine (SAP HCM / SuccessFactors payroll)
//
// The substantive, hard part of payroll: turning what someone earned into what lands
// in their account, and what it costs the employer. Pure and DB-free so every rule is
// unit-testable; the PayRun / Payslip persistence and the GL posting
// (Dr Wages Expense / Cr Net Pay Payable / Cr Tax Payable …) are separate follow-ups.
//
// STATUTORY TAX IS PLUGGABLE, NOT HARDCODED. Real income-tax / national-insurance /
// social-security rules are jurisdiction-specific and change yearly, so this engine
// takes a `StatutoryDeductionFn` rather than baking in one country's bands — the same
// stance as the ERP-sync seam elsewhere in finance. `flatRateStatutory` is a simple
// default for demos/tests; a production jurisdiction plugs in its own function.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A named money line on a payslip (an earning, a deduction, or an employer cost). */
export type PayComponent = { code: string; label: string; amount: number };

export type StatutoryContext = {
  /** Total gross earnings for the period. */
  gross: number;
  /** Gross less pre-tax deductions — the base statutory tax is charged on. */
  taxable: number;
};

export type StatutoryResult = {
  /** Employee income tax / PAYE. */
  incomeTax: number;
  /** Employee national insurance / social-security contribution. */
  employeeNI: number;
  /** Employer national insurance / social-security contribution (an employer cost). */
  employerNI: number;
};

/** Pluggable statutory-deduction calculation — supply your jurisdiction's rules. */
export type StatutoryDeductionFn = (ctx: StatutoryContext) => StatutoryResult;

export type PayrollInput = {
  /** Fixed salary for the period (for salaried staff). */
  baseSalary?: number;
  /** Hours × rate (for hourly staff) — e.g. from approved timesheets. */
  hoursWorked?: number;
  hourlyRate?: number;
  /** Overtime hours × the overtime hourly rate. */
  overtimeHours?: number;
  overtimeRate?: number;
  /** Bonuses, allowances, etc. */
  additions?: PayComponent[];
  /** Pre-tax deductions (reduce taxable pay) — e.g. salary-sacrifice pension. */
  preTaxDeductions?: PayComponent[];
  /** Post-tax deductions — e.g. a loan repayment. */
  postTaxDeductions?: PayComponent[];
  statutory: StatutoryDeductionFn;
};

export type Payslip = {
  grossPay: number;
  taxablePay: number;
  earnings: PayComponent[];
  /** Everything taken off the employee: statutory + post-tax + pre-tax. */
  employeeDeductions: PayComponent[];
  netPay: number;
  /** Costs the employer bears on top of gross (employer NI, …). */
  employerCosts: PayComponent[];
  /** Gross + employer costs — the true cost of the employee for the period. */
  totalEmployerCost: number;
};

function sum(components: PayComponent[]): number {
  return round2(components.reduce((t, c) => t + c.amount, 0));
}

/**
 * Compute a payslip from earnings and a pluggable statutory calculation:
 *   gross      = base + hours×rate + overtime + additions
 *   taxable    = gross − pre-tax deductions
 *   net        = gross − pre-tax − income tax − employee NI − post-tax
 *   total cost = gross + employer NI (and any other employer costs)
 *
 * Net pay can never be negative — if deductions exceed gross it is floored at 0 (the
 * shortfall is a payroll error the caller should surface, not a negative payment).
 */
export function computePayslip(input: PayrollInput): Payslip {
  const earnings: PayComponent[] = [];
  if (input.baseSalary) earnings.push({ code: "BASE", label: "Base salary", amount: round2(input.baseSalary) });
  if (input.hoursWorked && input.hourlyRate) {
    earnings.push({ code: "HOURS", label: "Hours worked", amount: round2(input.hoursWorked * input.hourlyRate) });
  }
  if (input.overtimeHours && input.overtimeRate) {
    earnings.push({ code: "OT", label: "Overtime", amount: round2(input.overtimeHours * input.overtimeRate) });
  }
  for (const a of input.additions ?? []) earnings.push({ ...a, amount: round2(a.amount) });

  const grossPay = sum(earnings);
  const preTax = input.preTaxDeductions ?? [];
  const preTaxTotal = sum(preTax);
  const taxablePay = round2(Math.max(grossPay - preTaxTotal, 0));

  const stat = input.statutory({ gross: grossPay, taxable: taxablePay });
  const incomeTax = round2(Math.max(stat.incomeTax, 0));
  const employeeNI = round2(Math.max(stat.employeeNI, 0));
  const employerNI = round2(Math.max(stat.employerNI, 0));
  const postTax = input.postTaxDeductions ?? [];

  const employeeDeductions: PayComponent[] = [
    ...preTax.map((d) => ({ ...d, amount: round2(d.amount) })),
    { code: "TAX", label: "Income tax", amount: incomeTax },
    { code: "NI", label: "National insurance", amount: employeeNI },
    ...postTax.map((d) => ({ ...d, amount: round2(d.amount) })),
  ];

  const netPay = round2(Math.max(grossPay - sum(employeeDeductions), 0));
  const employerCosts: PayComponent[] = [{ code: "ERNI", label: "Employer NI", amount: employerNI }];
  const totalEmployerCost = round2(grossPay + sum(employerCosts));

  return {
    grossPay,
    taxablePay,
    earnings,
    employeeDeductions,
    netPay,
    employerCosts,
    totalEmployerCost,
  };
}

/** Parameters for the simple default statutory calculation (demo / SMB / tests). */
export type FlatRateStatutoryParams = {
  /** Tax-free allowance per period before income tax applies. */
  taxFreeAllowance?: number;
  /** Income-tax rate on taxable pay above the allowance (e.g. 0.2 = 20%). */
  incomeTaxRate: number;
  /** Employee NI rate on gross above the NI threshold. */
  employeeNIRate: number;
  /** Employer NI rate on gross above the NI threshold. */
  employerNIRate: number;
  /** Gross per period below which no NI is due. */
  niThreshold?: number;
};

/**
 * A simple threshold-and-flat-rate statutory calculation for demos, tests and SMB
 * defaults. NOT a substitute for a real jurisdiction engine — production installs
 * plug in their country's bands via a `StatutoryDeductionFn`.
 */
export function flatRateStatutory(params: FlatRateStatutoryParams): StatutoryDeductionFn {
  const allowance = params.taxFreeAllowance ?? 0;
  const niThreshold = params.niThreshold ?? 0;
  return ({ gross, taxable }) => {
    const taxBase = Math.max(taxable - allowance, 0);
    const niBase = Math.max(gross - niThreshold, 0);
    return {
      incomeTax: round2(taxBase * params.incomeTaxRate),
      employeeNI: round2(niBase * params.employeeNIRate),
      employerNI: round2(niBase * params.employerNIRate),
    };
  };
}
