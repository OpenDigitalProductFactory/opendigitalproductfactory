import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildStatePayrollRules } from "./us-state-payroll-rules";
import type { QualifiedRule } from "./us-payroll-rules";
import { statutoryQualifierKey } from "@/lib/finance/statutory-rules";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const ON = new Date("2026-03-15T00:00:00.000Z");
let n = 0;
function rule(taxType: string, ruleKind: QualifiedRule["ruleKind"], side: string | null, value: number, qualifiers: Record<string, number> = {}): QualifiedRule {
  n += 1;
  return {
    id: `s${n}`, taxType, ruleKind, side, taxYear: 2026, value, status: "ratified",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
    qualifiers, qualifierKey: statutoryQualifierKey(qualifiers),
  };
}

const suta = [
  rule("suta", "rate", "employer_contribution", 0.027),
  rule("suta", "wage_base", null, 9_000),
];

describe("buildStatePayrollRules", () => {
  it("a state with a confirmed rate of 0 withholds no state tax and still charges SUTA", () => {
    const result = buildStatePayrollRules([rule("state_withholding", "rate", "employee_withheld", 0, { over: 0 }), ...suta], ON, "TX");
    expect(result).toEqual({ ready: true, rules: { sutaRate: 0.027, sutaWageBase: 9_000 } });
  });

  it("a flat-rate state withholds that rate on all wages", () => {
    const result = buildStatePayrollRules([rule("state_withholding", "rate", "employee_withheld", 0.0307, { over: 0 }), ...suta], ON, "PA");
    expect(result.ready && result.rules.state).toEqual({ stateCode: "PA", standardDeductionPerPeriod: 0, brackets: [{ upTo: null, rate: 0.0307 }] });
  });

  it("refuses a multi-rate state instead of approximating it", () => {
    const result = buildStatePayrollRules([
      rule("state_withholding", "rate", "employee_withheld", 0.01, { over: 0 }),
      rule("state_withholding", "rate", "employee_withheld", 0.02, { over: 10_000 }),
      ...suta,
    ], ON, "CA");
    expect(result.ready).toBe(false);
    expect(!result.ready && result.unsupported).toMatch(/more than one rate/);
  });

  it("names what is missing, including that 0 is an answer", () => {
    const result = buildStatePayrollRules([], ON, "TX");
    expect(result).toEqual({
      ready: false,
      missing: [
        "TX state income tax rate (enter 0 if the state does not tax wages)",
        "TX state unemployment (SUTA) rate assigned to your business",
        "TX state unemployment (SUTA) wage base",
      ],
    });
  });
});
