import { describe, it, expect } from "vitest";
import { computePayslip, flatRateStatutory } from "./payroll";

// 20% income tax above a 1000 allowance; 10% employee / 13.8% employer NI above 800.
const statutory = flatRateStatutory({
  taxFreeAllowance: 1000,
  incomeTaxRate: 0.2,
  employeeNIRate: 0.1,
  employerNIRate: 0.138,
  niThreshold: 800,
});

describe("computePayslip", () => {
  it("computes gross → net for a salaried employee", () => {
    const slip = computePayslip({ baseSalary: 3000, statutory });
    expect(slip.grossPay).toBe(3000);
    expect(slip.taxablePay).toBe(3000);
    // income tax = (3000 − 1000) × 20% = 400; employee NI = (3000 − 800) × 10% = 220
    const tax = slip.employeeDeductions.find((d) => d.code === "TAX")!;
    const ni = slip.employeeDeductions.find((d) => d.code === "NI")!;
    expect(tax.amount).toBe(400);
    expect(ni.amount).toBe(220);
    expect(slip.netPay).toBe(3000 - 400 - 220); // 2380
  });

  it("computes hourly + overtime earnings", () => {
    const slip = computePayslip({
      hoursWorked: 100,
      hourlyRate: 20,
      overtimeHours: 10,
      overtimeRate: 30,
      statutory,
    });
    // 100×20 + 10×30 = 2300
    expect(slip.grossPay).toBe(2300);
    expect(slip.earnings.find((e) => e.code === "HOURS")!.amount).toBe(2000);
    expect(slip.earnings.find((e) => e.code === "OT")!.amount).toBe(300);
  });

  it("applies pre-tax deductions to taxable pay but not to gross", () => {
    const slip = computePayslip({
      baseSalary: 3000,
      preTaxDeductions: [{ code: "PEN", label: "Pension", amount: 200 }],
      statutory,
    });
    expect(slip.grossPay).toBe(3000);
    expect(slip.taxablePay).toBe(2800); // 3000 − 200
    // income tax = (2800 − 1000) × 20% = 360
    expect(slip.employeeDeductions.find((d) => d.code === "TAX")!.amount).toBe(360);
    // net = 3000 − 200(pension) − 360(tax) − 220(NI) = 2220
    expect(slip.netPay).toBe(2220);
  });

  it("subtracts post-tax deductions from net", () => {
    const slip = computePayslip({
      baseSalary: 3000,
      postTaxDeductions: [{ code: "LOAN", label: "Loan repayment", amount: 100 }],
      statutory,
    });
    expect(slip.netPay).toBe(3000 - 400 - 220 - 100); // 2280
  });

  it("computes employer cost = gross + employer NI", () => {
    const slip = computePayslip({ baseSalary: 3000, statutory });
    const erni = slip.employerCosts.find((c) => c.code === "ERNI")!;
    expect(erni.amount).toBe(round2((3000 - 800) * 0.138)); // 303.6
    expect(slip.totalEmployerCost).toBe(round2(3000 + erni.amount));
  });

  it("never pays negative net when deductions exceed gross", () => {
    const slip = computePayslip({
      baseSalary: 500,
      postTaxDeductions: [{ code: "LOAN", label: "Big loan", amount: 1000 }],
      statutory,
    });
    expect(slip.netPay).toBe(0);
  });

  it("zero earnings yield an all-zero slip", () => {
    const slip = computePayslip({ statutory });
    expect(slip.grossPay).toBe(0);
    expect(slip.netPay).toBe(0);
    expect(slip.totalEmployerCost).toBe(0);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
