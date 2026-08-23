// lib/hr/payroll-gl.ts — posting a pay run to the general ledger (BI-EAC670F1).
//
// lib/hr/payroll.ts computes what an employee is owed; lib/hr/payroll-run.ts
// persists it. Neither touches the ledger, so a run has always been invisible to
// the P&L. This module closes that: it turns payslips into balanced journal
// lines, which is what makes cost-of-labour real in the accounts rather than a
// number on a screen.
//
// The posting shape is the standard one:
//
//   Dr  Wages expense            gross earnings
//   Dr  Employer cost expense    employer NI / social security
//     Cr  Net pay payable        what actually leaves the bank later
//     Cr  Tax payable            employee statutory + employer statutory
//     Cr  Pension payable        pre-tax deductions withheld
//     Cr  Other deductions       post-tax deductions withheld
//
// Reimbursements ride the run as a separate expense debit and add to net pay —
// they are money owed to the employee that was never earnings, so they must not
// inflate wages expense or the tax base.
//
// Pure and DB-free: the caller supplies the account mapping and persists the
// result. Nothing here posts anything.

import type { PayComponent, Payslip } from "./payroll";

/** Chart-of-accounts codes this posting needs. Supplied per organization. */
export interface PayrollAccountMap {
  wagesExpense: string;
  employerCostExpense: string;
  reimbursementExpense: string;
  netPayPayable: string;
  taxPayable: string;
  pensionPayable: string;
  otherDeductionsPayable: string;
}

export interface DraftJournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
  sortOrder: number;
}

export interface PayrollPostingInput {
  /** Payslips in the run. */
  payslips: readonly PayrollPostablePayslip[];
  accounts: PayrollAccountMap;
  currency?: string;
}

/**
 * What the ledger needs from a payslip. Deliberately narrower than the full
 * Payslip type so a caller can post from persisted component rows OR from a
 * freshly computed payslip.
 */
export interface PayrollPostablePayslip {
  grossPay: number;
  netPay: number;
  earnings: readonly PayComponent[];
  employeeDeductions: readonly PayComponent[];
  employerCosts: readonly PayComponent[];
  /** Non-taxable amounts repaid to the employee (mileage, expenses). */
  reimbursements?: readonly PayComponent[];
  /** Codes in employeeDeductions that are statutory tax rather than voluntary. */
  statutoryCodes?: readonly string[];
  /** Codes in employeeDeductions that are pre-tax (pension/salary sacrifice). */
  preTaxCodes?: readonly string[];
}

export interface PayrollPosting {
  lines: readonly DraftJournalLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const sum = (components: readonly PayComponent[] = []): number =>
  round2(components.reduce((t, c) => t + c.amount, 0));

/**
 * Employee statutory deduction codes emitted by lib/hr/payroll.ts today ("TAX",
 * "NI"). Overridable rather than hardcoded because a jurisdiction plugging in its
 * own StatutoryDeductionFn names these differently — a US engine will emit
 * FED_WH / FICA / STATE_WH. Keeping the default in step with the engine means a
 * caller who supplies nothing still posts correctly.
 */
export const DEFAULT_STATUTORY_CODES = ["TAX", "NI"];

function partition(
  deductions: readonly PayComponent[],
  statutoryCodes: readonly string[],
  preTaxCodes: readonly string[],
): { statutory: PayComponent[]; preTax: PayComponent[]; other: PayComponent[] } {
  const statutory: PayComponent[] = [];
  const preTax: PayComponent[] = [];
  const other: PayComponent[] = [];
  for (const d of deductions) {
    if (statutoryCodes.includes(d.code)) statutory.push(d);
    else if (preTaxCodes.includes(d.code)) preTax.push(d);
    else other.push(d);
  }
  return { statutory, preTax, other };
}

/**
 * Build the journal lines for a pay run.
 *
 * Zero-value lines are omitted — an org with no pension scheme should not carry
 * an empty pension line on every run. The returned posting reports its own
 * balance rather than throwing, so a caller can surface an imbalance as a
 * finding instead of a crash; `balanced` false must block posting.
 */
export function buildPayrollPosting(input: PayrollPostingInput): PayrollPosting {
  const { payslips, accounts } = input;

  let wages = 0;
  let employerCost = 0;
  let reimbursement = 0;
  let netPay = 0;
  let tax = 0;
  let pension = 0;
  let other = 0;

  for (const slip of payslips) {
    const statutoryCodes = slip.statutoryCodes ?? DEFAULT_STATUTORY_CODES;
    const preTaxCodes = slip.preTaxCodes ?? [];
    const split = partition(slip.employeeDeductions, statutoryCodes, preTaxCodes);

    wages += sum(slip.earnings);
    employerCost += sum(slip.employerCosts);
    reimbursement += sum(slip.reimbursements);
    netPay += slip.netPay;
    // Employer statutory cost is also a liability to the authority, alongside
    // the employee's own withholding.
    tax += sum(split.statutory) + sum(slip.employerCosts);
    pension += sum(split.preTax);
    other += sum(split.other);
  }

  const candidates: DraftJournalLine[] = [
    { accountCode: accounts.wagesExpense, debit: round2(wages), credit: 0, description: "Wages expense", sortOrder: 0 },
    { accountCode: accounts.employerCostExpense, debit: round2(employerCost), credit: 0, description: "Employer contributions", sortOrder: 1 },
    { accountCode: accounts.reimbursementExpense, debit: round2(reimbursement), credit: 0, description: "Employee reimbursements", sortOrder: 2 },
    { accountCode: accounts.netPayPayable, debit: 0, credit: round2(netPay + reimbursement), description: "Net pay payable", sortOrder: 3 },
    { accountCode: accounts.taxPayable, debit: 0, credit: round2(tax), description: "Payroll tax payable", sortOrder: 4 },
    { accountCode: accounts.pensionPayable, debit: 0, credit: round2(pension), description: "Pension payable", sortOrder: 5 },
    { accountCode: accounts.otherDeductionsPayable, debit: 0, credit: round2(other), description: "Other deductions payable", sortOrder: 6 },
  ];

  const lines = candidates.filter((l) => l.debit !== 0 || l.credit !== 0);
  const totalDebit = round2(lines.reduce((t, l) => t + l.debit, 0));
  const totalCredit = round2(lines.reduce((t, l) => t + l.credit, 0));

  return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/**
 * Convenience adapter from the computed Payslip shape produced by
 * lib/hr/payroll.ts, so a caller can post straight after computing.
 */
export function postablePayslip(
  slip: Payslip,
  options: { statutoryCodes?: readonly string[]; preTaxCodes?: readonly string[] } = {},
): PayrollPostablePayslip {
  return {
    grossPay: slip.grossPay,
    netPay: slip.netPay,
    earnings: slip.earnings,
    employeeDeductions: slip.employeeDeductions,
    employerCosts: slip.employerCosts,
    statutoryCodes: options.statutoryCodes,
    preTaxCodes: options.preTaxCodes,
  };
}
