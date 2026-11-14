"use server";

// Server actions for running US payroll from the portal (BI-099EAE30).
//
// Thin wrappers. The rules live in lib/hr/us-pay-run.ts and the reads and
// writes in lib/hr/us-pay-run.server.ts. Per AGENTS.md §6 this module exports
// functions only.
//
// SECURITY: the acting user comes from the session. Recording a W-4 or
// computing a run both require manage_finance. Nothing here approves a run,
// posts a journal or moves money.

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { parseRecordedW4, WITHHOLDING_EVENT_TYPE } from "@/lib/hr/federal-withholding";
import { computeUsPayRun } from "@/lib/hr/us-pay-run.server";
import { PERIODS_PER_YEAR, type PayFrequency } from "@/lib/hr/us-pay-run";
import { recordAndActuateEmploymentEvent } from "@/lib/workforce/employment-event-actuator-runtime";

const PAYROLL_PATH = "/finance/payroll";

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value ? date : null;
}

/** Record an employee's Form W-4, effective from the first pay date it governs. */
export async function recordW4Action(input: {
  employeeProfileId: string;
  effectiveFrom: string;
  filingStatus: string;
  step2Checked: boolean;
  step3Credits: number;
  step4aOtherIncome: number;
  step4bDeductions: number;
  step4cExtraWithholding: number;
  exempt: boolean;
  workStateCode: string;
}): Promise<ActionResult<{ employeeProfileId: string }>> {
  const { userId } = await requireCapabilityContext("manage_finance");

  const effectiveAt = calendarDate(input.effectiveFrom);
  if (!effectiveAt) return err("Enter the first pay date this W-4 applies to.");
  const form = parseRecordedW4({ ...input, workStateCode: input.workStateCode.trim().toUpperCase() });
  if (!form) {
    return err("Complete the W-4: filing status, the two-letter work state, and amounts of zero or more.");
  }
  const employee = await prisma.employeeProfile.findUnique({
    where: { id: input.employeeProfileId },
    select: { id: true },
  });
  if (!employee) return err("That employee record no longer exists.");

  await prisma.$transaction(async (tx) => {
    await recordAndActuateEmploymentEvent(tx as never, {
      employeeProfileId: employee.id,
      eventType: WITHHOLDING_EVENT_TYPE,
      effectiveAt,
      reason: "form_w4_recorded",
      actorUserId: userId,
      metadata: { ...form },
    });
  });

  revalidatePath(PAYROLL_PATH);
  return ok({ employeeProfileId: employee.id });
}

/** Compute a draft pay run for a period. Approval and payment are separate steps. */
export async function computePayRunAction(input: {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  frequency: string;
}): Promise<ActionResult<{ payRunId: string; paid: number; skipped: number }>> {
  await requireCapabilityContext("manage_finance");

  const periodStart = calendarDate(input.periodStart);
  const periodEnd = calendarDate(input.periodEnd);
  const payDate = calendarDate(input.payDate);
  if (!periodStart || !periodEnd || !payDate) return err("Enter the period's first and last day and the pay date.");
  if (periodEnd < periodStart) return err("The period must end on or after its first day.");
  if (!(input.frequency in PERIODS_PER_YEAR)) return err("Choose how often you pay.");

  try {
    const outcome = await computeUsPayRun({
      periodStart,
      // Whole days: the last day's approved time counts.
      periodEnd: new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000 - 1),
      payDate,
      frequency: input.frequency as PayFrequency,
    });
    if (!outcome.computed) return err(outcome.blockers.join(" "));
    revalidatePath(PAYROLL_PATH);
    return ok({ payRunId: outcome.payRunId, paid: outcome.result.paid.length, skipped: outcome.result.skipped.length });
  } catch (error) {
    // runPayroll refuses to recompute an approved run or to reuse a period
    // reference for different dates; those are the operator's to see.
    return err(error instanceof Error ? error.message : "The pay run could not be computed.");
  }
}
