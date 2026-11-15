import { describe, expect, it } from "vitest";

import { approvalJournal, paymentJournal, taxesToRemit, type PayrollAccountIds } from "./pay-run-books";

const ids: PayrollAccountIds = {
  wagesExpense: "A-WAGES", payrollTaxExpense: "A-ERTAX", netPayPayable: "A-NET",
  payrollTaxPayable: "A-TAXPAY", payrollDeductionsPayable: "A-DED", bank: "A-BANK",
};

// The hand-worked payslip from us-pay-run.test.ts: single, biweekly 2,000, Texas.
const slip = {
  netPay: 1_690.85,
  earnings: [{ code: "BASE", label: "Base salary", amount: 2_000 }],
  employeeDeductions: [
    { code: "US_FWT", label: "Federal income tax", amount: 156.15 },
    { code: "US_SS_EE", label: "Social Security", amount: 124 },
    { code: "US_MED_EE", label: "Medicare", amount: 29 },
  ],
  employerCosts: [
    { code: "US_SS_ER", label: "Social Security (employer)", amount: 124 },
    { code: "US_MED_ER", label: "Medicare (employer)", amount: 29 },
    { code: "US_FUTA", label: "Federal unemployment (FUTA)", amount: 12 },
    { code: "US_SUTA", label: "State unemployment (SUTA)", amount: 54 },
  ],
};

const net = (lines: { debit: number; credit: number }[]) =>
  Math.round(lines.reduce((t, l) => t + l.debit - l.credit, 0) * 100) / 100;

describe("approvalJournal", () => {
  it("books wages and employer taxes against net pay and payroll taxes owed, balanced", () => {
    const lines = approvalJournal([slip], ids)!;
    expect(net(lines)).toBe(0);
    const by = (id: string) => lines.find((l) => l.accountId === id)!;
    expect(by("A-WAGES").debit).toBe(2_000);
    expect(by("A-ERTAX").debit).toBe(219);
    expect(by("A-NET").credit).toBe(1_690.85);
    // 156.15 + 124 + 29 withheld, plus 219 employer: everything owed to authorities.
    expect(by("A-TAXPAY").credit).toBe(528.15);
    // US withholding is tax, never an "other deduction".
    expect(lines.some((l) => l.accountId === "A-DED")).toBe(false);
  });

  it("refuses a run with nothing to post", () => {
    expect(approvalJournal([], ids)).toBeNull();
  });
});

describe("paymentJournal", () => {
  it("moves net pay out of the bank", () => {
    expect(paymentJournal([slip, slip], ids)).toEqual([
      { accountId: "A-NET", debit: 3_381.7, credit: 0, description: "Net pay paid" },
      { accountId: "A-BANK", debit: 0, credit: 3_381.7, description: "Net pay paid" },
    ]);
  });
});

describe("taxesToRemit", () => {
  it("totals each tax across payslips, employee and employer lines kept by name", () => {
    expect(taxesToRemit([slip, slip])).toEqual([
      { label: "Federal income tax", amount: 312.3 },
      { label: "Social Security", amount: 248 },
      { label: "Medicare", amount: 58 },
      { label: "Social Security (employer)", amount: 248 },
      { label: "Medicare (employer)", amount: 58 },
      { label: "Federal unemployment (FUTA)", amount: 24 },
      { label: "State unemployment (SUTA)", amount: 108 },
    ]);
  });
});
