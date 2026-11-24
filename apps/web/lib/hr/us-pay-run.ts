// lib/hr/us-pay-run.ts — decide whether a US payroll can run, and build each
// employee's statutory calculation (BI-099EAE30).
//
// Pure. The loader (us-pay-run.server.ts) reads confirmed figures, W-4 events
// and year-to-date wages and hands them in; this module decides.
//
// A run is refused, with every reason named, while any of these is true:
//   - a federal figure is not confirmed (buildFederalPayrollRules)
//   - a paid employee has no W-4 on file, so the state they work in is unknown
//   - a work state's figures are missing, or its method is not supported
//   - nobody on the staff list has a pay rate
// An employee with no pay rate is listed as not on this payroll rather than
// blocking it: an owner is often not paid through payroll.

import type { RecordedW4 } from "./federal-withholding";
import type { StatutoryDeductionFn } from "./payroll";
import { usStatutory, type UsPayrollTaxRuleSet, type YearToDate } from "./statutory-us";
import { buildFederalPayrollRules, type FederalPayrollRules, type QualifiedRule } from "./us-payroll-rules";
import { buildStatePayrollRules, type StatePayrollRules } from "./us-state-payroll-rules";

export const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;
export type PayFrequency = keyof typeof PERIODS_PER_YEAR;

export interface PayRunEmployee {
  employeeProfileId: string;
  displayName: string;
  hasPay: boolean;
  w4: RecordedW4 | null;
}

export interface PayableEmployee extends PayRunEmployee {
  w4: RecordedW4;
}

export interface UsPayRunAssessment {
  payDate: Date;
  blockers: string[];
  payable: PayableEmployee[];
  notOnPayroll: Array<{ employeeProfileId: string; displayName: string; reason: string }>;
  federal: FederalPayrollRules | null;
  states: Record<string, StatePayrollRules>;
}

export function assessUsPayRun(input: {
  payDate: Date;
  federalRows: readonly QualifiedRule[];
  stateRowsByCode: Readonly<Record<string, readonly QualifiedRule[]>>;
  employees: readonly PayRunEmployee[];
}): UsPayRunAssessment {
  const blockers: string[] = [];

  const federal = buildFederalPayrollRules(input.federalRows, input.payDate);
  if (!federal.ready) blockers.push(...federal.missing);

  const paid = input.employees.filter((e) => e.hasPay);
  const notOnPayroll = input.employees
    .filter((e) => !e.hasPay)
    .map((e) => ({ employeeProfileId: e.employeeProfileId, displayName: e.displayName, reason: "no pay rate" }));

  if (paid.length === 0) {
    blockers.push("Nobody on the staff list has a pay rate. Set pay on the employee record first.");
  }

  const payable: PayableEmployee[] = [];
  for (const e of paid) {
    if (!e.w4) {
      blockers.push(`${e.displayName} has no W-4 on file. Record it, including the state where they work.`);
      continue;
    }
    payable.push({ ...e, w4: e.w4 });
  }

  const states: Record<string, StatePayrollRules> = {};
  for (const code of [...new Set(payable.map((e) => e.w4.workStateCode))].sort()) {
    const built = buildStatePayrollRules(input.stateRowsByCode[code] ?? [], input.payDate, code);
    if (built.ready) states[code] = built.rules;
    else if (built.unsupported) blockers.push(built.unsupported);
    else blockers.push(...built.missing);
  }

  return {
    payDate: input.payDate,
    blockers,
    payable: blockers.length === 0 ? payable : [],
    notOnPayroll,
    federal: federal.ready ? federal.rules : null,
    states,
  };
}

/** The statutory calculation for one employee, from a ready assessment. */
export function usStatutoryFor(
  assessment: UsPayRunAssessment,
  employee: PayableEmployee,
  periodsPerYear: number,
  ytd: YearToDate,
): StatutoryDeductionFn {
  const federal = assessment.federal;
  const state = assessment.states[employee.w4.workStateCode];
  if (!federal || !state || assessment.blockers.length > 0) {
    throw new Error("usStatutoryFor called on an assessment that is not ready");
  }
  const rules: UsPayrollTaxRuleSet = {
    taxYear: assessment.payDate.getUTCFullYear(),
    periodsPerYear,
    federal: federal.federal,
    fica: federal.fica,
    unemployment: {
      futaRate: federal.futa.futaRate,
      futaWageBase: federal.futa.futaWageBase,
      sutaRate: state.sutaRate,
      sutaWageBase: state.sutaWageBase,
    },
    ...(state.state ? { state: state.state } : {}),
  };
  return usStatutory(rules, ytd, employee.w4);
}
