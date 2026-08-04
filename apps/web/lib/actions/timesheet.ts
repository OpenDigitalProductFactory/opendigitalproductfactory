// apps/web/lib/actions/timesheet.ts
"use server";

import { ROUTES } from "@/lib/routes";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";
import { authorizeApprovalDecision } from "@/lib/workforce/approval-authority";

// ─── Save timesheet entries ──────────────────────────────────────────────────

export async function saveTimesheetEntries(input: {
  weekStarting: string;
  entries: Array<{
    dayOfWeek: number;
    date: string;
    hours: number;
    breakMinutes: number;
    notes?: string;
    // Billable time (EP-LABOR-ECONOMICS). Only persisted when the org's
    // financial profile enables billable time (the UI hides them otherwise);
    // harmless defaults when omitted.
    billable?: boolean;
    customerAccountId?: string | null;
    billableRateId?: string | null;
    billableHours?: number;
  }>;
  notes?: string;
}): Promise<{ success: boolean; periodId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };

  const weekStart = new Date(input.weekStarting);

  // Find or create the period
  let period = await prisma.timesheetPeriod.findUnique({
    where: {
      employeeProfileId_weekStarting: {
        employeeProfileId: profile.id,
        weekStarting: weekStart,
      },
    },
  });

  if (period && period.status !== "draft" && period.status !== "rejected") {
    return { success: false, error: `Cannot edit a ${period.status} timesheet` };
  }

  const totalHours = input.entries.reduce((sum, e) => sum + e.hours, 0);
  const totalBreakMinutes = input.entries.reduce((sum, e) => sum + e.breakMinutes, 0);
  const overtimeThreshold = period?.overtimeThreshold ?? 40;
  const overtimeHours = Math.max(0, totalHours - overtimeThreshold);

  if (!period) {
    const periodId = `TS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    period = await prisma.timesheetPeriod.create({
      data: {
        periodId,
        employeeProfileId: profile.id,
        weekStarting: weekStart,
        totalHours,
        totalBreakMinutes,
        overtimeHours,
        notes: input.notes ?? null,
      },
    });
  } else {
    await prisma.timesheetPeriod.update({
      where: { id: period.id },
      data: {
        totalHours,
        totalBreakMinutes,
        overtimeHours,
        notes: input.notes ?? null,
        // If rejected, reset to draft on edit
        ...(period.status === "rejected" ? { status: "draft", rejectionReason: null } : {}),
      },
    });
  }

  // Billing lock: an entry whose hours are already on an invoice keeps its
  // billing fields frozen (belt-and-braces — an invoiced entry's period is
  // approved and not editable anyway, but never trust one guard alone).
  const invoicedDays = new Set(
    (
      await prisma.timesheetEntry.findMany({
        where: { timesheetPeriodId: period.id, invoiceId: { not: null } },
        select: { dayOfWeek: true },
      })
    ).map((e) => e.dayOfWeek),
  );

  // Upsert each day's entry
  for (const entry of input.entries) {
    const billable = entry.billable ?? false;
    // Billable hours default to the day's worked hours and can never exceed them.
    const billableHours = billable
      ? Math.min(Math.max(entry.billableHours ?? entry.hours, 0), entry.hours)
      : 0;
    const billingFields = invoicedDays.has(entry.dayOfWeek)
      ? {}
      : {
          billable,
          billableHours,
          customerAccountId: billable ? (entry.customerAccountId ?? null) : null,
          billableRateId: billable ? (entry.billableRateId ?? null) : null,
        };

    await prisma.timesheetEntry.upsert({
      where: {
        timesheetPeriodId_dayOfWeek: {
          timesheetPeriodId: period.id,
          dayOfWeek: entry.dayOfWeek,
        },
      },
      create: {
        timesheetPeriodId: period.id,
        dayOfWeek: entry.dayOfWeek,
        date: new Date(entry.date),
        hours: entry.hours,
        breakMinutes: entry.breakMinutes,
        notes: entry.notes ?? null,
        ...billingFields,
      },
      update: {
        hours: entry.hours,
        breakMinutes: entry.breakMinutes,
        notes: entry.notes ?? null,
        ...billingFields,
      },
    });
  }

  revalidatePath(ROUTES.employee);
  return { success: true, periodId: period.periodId };
}

// ─── Submit timesheet for approval ───────────────────────────────────────────

export async function submitTimesheet(
  periodId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const period = await prisma.timesheetPeriod.findUnique({ where: { periodId } });
  if (!period) return { success: false, error: "Timesheet not found" };
  if (period.status !== "draft" && period.status !== "rejected") {
    return { success: false, error: `Cannot submit a ${period.status} timesheet` };
  }
  if (period.totalHours === 0) {
    return { success: false, error: "Cannot submit a timesheet with 0 hours" };
  }

  await prisma.timesheetPeriod.update({
    where: { periodId },
    data: { status: "submitted", submittedAt: new Date() },
  });

  revalidatePath(ROUTES.employee);
  return { success: true };
}

// ─── Manager: Approve timesheet ──────────────────────────────────────────────

export async function approveTimesheet(
  periodId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const period = await prisma.timesheetPeriod.findUnique({ where: { periodId } });
  if (!period) return { success: false, error: "Timesheet not found" };
  if (period.status !== "submitted") return { success: false, error: "Timesheet not in submitted status" };

  // Authority comes from the org chart, not from merely being signed in (BI-HCM-004).
  const authorized = await authorizeApprovalDecision(
    session.user.id,
    period.employeeProfileId,
    "this timesheet",
  );
  if (!authorized.ok) return { success: false, error: authorized.error };
  const approverProfile = { id: authorized.approverEmployeeId };

  await prisma.timesheetPeriod.update({
    where: { periodId },
    data: {
      status: "approved",
      approvedById: approverProfile.id,
      approvedAt: new Date(),
    },
  });

  revalidatePath(ROUTES.employee);
  return { success: true };
}

// ─── Manager: Reject timesheet ───────────────────────────────────────────────

export async function rejectTimesheet(
  periodId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const period = await prisma.timesheetPeriod.findUnique({ where: { periodId } });
  if (!period) return { success: false, error: "Timesheet not found" };
  if (period.status !== "submitted") return { success: false, error: "Timesheet not in submitted status" };

  const authorized = await authorizeApprovalDecision(
    session.user.id,
    period.employeeProfileId,
    "this timesheet",
  );
  if (!authorized.ok) return { success: false, error: authorized.error };
  const approverProfile = { id: authorized.approverEmployeeId };

  await prisma.timesheetPeriod.update({
    where: { periodId },
    data: {
      status: "rejected",
      approvedById: approverProfile.id,
      rejectionReason: reason,
    },
  });

  revalidatePath(ROUTES.employee);
  return { success: true };
}
