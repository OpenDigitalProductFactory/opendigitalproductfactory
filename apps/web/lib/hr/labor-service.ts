// lib/hr/labor-service.ts — persistence + wiring for labor economics (EP-LABOR-ECONOMICS Phase 3).
//
// Connects the (already-shipped) pieces end to end:
//   • approved timesheets + EmployeeProfile compensation → payroll earnings
//     (lib/hr/labor-billing.ts payrollEarningsFromTimesheet → lib/hr/payroll.ts);
//   • approved billable hours + the BillableRate rate card → a draft customer
//     invoice (lib/actions/finance.ts createInvoice → GL auto-post on send).
//
// The billable flow is ARCHETYPE-GATED: it only runs when the org's applied
// financial profile carries billableTimeEnabled (labour archetypes) — the same
// per-business-model flag pattern as purchaseOrdersEnabled. All pure rules live
// in labor.ts / labor-billing.ts; this file only reads/writes Prisma around them.

import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import { createInvoice } from "@/lib/actions/finance";
import type { Compensation } from "./labor";
import {
  payrollEarningsFromTimesheet,
  buildBillableInvoiceLines,
  type PayrollEarnings,
  type ApprovedTimesheetTotals,
} from "./labor-billing";
import {
  computePayslip,
  type Payslip,
  type StatutoryDeductionFn,
  type PayComponent,
} from "./payroll";

// ─── Compensation resolution ─────────────────────────────────────────────────

type EmployeeCompRow = {
  payType: string | null;
  hourlyRate: unknown;
  annualSalary: unknown;
  standardAnnualHours: number | null;
};

/** Map EmployeeProfile compensation columns to the pure Compensation type; null when unset/incomplete. */
export function compensationFromEmployee(row: EmployeeCompRow): Compensation | null {
  if (row.payType === "hourly" && row.hourlyRate != null) {
    return { payType: "hourly", hourlyRate: Number(row.hourlyRate) };
  }
  if (row.payType === "salary" && row.annualSalary != null) {
    return {
      payType: "salary",
      annualSalary: Number(row.annualSalary),
      standardAnnualHours: row.standardAnnualHours ?? undefined,
    };
  }
  return null;
}

// ─── Timesheet → payroll earnings ────────────────────────────────────────────

export type EmployeePayrollEarningsResult =
  | { ok: true; earnings: PayrollEarnings; approved: ApprovedTimesheetTotals; periodsCounted: number }
  | { ok: false; reason: "no-employee" | "no-compensation" };

/**
 * The earnings side of an employee's payslip for a pay period, from APPROVED
 * timesheets only: salaried staff get their fixed period pay; hourly staff get
 * approved regular + overtime hours at their rates. Feed the result into
 * computePayslip (lib/hr/payroll.ts) together with the statutory function.
 */
export async function getEmployeePayrollEarnings(
  employeeProfileId: string,
  periodStart: Date,
  periodEnd: Date,
  opts?: { periodsPerYear?: number; overtimeMultiplier?: number },
): Promise<EmployeePayrollEarningsResult> {
  const employee = await prisma.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: { payType: true, hourlyRate: true, annualSalary: true, standardAnnualHours: true },
  });
  if (!employee) return { ok: false, reason: "no-employee" };

  const comp = compensationFromEmployee(employee);
  if (!comp) return { ok: false, reason: "no-compensation" };

  const periods = await prisma.timesheetPeriod.findMany({
    where: {
      employeeProfileId,
      status: "approved",
      weekStarting: { gte: periodStart, lt: periodEnd },
    },
    select: { totalHours: true, overtimeHours: true },
  });

  const approved: ApprovedTimesheetTotals = {
    totalHours: periods.reduce((t, p) => t + p.totalHours, 0),
    overtimeHours: periods.reduce((t, p) => t + p.overtimeHours, 0),
  };

  return {
    ok: true,
    earnings: payrollEarningsFromTimesheet(comp, approved, opts),
    approved,
    periodsCounted: periods.length,
  };
}

// ─── Employee payslip: comp (from hire) + approved time → gross-to-net ────────

export type EmployeePayslipResult =
  | { ok: true; payslip: Payslip; periodsCounted: number }
  | { ok: false; reason: "no-employee" | "no-compensation" };

/**
 * Run one employee's payslip for a pay period, end to end: read their
 * EmployeeProfile compensation (populated at hire — lib/recruiting/offer-compensation.ts)
 * plus approved timesheets via getEmployeePayrollEarnings, then compute gross→net via
 * computePayslip with the supplied jurisdiction statutory function. This is the caller
 * that makes a hired employee actually payable — the hiring→paying hop of the seam.
 * Pure compute over the spine; PayRun/Payslip persistence + disbursement are the
 * governed follow-ups (EP-PAYROLL-COMP-BENEFITS). `no-compensation` means the hire
 * never received comp — the seam is only closed when the offer carries it through.
 */
