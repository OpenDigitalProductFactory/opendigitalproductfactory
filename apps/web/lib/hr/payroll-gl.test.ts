import { describe, expect, it } from "vitest";
import {
  buildPayrollPosting,
  postablePayslip,
  type PayrollAccountMap,
  type PayrollPostablePayslip,
} from "./payroll-gl";
import { computePayslip, flatRateStatutory } from "./payroll";

const ACCOUNTS: PayrollAccountMap = {
  wagesExpense: "6000",
  employerCostExpense: "6010",
  reimbursementExpense: "6020",
  netPayPayable: "2100",
  taxPayable: "2200",
  pensionPayable: "2300",
  otherDeductionsPayable: "2400",
};

function slip(over: Partial<PayrollPostablePayslip> = {}): PayrollPostablePayslip {
  return {
    grossPay: 5000,
    netPay: 3600,
    earnings: [{ code: "BASE", label: "Base salary", amount: 5000 }],
    employeeDeductions: [
      { code: "TAX", label: "Income tax", amount: 1000 },
      { code: "NI", label: "National insurance", amount: 400 },
    ],
    employerCosts: [{ code: "ERNI", label: "Employer NI", amount: 550 }],
    ...over,
  };
}

describe("buildPayrollPosting", () => {
  it("produces a balanced entry for a simple run", () => {
    const posting = buildPayrollPosting({ payslips: [slip()], accounts: ACCOUNTS });
    expect(posting.balanced).toBe(true);
    expect(posting.totalDebit).toBe(posting.totalCredit);
    // Dr 5000 wages + 550 employer cost = Cr 3600 net + 1950 tax
    expect(posting.totalDebit).toBe(5550);
  });

  it("debits wages at gross and credits net pay at net", () => {
    const posting = buildPayrollPosting({ payslips: [slip()], accounts: ACCOUNTS });
    const wages = posting.lines.find((l) => l.accountCode === "6000");
    const net = posting.lines.find((l) => l.accountCode === "2100");
    expect(wages?.debit).toBe(5000);
    expect(net?.credit).toBe(3600);
  });

  it("credits employer contributions to tax payable as well as expensing them", () => {
    const posting = buildPayrollPosting({ payslips: [slip()], accounts: ACCOUNTS });
    const employerExpense = posting.lines.find((l) => l.accountCode === "6010");
    const taxPayable = posting.lines.find((l) => l.accountCode === "2200");
    // Employer NI is both a cost to the business and a liability to the authority.
    expect(employerExpense?.debit).toBe(550);
    expect(taxPayable?.credit).toBe(1950);
  });

  it("separates pre-tax deductions from statutory tax", () => {
    const posting = buildPayrollPosting({
      payslips: [
        slip({
          netPay: 3350,
          employeeDeductions: [
            { code: "TAX", label: "Income tax", amount: 1000 },
            { code: "NI", label: "National insurance", amount: 400 },
            { code: "PENSION", label: "Pension", amount: 250 },
          ],
          preTaxCodes: ["PENSION"],
        }),
      ],
      accounts: ACCOUNTS,
    });
    expect(posting.lines.find((l) => l.accountCode === "2300")?.credit).toBe(250);
    expect(posting.balanced).toBe(true);
  });

  it("routes voluntary post-tax deductions to their own liability", () => {
    const posting = buildPayrollPosting({
      payslips: [
        slip({
          netPay: 3500,
          employeeDeductions: [
            { code: "TAX", label: "Income tax", amount: 1000 },
            { code: "NI", label: "National insurance", amount: 400 },
            { code: "LOAN", label: "Staff loan", amount: 100 },
          ],
        }),
      ],
      accounts: ACCOUNTS,
    });
    expect(posting.lines.find((l) => l.accountCode === "2400")?.credit).toBe(100);
    expect(posting.balanced).toBe(true);
  });

  it("keeps reimbursements out of wages and out of the tax base", () => {
    const posting = buildPayrollPosting({
      payslips: [slip({ reimbursements: [{ code: "MILEAGE", label: "Mileage", amount: 120 }] })],
      accounts: ACCOUNTS,
    });
    const wages = posting.lines.find((l) => l.accountCode === "6000");
    const reimb = posting.lines.find((l) => l.accountCode === "6020");
    const net = posting.lines.find((l) => l.accountCode === "2100");
    const tax = posting.lines.find((l) => l.accountCode === "2200");

    // Mileage is money owed, never earnings: wages and tax are untouched, but
    // the employee is paid it.
    expect(wages?.debit).toBe(5000);
    expect(reimb?.debit).toBe(120);
    expect(net?.credit).toBe(3720);
    expect(tax?.credit).toBe(1950);
    expect(posting.balanced).toBe(true);
  });

  it("omits zero-value lines rather than carrying empty ones", () => {
    const posting = buildPayrollPosting({ payslips: [slip()], accounts: ACCOUNTS });
    // No pension scheme, no reimbursements, no voluntary deductions.
    expect(posting.lines.map((l) => l.accountCode)).toEqual(["6000", "6010", "2100", "2200"]);
  });

  it("aggregates a multi-employee run into one balanced entry", () => {
    const posting = buildPayrollPosting({
      payslips: [slip(), slip(), slip()],
      accounts: ACCOUNTS,
    });
    expect(posting.totalDebit).toBe(16650);
    expect(posting.balanced).toBe(true);
  });

  it("reports an imbalance instead of throwing so a caller can block posting", () => {
    // A payslip whose net pay does not reconcile to gross less deductions.
    const posting = buildPayrollPosting({
      payslips: [slip({ netPay: 9999 })],
      accounts: ACCOUNTS,
    });
    expect(posting.balanced).toBe(false);
    expect(posting.totalDebit).not.toBe(posting.totalCredit);
  });

  it("posts an empty run as an empty, trivially balanced entry", () => {
    const posting = buildPayrollPosting({ payslips: [], accounts: ACCOUNTS });
    expect(posting.lines).toHaveLength(0);
    expect(posting.balanced).toBe(true);
  });
});

describe("postablePayslip", () => {
  it("posts a payslip straight from the gross-to-net engine and balances", () => {
    const computed = computePayslip({
      baseSalary: 4000,
      statutory: flatRateStatutory({ incomeTaxRate: 0.2, employeeNIRate: 0.08, employerNIRate: 0.11 }),
    });
    const posting = buildPayrollPosting({
      payslips: [postablePayslip(computed)],
      accounts: ACCOUNTS,
    });
    // The engine and the ledger must agree without anyone reconciling by hand.
    expect(posting.balanced).toBe(true);
    expect(posting.lines.find((l) => l.accountCode === "6000")?.debit).toBe(computed.grossPay);
    expect(posting.lines.find((l) => l.accountCode === "2100")?.credit).toBe(computed.netPay);
  });
});
