import { describe, expect, it } from "vitest";
import {
  bracketTax,
  cappedWages,
  computeUsStatutory,
  usStatutory,
  ZERO_YTD,
  type UsPayrollTaxRuleSet,
} from "./statutory-us";
import { computePayslip } from "./payroll";

// FIXTURE RATES — deliberately round, obviously synthetic numbers.
//
// These are NOT the real IRS/state figures and must never be read as such. The
// engine takes rates as effective-dated data precisely so the real ones are
// seeded from a cited source rather than printed into code, and these fixtures
// exist to prove the MECHANISM (caps, thresholds, annualization, employer
// asymmetry) independent of any year's published numbers.
const RULES: UsPayrollTaxRuleSet = {
  taxYear: 2026,
  periodsPerYear: 12,
  federal: {
    standardDeductionPerPeriod: 1000,
    brackets: [
      { upTo: 20_000, rate: 0.1 },
      { upTo: 60_000, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ],
  },
  fica: {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 100_000,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: 200_000,
  },
  unemployment: {
    futaRate: 0.006,
    futaWageBase: 7_000,
    sutaRate: 0.03,
    sutaWageBase: 10_000,
  },
  state: {
    stateCode: "CA",
    standardDeductionPerPeriod: 500,
    brackets: [
      { upTo: 40_000, rate: 0.02 },
      { upTo: null, rate: 0.05 },
    ],
  },
};

const NO_INCOME_TAX_STATE: UsPayrollTaxRuleSet = { ...RULES, state: undefined };

describe("cappedWages", () => {
  it("stops charging once the annual base is reached", () => {
    expect(cappedWages(10_000, 95_000, 100_000)).toBe(5_000);
    expect(cappedWages(10_000, 100_000, 100_000)).toBe(0);
  });

  it("never returns a negative, which would refund correctly withheld tax", () => {
    expect(cappedWages(10_000, 120_000, 100_000)).toBe(0);
  });

  it("charges the full period when far below the base", () => {
    expect(cappedWages(8_000, 0, 100_000)).toBe(8_000);
  });
});

describe("bracketTax", () => {
  it("taxes each band at its own rate, not the top rate on everything", () => {
    // 20,000 @ 10% = 2,000; next 10,000 @ 20% = 2,000 -> 4,000
    expect(bracketTax(30_000, RULES.federal.brackets)).toBe(4_000);
  });

  it("applies the open top band above the last ceiling", () => {
    // 2,000 + 8,000 + (40,000 @ 30% = 12,000) = 22,000
    expect(bracketTax(100_000, RULES.federal.brackets)).toBe(22_000);
  });

  it("taxes nothing at zero", () => {
    expect(bracketTax(0, RULES.federal.brackets)).toBe(0);
  });
});

describe("computeUsStatutory", () => {
  it("annualizes so the first paycheck is not taxed as a whole year", () => {
    const r = computeUsStatutory({ taxablePay: 5_000, ficaWages: 5_000 }, RULES);
    // (5,000 - 1,000) x 12 = 48,000 annual -> 2,000 + 5,600 = 7,600 -> /12
    expect(r.federalWithholding).toBeCloseTo(633.33, 2);
  });

  it("charges Social Security only up to the wage base", () => {
    const under = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, socialSecurityWagesYtd: 95_000 } },
      RULES,
    );
    // Only 5,000 of the 10,000 is still below the 100,000 base.
    expect(under.socialSecurityEmployee).toBe(310);

    const over = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, socialSecurityWagesYtd: 100_000 } },
      RULES,
    );
    expect(over.socialSecurityEmployee).toBe(0);
  });

  it("charges Medicare with no ceiling at all", () => {
    const r = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, medicareWagesYtd: 500_000 } },
      RULES,
    );
    expect(r.medicareEmployee).toBe(145);
  });

  it("adds additional Medicare only above the threshold", () => {
    const below = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, medicareWagesYtd: 150_000 } },
      RULES,
    );
    expect(below.additionalMedicareEmployee).toBe(0);

    const straddling = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, medicareWagesYtd: 195_000 } },
      RULES,
    );
    // Only the 5,000 above 200,000 attracts the extra 0.9%.
    expect(straddling.additionalMedicareEmployee).toBe(45);
  });

  it("does not make the employer match additional Medicare", () => {
    const r = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, medicareWagesYtd: 195_000 } },
      RULES,
    );
    // Employer matches SS and Medicare, but never the additional 0.9%.
    expect(r.medicareEmployer).toBe(r.medicareEmployee);
    expect(r.socialSecurityEmployer).toBe(r.socialSecurityEmployee);
    expect(r.totalEmployer).toBe(
      r.socialSecurityEmployer + r.medicareEmployer + r.futaEmployer + r.sutaEmployer,
    );
  });

  it("charges FUTA and SUTA to the employer only, each on its own base", () => {
    const r = computeUsStatutory({ taxablePay: 5_000, ficaWages: 5_000 }, RULES);
    expect(r.futaEmployer).toBe(30);
    expect(r.sutaEmployer).toBe(150);
    // Neither appears in the employee total.
    expect(r.totalEmployee).toBe(
      r.federalWithholding +
        r.stateWithholding +
        r.socialSecurityEmployee +
        r.medicareEmployee +
        r.additionalMedicareEmployee,
    );
  });

  it("stops FUTA once its low wage base is exhausted", () => {
    const r = computeUsStatutory(
      { taxablePay: 5_000, ficaWages: 5_000, ytd: { ...ZERO_YTD, futaWagesYtd: 7_000 } },
      RULES,
    );
    expect(r.futaEmployer).toBe(0);
  });

  it("withholds no state tax in a state with no income tax", () => {
    const r = computeUsStatutory({ taxablePay: 5_000, ficaWages: 5_000 }, NO_INCOME_TAX_STATE);
    expect(r.stateWithholding).toBe(0);
    // Federal and FICA are unaffected by the state having no income tax.
    expect(r.federalWithholding).toBeGreaterThan(0);
    expect(r.socialSecurityEmployee).toBeGreaterThan(0);
  });

  it("charges FICA on gross even when pre-tax deductions lower income-tax pay", () => {
    // A 401(k)-style deferral reduces taxablePay but not the FICA base.
    const r = computeUsStatutory({ taxablePay: 4_000, ficaWages: 5_000 }, RULES);
    expect(r.socialSecurityEmployee).toBe(310);
    expect(r.medicareEmployee).toBe(72.5);
  });
});

