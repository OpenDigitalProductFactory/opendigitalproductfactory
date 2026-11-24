// lib/hr/us-state-payroll-rules.ts — a state's payroll figures for a pay date,
// from person-confirmed PayrollTaxRule rows on that state's jurisdiction
// (BI-099EAE30).
//
// Supported deliberately narrowly. A state's income-tax withholding is either
// none (a confirmed rate of 0, as for Texas) or one flat rate on wages. Many
// states withhold with allowances, credits or their own worksheets; computing
// those from a bare bracket table would be quietly wrong, so a state with more
// than one rate row is refused as unsupported rather than approximated.
//
// Row conventions (the state jurisdiction):
//   state_withholding / rate   employee_withheld, qualifiers {over: 0}; value 0 for a no-income-tax state
//   suta / rate                employer_contribution (the employer's own assigned rate)
//   suta / wage_base           side null

import { resolveStatutoryRule } from "@/lib/finance/statutory-rules";
import type { UsStateWithholdingRules } from "./statutory-us";
import type { QualifiedRule } from "./us-payroll-rules";

export interface StatePayrollRules {
  /** Undefined when the state has no income tax on wages. */
  state?: UsStateWithholdingRules;
  sutaRate: number;
  sutaWageBase: number;
}

function covers(rule: QualifiedRule, on: Date): boolean {
  if (rule.status !== "ratified") return false;
  if (rule.effectiveFrom.getTime() > on.getTime()) return false;
  return rule.effectiveTo === null || rule.effectiveTo.getTime() > on.getTime();
}

export function buildStatePayrollRules(
  rows: readonly QualifiedRule[],
  on: Date,
  stateCode: string,
): { ready: true; rules: StatePayrollRules } | { ready: false; missing: string[]; unsupported?: string } {
  const missing: string[] = [];

  const withholding = rows.filter((r) => r.taxType === "state_withholding" && r.ruleKind === "rate" && covers(r, on));
  const start = withholding.length ? Math.max(...withholding.map((r) => r.effectiveFrom.getTime())) : null;
  const current = start === null ? [] : withholding.filter((r) => r.effectiveFrom.getTime() === start);
  if (current.length === 0) {
    missing.push(`${stateCode} state income tax rate (enter 0 if the state does not tax wages)`);
  } else if (current.length > 1 || current[0]!.qualifiers.over !== 0) {
    return {
      ready: false,
      missing: [],
      unsupported: `${stateCode} withholds with more than one rate. DPF computes only states with no wage income tax or one flat rate, so this payroll cannot be run here yet.`,
    };
  }

  const sutaRate = resolveStatutoryRule(rows, on, { taxType: "suta", ruleKind: "rate", side: "employer_contribution" });
  const sutaWageBase = resolveStatutoryRule(rows, on, { taxType: "suta", ruleKind: "wage_base", side: null });
  if (!sutaRate) missing.push(`${stateCode} state unemployment (SUTA) rate assigned to your business`);
  if (!sutaWageBase) missing.push(`${stateCode} state unemployment (SUTA) wage base`);

  if (missing.length > 0) return { ready: false, missing };

  const flat = current[0]!.value;
  return {
    ready: true,
    rules: {
      ...(flat > 0
        ? { state: { stateCode, standardDeductionPerPeriod: 0, brackets: [{ upTo: null, rate: flat }] } }
        : {}),
      sutaRate: sutaRate!.value,
      sutaWageBase: sutaWageBase!.value,
    },
  };
}
