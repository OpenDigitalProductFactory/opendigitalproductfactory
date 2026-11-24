// lib/hr/pay-run-books.ts — what approving and paying a pay run does to the
// books, and what it leaves to remit (BI-3B8FA6D8). Pure; the server module
// (pay-run-books.server.ts) reads, writes and enforces who may act.
//
//   Approve:  Dr Wages and Salaries        gross earnings
//             Dr Employer Payroll Taxes    the employer's own taxes
//               Cr Net Pay Payable         what each employee is owed
//               Cr Payroll Taxes Payable   withholding + employer taxes
//               Cr Payroll Deductions Payable  anything else withheld
//
//   Paid:     Dr Net Pay Payable  /  Cr Cash at Bank   for the run's net pay
//
// Payroll taxes stay in Payroll Taxes Payable until the owner remits them, so
// the balance there is exactly what is owed to the authorities.

import { buildPayrollPosting, type DraftJournalLine } from "./payroll-gl";
import type { PayComponent } from "./payroll";
import { US_STATUTORY_CODES } from "./statutory-us";

/** Employee-side codes that are tax withheld, not a voluntary deduction. */
export const STATUTORY_EMPLOYEE_CODES: readonly string[] = [
  US_STATUTORY_CODES.federalWithholding,
  US_STATUTORY_CODES.stateWithholding,
  US_STATUTORY_CODES.socialSecurityEmployee,
  US_STATUTORY_CODES.medicareEmployee,
  US_STATUTORY_CODES.additionalMedicareEmployee,
  // The generic engine's codes, so a non-US run posts the same way.
  "TAX",
  "NI",
];

export interface RunPayslip {
  netPay: number;
  earnings: readonly PayComponent[];
  employeeDeductions: readonly PayComponent[];
  employerCosts: readonly PayComponent[];
}

export interface PayrollAccountIds {
  wagesExpense: string;
  payrollTaxExpense: string;
  netPayPayable: string;
  payrollTaxPayable: string;
  payrollDeductionsPayable: string;
  bank: string;
}

export interface BooksLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The approval journal for a run, or null when it would not balance. */
export function approvalJournal(payslips: readonly RunPayslip[], ids: PayrollAccountIds): BooksLine[] | null {
  const posting = buildPayrollPosting({
    payslips: payslips.map((p) => ({
      grossPay: 0,
      netPay: p.netPay,
      earnings: p.earnings,
      employeeDeductions: p.employeeDeductions,
      employerCosts: p.employerCosts,
      statutoryCodes: STATUTORY_EMPLOYEE_CODES,
      // Pre-tax deductions are withheld amounts like any other; they share the
      // deductions payable account.
      preTaxCodes: [],
    })),
    accounts: {
      wagesExpense: ids.wagesExpense,
      employerCostExpense: ids.payrollTaxExpense,
      reimbursementExpense: ids.wagesExpense,
      netPayPayable: ids.netPayPayable,
      taxPayable: ids.payrollTaxPayable,
      pensionPayable: ids.payrollDeductionsPayable,
      otherDeductionsPayable: ids.payrollDeductionsPayable,
    },
  });
  if (!posting.balanced || posting.lines.length < 2) return null;
  return posting.lines.map((l: DraftJournalLine) => ({
    accountId: l.accountCode,
    debit: l.debit,
    credit: l.credit,
    description: l.description,
  }));
}

/** The payment journal: net pay leaves the bank. */
export function paymentJournal(payslips: readonly RunPayslip[], ids: PayrollAccountIds): BooksLine[] | null {
  const net = round2(payslips.reduce((t, p) => t + p.netPay, 0));
  if (net <= 0) return null;
  return [
    { accountId: ids.netPayPayable, debit: net, credit: 0, description: "Net pay paid" },
    { accountId: ids.bank, debit: 0, credit: net, description: "Net pay paid" },
  ];
}

/** What a run leaves to remit, by tax, employee and employer shares combined. */
export function taxesToRemit(payslips: readonly RunPayslip[]): Array<{ label: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const slip of payslips) {
    for (const line of [...slip.employeeDeductions, ...slip.employerCosts]) {
      const isStatutory = STATUTORY_EMPLOYEE_CODES.includes(line.code) || slip.employerCosts.includes(line);
      if (!isStatutory || line.amount === 0) continue;
      totals.set(line.label, round2((totals.get(line.label) ?? 0) + line.amount));
    }
  }
  return [...totals.entries()].map(([label, amount]) => ({ label, amount }));
}
