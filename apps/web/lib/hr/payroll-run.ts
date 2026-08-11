// Payroll run orchestration — persist computed payslips as a durable, disbursable
// PayRun. This is the "paying" hop made DURABLE: computeEmployeePayslip produces the
// gross-to-net numbers (from comp the hire carried through); runPayroll persists one
// Payslip per employee under a PayRun, idempotent per (payRunId, employee), and skips
// anyone not yet payable (no comp) so the gap is visible rather than silent.
//
// Money movement boundary: actual net-pay disbursement (bank file / ACH / provider
// send) is performed by a payment provider OUTSIDE this module — a governed follow-up.
// markPayslipDisbursed only RECORDS the outcome so the run has an auditable paid/failed
// state. This module never moves money.

import { computeEmployeePayslip } from "./labor-service";
import type { StatutoryDeductionFn } from "./payroll";

/** Structural write client — satisfied by the real PrismaClient and by test fakes. */
export type RunPayrollClient = {
  payRun: { create: (args: unknown) => Promise<{ id: string }> };
  payslip: { upsert: (args: unknown) => Promise<{ id: string }> };
};

export interface RunPayrollInput {
  payRunRef: string;
  periodStart: Date;
  periodEnd: Date;
  payDate?: Date | null;
  employeeProfileIds: string[];
  statutory: StatutoryDeductionFn;
  opts?: { periodsPerYear?: number; overtimeMultiplier?: number };
}

export interface RunPayrollResult {
  payRunId: string;
  paid: Array<{ employeeProfileId: string; payslipId: string; grossPay: number; netPay: number }>;
  skipped: Array<{ employeeProfileId: string; reason: "no-employee" | "no-compensation" }>;
}

/**
 * Run payroll for a set of employees over a pay period: compute each one's payslip
 * (comp + approved time → gross-to-net) and persist it under a durable PayRun. Idempotent
 * per (payRunId, employeeProfileId) via upsert, so a re-run refreshes rather than
 * duplicates. Employees without compensation are skipped with a reason — a hire is only
 * payable once the offer carried comp through (lib/recruiting/offer-compensation.ts).
 */
export async function runPayroll(
  db: RunPayrollClient,
  input: RunPayrollInput,
): Promise<RunPayrollResult> {
  const payRun = await db.payRun.create({
    data: {
      payRunRef: input.payRunRef,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate ?? null,
      status: "draft",
    },
  });

  const paid: RunPayrollResult["paid"] = [];
  const skipped: RunPayrollResult["skipped"] = [];

  for (const employeeProfileId of input.employeeProfileIds) {
    const result = await computeEmployeePayslip(
      employeeProfileId,
      input.periodStart,
      input.periodEnd,
      input.statutory,
      input.opts,
    );
    if (!result.ok) {
      skipped.push({ employeeProfileId, reason: result.reason });
      continue;
    }

    const p = result.payslip;
    const columns = {
      grossPay: p.grossPay,
      taxablePay: p.taxablePay,
      netPay: p.netPay,
      totalEmployerCost: p.totalEmployerCost,
      earnings: p.earnings,
      employeeDeductions: p.employeeDeductions,
      employerCosts: p.employerCosts,
    };
    const persisted = await db.payslip.upsert({
      where: { payRunId_employeeProfileId: { payRunId: payRun.id, employeeProfileId } },
      create: { payRunId: payRun.id, employeeProfileId, ...columns },
      update: columns,
    });
    paid.push({
      employeeProfileId,
      payslipId: persisted.id,
      grossPay: p.grossPay,
      netPay: p.netPay,
    });
  }

  return { payRunId: payRun.id, paid, skipped };
}

export type DisbursePayslipClient = {
  payslip: { update: (args: unknown) => Promise<unknown> };
};

/**
 * Record the outcome of disbursing a payslip's net pay to the employee. The actual
 * money movement is performed by a payment provider outside this function; this only
 * writes the auditable paid/failed state (+ paidAt on success). Never moves money.
 */
export async function markPayslipDisbursed(
  db: DisbursePayslipClient,
  payslipId: string,
  outcome: "paid" | "failed",
  at: Date,
): Promise<void> {
  await db.payslip.update({
    where: { id: payslipId },
    data: {
      disbursementStatus: outcome,
      ...(outcome === "paid" ? { paidAt: at } : {}),
    },
  });
}
