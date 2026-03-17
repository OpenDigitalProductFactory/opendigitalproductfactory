// apps/web/lib/actions/timesheet.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Save timesheet entries ──────────────────────────────────────────────────

export async function saveTimesheetEntries(input: {
  weekStarting: string;
  entries: Array<{
    dayOfWeek: number;
    date: string;
    hours: number;
    breakMinutes: number;
    notes?: string;
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

  // Upsert each day's entry
  for (const entry of input.entries) {
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
      },
      update: {
        hours: entry.hours,
        breakMinutes: entry.breakMinutes,
        notes: entry.notes ?? null,
      },
    });
  }

  revalidatePath("/employee");
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

  revalidatePath("/employee");
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

  const approverProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  await prisma.timesheetPeriod.update({
    where: { periodId },
    data: {
      status: "approved",
      approvedById: approverProfile?.id ?? null,
      approvedAt: new Date(),
    },
  });

  revalidatePath("/employee");
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

  const approverProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  await prisma.timesheetPeriod.update({
    where: { periodId },
    data: {
      status: "rejected",
      approvedById: approverProfile?.id ?? null,
      rejectionReason: reason,
    },
  });

  revalidatePath("/employee");
  return { success: true };
}
