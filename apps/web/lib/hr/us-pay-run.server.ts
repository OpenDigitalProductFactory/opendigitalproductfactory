// lib/hr/us-pay-run.server.ts — load what a US pay run needs and run it
// (BI-099EAE30). The decisions live in us-pay-run.ts; this module only reads
// and writes.

import { prisma } from "@dpf/db";
import { WITHHOLDING_EVENT_TYPE, w4InForce, type RecordedW4 } from "./federal-withholding";
import { compensationFromEmployee } from "./labor-service";
import { runPayroll, type RunPayrollClient, type RunPayrollResult } from "./payroll-run";
import { ZERO_YTD, type YearToDate } from "./statutory-us";
import {
  assessUsPayRun,
  PERIODS_PER_YEAR,
  usStatutoryFor,
  type PayFrequency,
  type PayRunEmployee,
  type UsPayRunAssessment,
} from "./us-pay-run";
import type { QualifiedRule } from "./us-payroll-rules";

export const US_FEDERAL_JURISDICTION = "TAX-JUR-US-FEDERAL";

type RuleRow = {
  id: string;
  taxType: string;
  ruleKind: string;
  side: string | null;
  taxYear: number;
  value: { toString(): string };
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  qualifiers: unknown;
  qualifierKey: string;
  sourceUrl: string | null;
};

function toQualified(row: RuleRow): QualifiedRule {
  return {
    id: row.id,
    taxType: row.taxType,
    ruleKind: row.ruleKind as QualifiedRule["ruleKind"],
    side: row.side,
    taxYear: row.taxYear,
    value: Number(row.value.toString()),
    status: row.status as QualifiedRule["status"],
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    sourceUrl: row.sourceUrl,
    qualifierKey: row.qualifierKey,
    qualifiers: row.qualifiers && typeof row.qualifiers === "object" ? (row.qualifiers as Record<string, unknown>) : {},
  };
}

const RULE_SELECT = {
  id: true, taxType: true, ruleKind: true, side: true, taxYear: true, value: true, status: true,
  effectiveFrom: true, effectiveTo: true, qualifiers: true, qualifierKey: true, sourceUrl: true,
} as const;

export interface LoadedPayRunInputs {
  assessment: UsPayRunAssessment;
  /** Every active employee, with the W-4 in force on the pay date (or null). */
  employees: Array<PayRunEmployee & { w4: RecordedW4 | null }>;
}

/** Read the figures, staff, W-4s and work states for a pay date, and assess. */
export async function loadUsPayRun(payDate: Date): Promise<LoadedPayRunInputs> {
  const staff = await prisma.employeeProfile.findMany({
    where: { status: "active" },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, payType: true, hourlyRate: true, annualSalary: true, standardAnnualHours: true },
  });
  const events = await prisma.employmentEvent.findMany({
    where: { employeeProfileId: { in: staff.map((s) => s.id) }, eventType: WITHHOLDING_EVENT_TYPE },
    select: { employeeProfileId: true, eventType: true, effectiveAt: true, metadata: true, createdAt: true },
  });
  const employees = staff.map((s) => ({
    employeeProfileId: s.id,
    displayName: s.displayName,
    hasPay: compensationFromEmployee(s) !== null,
    w4: w4InForce(events.filter((e) => e.employeeProfileId === s.id), payDate),
  }));

  const federalRows = await prisma.payrollTaxRule.findMany({
    where: { lifecycle: "active", status: "ratified", jurisdictionReference: { jurisdictionRefId: US_FEDERAL_JURISDICTION } },
    select: RULE_SELECT,
  });
  const stateCodes = [...new Set(employees.flatMap((e) => (e.w4 ? [e.w4.workStateCode] : [])))];
  const stateRows = stateCodes.length === 0 ? [] : await prisma.payrollTaxRule.findMany({
    where: {
      lifecycle: "active",
      status: "ratified",
      jurisdictionReference: { countryCode: "US", stateProvinceCode: { in: stateCodes } },
    },
    select: { ...RULE_SELECT, jurisdictionReference: { select: { stateProvinceCode: true } } },
  });
  const stateRowsByCode: Record<string, QualifiedRule[]> = {};
  for (const row of stateRows) {
    const code = row.jurisdictionReference.stateProvinceCode;
    if (!code) continue;
    (stateRowsByCode[code] ??= []).push(toQualified(row as unknown as RuleRow));
  }

  const assessment = assessUsPayRun({
    payDate,
    federalRows: federalRows.map((r) => toQualified(r as unknown as RuleRow)),
    stateRowsByCode,
    employees,
  });
  return { assessment, employees };
}

/** Year-to-date wages from earlier runs paid in the same calendar year. */
async function yearToDate(employeeProfileIds: string[], payDate: Date): Promise<Map<string, YearToDate>> {
  const yearStart = new Date(Date.UTC(payDate.getUTCFullYear(), 0, 1));
  const slips = await prisma.payslip.findMany({
    where: {
      employeeProfileId: { in: employeeProfileIds },
      payRun: { payDate: { gte: yearStart, lt: payDate }, status: { in: ["approved", "paid"] } },
    },
    select: { employeeProfileId: true, grossPay: true },
  });
  const out = new Map<string, YearToDate>();
  for (const id of employeeProfileIds) out.set(id, { ...ZERO_YTD });
  for (const slip of slips) {
    const gross = Number(slip.grossPay);
    const ytd = out.get(slip.employeeProfileId)!;
    // This engine charges FICA, FUTA and SUTA on gross pay, so one running
    // total feeds every capped base.
    ytd.grossYtd += gross;
    ytd.socialSecurityWagesYtd += gross;
    ytd.medicareWagesYtd += gross;
    ytd.futaWagesYtd += gross;
    ytd.sutaWagesYtd += gross;
  }
  return out;
}

export type ComputeUsPayRunResult =
  | { computed: true; payRunId: string; result: RunPayrollResult }
  | { computed: false; blockers: string[] };

/** Compute (or recompute, while still a draft) the pay run for a period. */
export async function computeUsPayRun(input: {
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  frequency: PayFrequency;
}): Promise<ComputeUsPayRunResult> {
  const { assessment } = await loadUsPayRun(input.payDate);
  if (assessment.blockers.length > 0) return { computed: false, blockers: assessment.blockers };

  const periodsPerYear = PERIODS_PER_YEAR[input.frequency];
  const ids = assessment.payable.map((e) => e.employeeProfileId);
  const ytd = await yearToDate(ids, input.payDate);
  const byId = new Map(assessment.payable.map((e) => [e.employeeProfileId, e]));

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const result = await runPayroll(prisma as unknown as RunPayrollClient, {
    payRunRef: `PR-US-${day(input.periodStart)}-${day(input.periodEnd)}`,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    payDate: input.payDate,
    employeeProfileIds: ids,
    statutoryPerEmployee: true,
    statutory: (id: string) => usStatutoryFor(assessment, byId.get(id)!, periodsPerYear, ytd.get(id)!),
    opts: { periodsPerYear },
  });
  return { computed: true, payRunId: result.payRunId, result };
}
