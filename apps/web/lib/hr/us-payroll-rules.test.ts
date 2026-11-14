import { describe, expect, it } from "vitest";

import { buildFederalPayrollRules, FEDERAL_RULE_CONVENTIONS, type QualifiedRule } from "./us-payroll-rules";
import { statutoryQualifierKey } from "@/lib/finance/statutory-rules";

const ON = new Date("2026-03-15T00:00:00.000Z");
let seq = 0;

function rule(
  taxType: string,
  ruleKind: QualifiedRule["ruleKind"],
  side: string | null,
  value: number,
  qualifiers: Record<string, string | number> = {},
  over: Partial<QualifiedRule> = {},
): QualifiedRule {
  seq += 1;
  return {
    id: `r${seq}`, taxType, ruleKind, side, taxYear: 2026, value, status: "ratified",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
    qualifiers, qualifierKey: statutoryQualifierKey(qualifiers), ...over,
  };
}

function bracketRows(filingStatus: string, schedule: string, table: Array<[number, number]>): QualifiedRule[] {
  return table.map(([over, rate]) => rule("federal_withholding", "rate", "employee_withheld", rate, { filingStatus, schedule, over }));
}

function completeFederal(): QualifiedRule[] {
  const rows: QualifiedRule[] = [
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
  for (const status of ["single", "married_jointly", "head_of_household"]) {
    rows.push(...bracketRows(status, "standard", [[0, 0], [7_500, 0.1], [19_900, 0.12]]));
    rows.push(...bracketRows(status, "step2", [[0, 0], [3_750, 0.1]]));
  }
  return rows;
}

describe("buildFederalPayrollRules", () => {
  it("assembles every federal figure from ratified rows", () => {
    const result = buildFederalPayrollRules(completeFederal(), ON);
    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.rules.fica).toEqual({
      socialSecurityRate: 0.062, socialSecurityWageBase: 184_500, medicareRate: 0.0145,
      additionalMedicareRate: 0.009, additionalMedicareThreshold: 200_000,
    });
    expect(result.rules.futa).toEqual({ futaRate: 0.006, futaWageBase: 7_000 });
    expect(result.rules.federal.line1g).toEqual({ married_jointly: 12_900, other: 8_600 });
    expect(result.rules.federal.schedules.single.standard).toEqual([
      { over: 0, rate: 0 }, { over: 7_500, rate: 0.1 }, { over: 19_900, rate: 0.12 },
    ]);
  });

  it("names every missing figure rather than computing with a gap", () => {
    const result = buildFederalPayrollRules([], ON);
    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.missing).toContain("Social Security rate, employee share");
    expect(result.missing).toContain("FUTA wage base");
    expect(result.missing).toContain("Federal withholding table: single, standard");
    expect(result.missing).toContain("Federal withholding line 1g amount: married filing jointly");
    expect(result.missing).toHaveLength(FEDERAL_RULE_CONVENTIONS.length);
  });

  it("ignores a proposed figure — only a person-confirmed one counts", () => {
    const rows = completeFederal().map((r) =>
      r.taxType === "futa" && r.ruleKind === "rate" ? { ...r, status: "proposed" as const } : r);
    const result = buildFederalPayrollRules(rows, ON);
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.missing).toEqual(["FUTA rate"]);
  });

  it("treats a table with no row starting at zero as incomplete", () => {
    const rows = completeFederal().filter((r) =>
      !(r.qualifiers.filingStatus === "head_of_household" && r.qualifiers.schedule === "step2" && r.qualifiers.over === 0));
    const result = buildFederalPayrollRules(rows, ON);
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.missing).toEqual(["Federal withholding table: head of household, Step 2 checkbox"]);
  });

  it("uses the table in force on the pay date, not a later one", () => {
    const later = bracketRows("single", "standard", [[0, 0], [8_000, 0.1]]).map((r) => ({
      ...r, effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
    }));
    const result = buildFederalPayrollRules([...completeFederal(), ...later], ON);
    expect(result.ready && result.rules.federal.schedules.single.standard[1]).toEqual({ over: 7_500, rate: 0.1 });
  });
});
