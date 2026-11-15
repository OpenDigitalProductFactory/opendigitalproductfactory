import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assessUsPayRun, PERIODS_PER_YEAR, usStatutoryFor } from "./us-pay-run";
import type { QualifiedRule } from "./us-payroll-rules";
import type { RecordedW4 } from "./federal-withholding";
import { statutoryQualifierKey } from "@/lib/finance/statutory-rules";
import { computePayslip } from "./payroll";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const PAY_DATE = new Date("2026-03-31T00:00:00.000Z");
let n = 0;
function rule(taxType: string, ruleKind: QualifiedRule["ruleKind"], side: string | null, value: number, qualifiers: Record<string, string | number> = {}): QualifiedRule {
  n += 1;
  return {
    id: `r${n}`, taxType, ruleKind, side, taxYear: 2026, value, status: "ratified",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
    qualifiers, qualifierKey: statutoryQualifierKey(qualifiers),
  };
}

function federal(): QualifiedRule[] {
  const rows = [
    rule("social_security", "rate", "employee_withheld", 0.062),
    rule("social_security", "rate", "employer_contribution", 0.062),
    rule("social_security", "wage_base", null, 184_500),
    rule("medicare", "rate", "employee_withheld", 0.0145),
    rule("medicare", "rate", "employer_contribution", 0.0145),
    rule("additional_medicare", "rate", "employee_withheld", 0.009),
    rule("additional_medicare", "threshold", null, 200_000),
    rule("futa", "rate", "employer_contribution", 0.006),
    rule("futa", "wage_base", null, 7_000),
    rule("federal_withholding", "amount", null, 12_900, { line: "1g", filingStatus: "married_jointly" }),
    rule("federal_withholding", "amount", null, 8_600, { line: "1g", filingStatus: "other" }),
  ];
  for (const filingStatus of ["single", "married_jointly", "head_of_household"]) {
    for (const [over, rate] of [[0, 0], [7_500, 0.1], [19_900, 0.12]] as const) {
      rows.push(rule("federal_withholding", "rate", "employee_withheld", rate, { filingStatus, schedule: "standard", over }));
    }
    rows.push(rule("federal_withholding", "rate", "employee_withheld", 0, { filingStatus, schedule: "step2", over: 0 }));
  }
  return rows;
}

const texas = [
  rule("state_withholding", "rate", "employee_withheld", 0, { over: 0 }),
  rule("suta", "rate", "employer_contribution", 0.027),
  rule("suta", "wage_base", null, 9_000),
];

const w4 = (over: Partial<RecordedW4> = {}): RecordedW4 => ({
  filingStatus: "single", step2Checked: false, step3Credits: 0, step4aOtherIncome: 0,
  step4bDeductions: 0, step4cExtraWithholding: 0, exempt: false, workStateCode: "TX", ...over,
});

describe("assessUsPayRun", () => {
  it("is ready when every figure is confirmed and each paid employee has a W-4", () => {
    const result = assessUsPayRun({
      payDate: PAY_DATE, federalRows: federal(), stateRowsByCode: { TX: texas },
      employees: [
        { employeeProfileId: "e1", displayName: "Ana", hasPay: true, w4: w4() },
        { employeeProfileId: "e2", displayName: "Owner", hasPay: false, w4: null },
      ],
    });
    expect(result.blockers).toEqual([]);
    expect(result.payable.map((e) => e.employeeProfileId)).toEqual(["e1"]);
    expect(result.notOnPayroll).toEqual([{ employeeProfileId: "e2", displayName: "Owner", reason: "no pay rate" }]);
  });

  it("names every blocker: missing figures, a missing W-4, a missing state", () => {
    const result = assessUsPayRun({
      payDate: PAY_DATE, federalRows: [], stateRowsByCode: {},
      employees: [
        { employeeProfileId: "e1", displayName: "Ana", hasPay: true, w4: null },
        { employeeProfileId: "e3", displayName: "Bo", hasPay: true, w4: w4({ workStateCode: "TX" }) },
      ],
    });
    expect(result.blockers).toContain("Social Security rate, employee share");
    expect(result.blockers).toContain("Ana has no W-4 on file. Record it, including the state where they work.");
    expect(result.blockers).toContain("TX state unemployment (SUTA) wage base");
    expect(result.payable).toEqual([]);
  });

  it("blocks when nobody can be paid", () => {
    const result = assessUsPayRun({ payDate: PAY_DATE, federalRows: federal(), stateRowsByCode: {}, employees: [] });
    expect(result.blockers).toEqual(["Nobody on the staff list has a pay rate. Set pay on the employee record first."]);
  });
});

describe("usStatutoryFor", () => {
  it("withholds from the employee's own W-4 and charges Texas SUTA, with no state income tax line", () => {
    const assessment = assessUsPayRun({
      payDate: PAY_DATE, federalRows: federal(), stateRowsByCode: { TX: texas },
      employees: [{ employeeProfileId: "e1", displayName: "Ana", hasPay: true, w4: w4() }],
    });
    const statutory = usStatutoryFor(assessment, assessment.payable[0]!, PERIODS_PER_YEAR.biweekly, {
      grossYtd: 0, socialSecurityWagesYtd: 0, medicareWagesYtd: 0, futaWagesYtd: 0, sutaWagesYtd: 0,
    });
    const slip = computePayslip({ baseSalary: 2_000, statutory });
    // Worksheet 1A, single biweekly 2,000 with the fixture table: 1i 43,400;
    // 1,240 + 12% x 23,500 = 4,060; / 26 = 156.15.
    expect(slip.employeeDeductions.find((l) => l.code === "US_FWT")?.amount).toBe(156.15);
    expect(slip.employeeDeductions.find((l) => l.code === "US_SS_EE")?.amount).toBe(124);
    expect(slip.employeeDeductions.find((l) => l.code === "US_MED_EE")?.amount).toBe(29);
    expect(slip.employeeDeductions.some((l) => l.code === "US_SWT")).toBe(false);
    expect(slip.employerCosts.find((l) => l.code === "US_SUTA")?.amount).toBe(54);
    expect(slip.employerCosts.find((l) => l.code === "US_FUTA")?.amount).toBe(12);
  });

  it("stops SUTA at the state wage base using year-to-date wages", () => {
    const assessment = assessUsPayRun({
      payDate: PAY_DATE, federalRows: federal(), stateRowsByCode: { TX: texas },
      employees: [{ employeeProfileId: "e1", displayName: "Ana", hasPay: true, w4: w4() }],
    });
    const statutory = usStatutoryFor(assessment, assessment.payable[0]!, PERIODS_PER_YEAR.biweekly, {
      grossYtd: 8_500, socialSecurityWagesYtd: 8_500, medicareWagesYtd: 8_500, futaWagesYtd: 8_500, sutaWagesYtd: 8_500,
    });
    const slip = computePayslip({ baseSalary: 2_000, statutory });
    // Only 500 of 2,000 remains under the 9,000 base: 500 x 2.7% = 13.50. FUTA base is exhausted.
    expect(slip.employerCosts.find((l) => l.code === "US_SUTA")?.amount).toBe(13.5);
    expect(slip.employerCosts.find((l) => l.code === "US_FUTA")?.amount).toBe(0);
  });
});