export async function computeEmployeePayslip(
  employeeProfileId: string,
  periodStart: Date,
  periodEnd: Date,
  statutory: StatutoryDeductionFn,
  opts?: {
    periodsPerYear?: number;
    overtimeMultiplier?: number;
    additions?: PayComponent[];
    preTaxDeductions?: PayComponent[];
    postTaxDeductions?: PayComponent[];
  },
): Promise<EmployeePayslipResult> {
  const earningsResult = await getEmployeePayrollEarnings(
    employeeProfileId,
    periodStart,
    periodEnd,
    opts,
  );
  if (!earningsResult.ok) return earningsResult;

  const payslip = computePayslip({
    ...earningsResult.earnings,
    ...(opts?.additions ? { additions: opts.additions } : {}),
    ...(opts?.preTaxDeductions ? { preTaxDeductions: opts.preTaxDeductions } : {}),
    ...(opts?.postTaxDeductions ? { postTaxDeductions: opts.postTaxDeductions } : {}),
    statutory,
  });

  return { ok: true, payslip, periodsCounted: earningsResult.periodsCounted };
}

// ─── Billable time → draft invoice ───────────────────────────────────────────

export type BillableInvoiceResult =
  | {
      generated: true;
      invoiceId: string;
      invoiceRef: string;
      hoursBilled: number;
      entriesBilled: number;
      skipped: Array<{ entryId: string; reason: string }>;
    }
  | {
      generated: false;
      reason: "billable-time-disabled" | "nothing-to-bill";
      skipped: Array<{ entryId: string; reason: string }>;
    };

/**
 * Turn a customer's APPROVED, un-invoiced billable hours into a draft invoice.
 *
 * Gated by the org's financial profile: only labour archetypes carry
 * billableTimeEnabled, so a retail/food/nonprofit install can never reach the
 * billing path. Only entries whose timesheet period is approved qualify (unapproved
 * time is neither payable nor billable). Entries priced into the invoice are
 * stamped invoiceId/invoicedAt (guarded on invoiceId IS NULL) so hours can never be
 * billed twice; entries with no resolvable rate are reported, never billed at zero.
 */
export async function generateInvoiceFromBillableTime(
  customerAccountId: string,
  opts?: { dueInDays?: number },
): Promise<BillableInvoiceResult> {
  const settings = await prisma.orgSettings.findFirst({
    select: { appliedProfileSlug: true, baseCurrency: true },
  });
  const profile = settings?.appliedProfileSlug ? getFinancialProfile(settings.appliedProfileSlug) : null;
  if (!profile?.billableTimeEnabled) {
    return { generated: false, reason: "billable-time-disabled", skipped: [] };
  }

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      customerAccountId,
      billable: true,
      billableHours: { gt: 0 },
      invoiceId: null,
      timesheetPeriod: { status: "approved" },
    },
    select: { id: true, date: true, billableHours: true, billableRateId: true },
    orderBy: { date: "asc" },
  });

  const org = await prisma.organization.findFirst({ select: { id: true } });
  const rateCard = org
    ? await prisma.billableRate.findMany({
        where: { organizationId: org.id, isActive: true },
        select: { id: true, name: true, unit: true, billRate: true },
      })
    : [];

  const priced = buildBillableInvoiceLines(
    entries.map((e) => ({
      id: e.id,
      date: e.date,
      billableHours: e.billableHours,
      billableRateId: e.billableRateId,
    })),
    rateCard.map((r) => ({ id: r.id, name: r.name, unit: r.unit, billRate: Number(r.billRate) })),
  );

  if (priced.lines.length === 0) {
    return { generated: false, reason: "nothing-to-bill", skipped: priced.skipped };
  }

  const dueInDays = opts?.dueInDays && opts.dueInDays > 0 ? opts.dueInDays : 14;
  const dueDate = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000);

  const invoice = await createInvoice({
    accountId: customerAccountId,
    type: "standard",
    dueDate: dueDate.toISOString(),
    currency: settings?.baseCurrency ?? "GBP",
    sourceType: "billable-time",
    notes: `Billable time through ${new Date().toISOString().slice(0, 10)} (${priced.totalHours} hours).`,
    lineItems: priced.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: 0,
      discountPercent: 0,
    })),
  });

  // Stamp immediately after creation, guarded on invoiceId IS NULL, so the same
  // hours can never be priced into a second invoice even under a concurrent run.
  await prisma.timesheetEntry.updateMany({
    where: { id: { in: priced.billedEntryIds }, invoiceId: null },
    data: { invoiceId: invoice.id, invoicedAt: new Date() },
  });

  return {
    generated: true,
    invoiceId: invoice.id,
    invoiceRef: invoice.invoiceRef,
    hoursBilled: priced.totalHours,
    entriesBilled: priced.billedEntryIds.length,
    skipped: priced.skipped,
  };
}
