import { describe, expect, it } from "vitest";
import {
  determineDepositCadence,
  emitPayrollTaxSnapshots,
  summarisePeriod,
  type EmittablePayRun,
} from "./payroll-tax-emission";

function run(over: Partial<EmittablePayRun> = {}): EmittablePayRun {
  return {
    payRunId: "PR-0001",
    payDate: new Date("2026-08-31T00:00:00.000Z"),
    amounts: [
      { taxType: "federal_withholding", side: "employee_withheld", taxableAmount: 5000, taxAmount: 633.33 },
      { taxType: "social_security", side: "employee_withheld", taxableAmount: 5000, taxAmount: 310 },
      { taxType: "social_security", side: "employer_contribution", taxableAmount: 5000, taxAmount: 310 },
      { taxType: "medicare", side: "employee_withheld", taxableAmount: 5000, taxAmount: 72.5 },
      { taxType: "medicare", side: "employer_contribution", taxableAmount: 5000, taxAmount: 72.5 },
      { taxType: "futa", side: "employer_contribution", taxableAmount: 5000, taxAmount: 30 },
    ],
    ...over,
  };
}

describe("emitPayrollTaxSnapshots", () => {
  it("emits one snapshot per tax type and side, tagged as a payroll run", () => {
    const snapshots = emitPayrollTaxSnapshots(run());
    expect(snapshots).toHaveLength(6);
    // sourceType is what lets these ride the existing sales-tax machinery.
    expect(snapshots.every((s) => s.sourceType === "payroll_run")).toBe(true);
    expect(snapshots.every((s) => s.sourceId === "PR-0001")).toBe(true);
  });

  it("dates the liability by pay date, not period end", () => {
    const snapshots = emitPayrollTaxSnapshots(run());
    // A deposit obligation is triggered by paying, not by the work being done.
    expect(snapshots[0]?.occurredAt.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("aggregates repeated amounts of the same type and side", () => {
    const snapshots = emitPayrollTaxSnapshots(
      run({
        amounts: [
          { taxType: "medicare", side: "employee_withheld", taxableAmount: 5000, taxAmount: 72.5 },
          { taxType: "medicare", side: "employee_withheld", taxableAmount: 3000, taxAmount: 43.5 },
        ],
      }),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.taxAmount).toBe(116);
    expect(snapshots[0]?.taxableAmount).toBe(8000);
  });

  it("keeps the two sides of the same tax separate", () => {
    const snapshots = emitPayrollTaxSnapshots(run());
    const ss = snapshots.filter((s) => s.taxType === "social_security");
    // Employee-withheld is someone else's money the business holds; merging it
    // with the employer's own contribution hides that.
    expect(ss).toHaveLength(2);
    expect(ss.map((s) => s.side).sort()).toEqual(["employee_withheld", "employer_contribution"]);
  });

  it("drops zero amounts rather than opening an empty period to file", () => {
    const snapshots = emitPayrollTaxSnapshots(
      run({
        amounts: [
          { taxType: "state_withholding", side: "employee_withheld", taxableAmount: 5000, taxAmount: 0 },
          { taxType: "medicare", side: "employee_withheld", taxableAmount: 5000, taxAmount: 72.5 },
        ],
      }),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.taxType).toBe("medicare");
  });

  it("emits nothing for a run with no tax at all", () => {
    expect(emitPayrollTaxSnapshots(run({ amounts: [] }))).toHaveLength(0);
  });
});

describe("determineDepositCadence", () => {
  it("puts a large lookback liability on the semiweekly schedule", () => {
    expect(determineDepositCadence(60_000, 50_000)).toBe("semiweekly");
  });

  it("keeps a small lookback liability monthly", () => {
    expect(determineDepositCadence(10_000, 50_000)).toBe("monthly");
  });

  it("treats exactly-at-threshold as monthly, not semiweekly", () => {
    // The rule is "more than", so the boundary must not escalate cadence.
    expect(determineDepositCadence(50_000, 50_000)).toBe("monthly");
  });
});

describe("summarisePeriod", () => {
  it("reports withheld and employer money separately as well as together", () => {
    const totals = summarisePeriod(emitPayrollTaxSnapshots(run()));
    expect(totals.employeeWithheld).toBe(1015.83);
    expect(totals.employerContribution).toBe(412.5);
    expect(totals.total).toBe(1428.33);
  });

  it("totals an empty period at zero rather than failing", () => {
    expect(summarisePeriod([])).toEqual({
      employeeWithheld: 0,
      employerContribution: 0,
      total: 0,
    });
  });
});
