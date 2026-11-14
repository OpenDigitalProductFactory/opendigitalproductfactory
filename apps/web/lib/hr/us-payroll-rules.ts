// lib/hr/us-payroll-rules.ts — assemble the federal figures a pay date needs
// from person-confirmed PayrollTaxRule rows (BI-2BC8D614).
//
// The engine (statutory-us.ts, federal-withholding.ts) is figure-free; this is
// the only place that turns stored figures into the shapes it consumes. It
// refuses to assemble a partial set: a payroll computed with a missing figure
// would silently withhold nothing for that tax, which reads as "nothing owed".
// Instead it returns the plain-language name of every figure that is absent.
//
// Row conventions (the federal jurisdiction):
//   social_security / medicare        rate, employee_withheld and employer_contribution
//   social_security                   wage_base, side null
//   additional_medicare               rate employee_withheld; threshold side null
//   futa                              rate employer_contribution; wage_base side null
//   federal_withholding / amount      qualifiers {line: "1g", filingStatus: married_jointly | other}
//   federal_withholding / rate        employee_withheld, qualifiers {filingStatus, schedule: standard | step2, over}
//                                     one row per row of the IRS Annual Percentage Method table

import {
  resolveStatutoryRule,
  statutoryQualifierKey,
  type ResolvableStatutoryRule,
} from "@/lib/finance/statutory-rules";
import type { FederalWithholdingTables, FilingStatus, WithholdingBracket } from "./federal-withholding";
import type { UsFicaRules } from "./statutory-us";

export interface QualifiedRule extends ResolvableStatutoryRule {
  qualifiers: Record<string, unknown>;
}

export interface FederalPayrollRules {
  federal: FederalWithholdingTables;
  fica: UsFicaRules;
  futa: { futaRate: number; futaWageBase: number };
}

type Scalar = { taxType: string; ruleKind: "rate" | "wage_base" | "threshold" | "amount"; side: string | null; qualifiers?: Record<string, string> };

const FILING_STATUSES: readonly FilingStatus[] = ["single", "married_jointly", "head_of_household"];
const SCHEDULES = ["standard", "step2"] as const;

const STATUS_LABEL: Record<FilingStatus, string> = {
  single: "single",
  married_jointly: "married filing jointly",
  head_of_household: "head of household",
};
const SCHEDULE_LABEL: Record<(typeof SCHEDULES)[number], string> = { standard: "standard", step2: "Step 2 checkbox" };

const SCALARS: ReadonlyArray<readonly [string, Scalar]> = [
  ["Social Security rate, employee share", { taxType: "social_security", ruleKind: "rate", side: "employee_withheld" }],
  ["Social Security rate, employer share", { taxType: "social_security", ruleKind: "rate", side: "employer_contribution" }],
  ["Social Security wage base", { taxType: "social_security", ruleKind: "wage_base", side: null }],
  ["Medicare rate, employee share", { taxType: "medicare", ruleKind: "rate", side: "employee_withheld" }],
  ["Medicare rate, employer share", { taxType: "medicare", ruleKind: "rate", side: "employer_contribution" }],
  ["Additional Medicare rate", { taxType: "additional_medicare", ruleKind: "rate", side: "employee_withheld" }],
  ["Additional Medicare withholding threshold", { taxType: "additional_medicare", ruleKind: "threshold", side: null }],
  ["FUTA rate", { taxType: "futa", ruleKind: "rate", side: "employer_contribution" }],
  ["FUTA wage base", { taxType: "futa", ruleKind: "wage_base", side: null }],
  ["Federal withholding line 1g amount: married filing jointly", { taxType: "federal_withholding", ruleKind: "amount", side: null, qualifiers: { line: "1g", filingStatus: "married_jointly" } }],
  ["Federal withholding line 1g amount: other filers", { taxType: "federal_withholding", ruleKind: "amount", side: null, qualifiers: { line: "1g", filingStatus: "other" } }],
];

const TABLE_LABELS = FILING_STATUSES.flatMap((status) =>
  SCHEDULES.map((schedule) => ({ status, schedule, label: `Federal withholding table: ${STATUS_LABEL[status]}, ${SCHEDULE_LABEL[schedule]}` })));

/** Every federal figure a payroll needs, by the name a person sees. */
export const FEDERAL_RULE_CONVENTIONS: readonly string[] = [
  ...SCALARS.map(([label]) => label),
  ...TABLE_LABELS.map((t) => t.label),
];

function covers(rule: QualifiedRule, on: Date): boolean {
  if (rule.status !== "ratified") return false;
  if (rule.effectiveFrom.getTime() > on.getTime()) return false;
  return rule.effectiveTo === null || rule.effectiveTo.getTime() > on.getTime();
}

/**
 * The bracket table for one filing status and schedule in force on `on`.
 * All rows of a table share a start date; the latest start date covering the
 * pay date wins, and a table without a row starting at zero is incomplete.
 */
function tableFor(rows: readonly QualifiedRule[], on: Date, status: FilingStatus, schedule: string): WithholdingBracket[] | null {
  const candidates = rows.filter((r) =>
    r.taxType === "federal_withholding" && r.ruleKind === "rate" && covers(r, on)
    && r.qualifiers.filingStatus === status && r.qualifiers.schedule === schedule
    && typeof r.qualifiers.over === "number");
  if (candidates.length === 0) return null;
  const start = Math.max(...candidates.map((r) => r.effectiveFrom.getTime()));
  const table = candidates
    .filter((r) => r.effectiveFrom.getTime() === start)
    .map((r) => ({ over: r.qualifiers.over as number, rate: r.value }))
    .sort((a, b) => a.over - b.over);
  return table[0]?.over === 0 ? table : null;
}

export function buildFederalPayrollRules(
  rows: readonly QualifiedRule[],
  on: Date,
): { ok: true; data: FederalPayrollRules } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const scalar = new Map<string, number>();
  for (const [label, sel] of SCALARS) {
    const found = resolveStatutoryRule(rows, on, {
      taxType: sel.taxType, ruleKind: sel.ruleKind, side: sel.side,
      qualifierKey: statutoryQualifierKey(sel.qualifiers ?? {}),
    });
    if (found) scalar.set(label, found.value);
    else missing.push(label);
  }

  const schedules = {} as FederalWithholdingTables["schedules"];
  for (const { status, schedule, label } of TABLE_LABELS) {
    const table = tableFor(rows, on, status, schedule);
    if (!table) {
      missing.push(label);
      continue;
    }
    schedules[status] = { ...(schedules[status] ?? { standard: [], step2: [] }), [schedule]: table };
  }

  if (missing.length > 0) return { ok: false, missing };

  const get = (label: string) => scalar.get(label)!;
  return {
    ok: true,
    data: {
      federal: {
        line1g: {
          married_jointly: get("Federal withholding line 1g amount: married filing jointly"),
          other: get("Federal withholding line 1g amount: other filers"),
        },
        schedules,
      },
      fica: {
        socialSecurityRate: get("Social Security rate, employee share"),
        socialSecurityWageBase: get("Social Security wage base"),
        medicareRate: get("Medicare rate, employee share"),
        additionalMedicareRate: get("Additional Medicare rate"),
        additionalMedicareThreshold: get("Additional Medicare withholding threshold"),
      },
      futa: { futaRate: get("FUTA rate"), futaWageBase: get("FUTA wage base") },
    },
  };
}