describe("usStatutory adapter", () => {
  it("drives the gross-to-net engine end to end", () => {
    const slip = computePayslip({
      baseSalary: 5_000,
      statutory: usStatutory(RULES),
    });

    const direct = computeUsStatutory({ taxablePay: 5_000, ficaWages: 5_000 }, RULES);
    expect(slip.grossPay).toBe(5_000);
    // Net is gross less every employee-side statutory amount.
    expect(slip.netPay).toBeCloseTo(5_000 - direct.totalEmployee, 2);
    // Employer cost sits on top of gross, never inside it.
    expect(slip.totalEmployerCost).toBeCloseTo(5_000 + direct.totalEmployer, 2);
  });

  it("keeps a prior period reproducible when a later rule set changes", () => {
    const oldRules = RULES;
    const newRules: UsPayrollTaxRuleSet = {
      ...RULES,
      taxYear: 2027,
      fica: { ...RULES.fica, socialSecurityWageBase: 120_000 },
    };
    const before = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, socialSecurityWagesYtd: 100_000 } },
      oldRules,
    );
    const after = computeUsStatutory(
      { taxablePay: 10_000, ficaWages: 10_000, ytd: { ...ZERO_YTD, socialSecurityWagesYtd: 100_000 } },
      newRules,
    );
    // The 2026 period must not re-compute under the 2027 base — which is the
    // whole reason rules are effective-dated data rather than constants.
    expect(before.socialSecurityEmployee).toBe(0);
    expect(after.socialSecurityEmployee).toBe(620);
  });
});
