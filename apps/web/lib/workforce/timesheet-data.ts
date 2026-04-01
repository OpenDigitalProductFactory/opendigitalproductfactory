// apps/web/lib/timesheet-data.ts
// Cached query functions for time tracking.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TimesheetEntryRow = {
  id: string;
  dayOfWeek: number;
  date: string;
  hours: number;
  breakMinutes: number;
  notes: string | null;
};

export type TimesheetPeriodRow = {
  id: string;
  periodId: string;
  employeeProfileId: string;
  employeeName: string;
  employeeId: string;
  weekStarting: string;
  status: string;
  totalHours: number;
  totalBreakMinutes: number;
  overtimeHours: number;
  overtimeThreshold: number;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  entries: TimesheetEntryRow[];
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export { DAY_NAMES };

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getTimesheetForWeek = cache(async (
  employeeProfileId: string,
  weekStarting: Date,
): Promise<TimesheetPeriodRow | null> => {
  const period = await prisma.timesheetPeriod.findUnique({
    where: {
      employeeProfileId_weekStarting: { employeeProfileId, weekStarting },
    },
    include: {
      employeeProfile: { select: { displayName: true, employeeId: true } },
      approvedBy: { select: { displayName: true } },
      entries: { orderBy: { dayOfWeek: "asc" } },
    },
  });

  if (!period) return null;

  return {
    id: period.id,
    periodId: period.periodId,
    employeeProfileId: period.employeeProfileId,
    employeeName: period.employeeProfile.displayName,
    employeeId: period.employeeProfile.employeeId,
    weekStarting: period.weekStarting.toISOString(),
    status: period.status,
    totalHours: period.totalHours,
    totalBreakMinutes: period.totalBreakMinutes,
    overtimeHours: period.overtimeHours,
    overtimeThreshold: period.overtimeThreshold,
    submittedAt: period.submittedAt?.toISOString() ?? null,
    approvedByName: period.approvedBy?.displayName ?? null,
    approvedAt: period.approvedAt?.toISOString() ?? null,
    rejectionReason: period.rejectionReason,
    notes: period.notes,
    entries: period.entries.map((e) => ({
      id: e.id,
      dayOfWeek: e.dayOfWeek,
      date: e.date.toISOString(),
      hours: e.hours,
      breakMinutes: e.breakMinutes,
      notes: e.notes,
    })),
  };
});

export const getPendingTimesheetsForManager = cache(async (
  managerEmployeeId: string,
): Promise<TimesheetPeriodRow[]> => {
  // Find direct reports
  const reports = await prisma.employeeProfile.findMany({
    where: { managerEmployeeId },
    select: { id: true },
  });
  const reportIds = reports.map((r) => r.id);
  if (reportIds.length === 0) return [];

  const periods = await prisma.timesheetPeriod.findMany({
    where: {
      employeeProfileId: { in: reportIds },
      status: "submitted",
    },
    orderBy: { weekStarting: "desc" },
    include: {
      employeeProfile: { select: { displayName: true, employeeId: true } },
      approvedBy: { select: { displayName: true } },
      entries: { orderBy: { dayOfWeek: "asc" } },
    },
  });

  return periods.map((p) => ({
    id: p.id,
    periodId: p.periodId,
    employeeProfileId: p.employeeProfileId,
    employeeName: p.employeeProfile.displayName,
    employeeId: p.employeeProfile.employeeId,
    weekStarting: p.weekStarting.toISOString(),
    status: p.status,
    totalHours: p.totalHours,
    totalBreakMinutes: p.totalBreakMinutes,
    overtimeHours: p.overtimeHours,
    overtimeThreshold: p.overtimeThreshold,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    approvedByName: p.approvedBy?.displayName ?? null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    rejectionReason: p.rejectionReason,
    notes: p.notes,
    entries: p.entries.map((e) => ({
      id: e.id,
      dayOfWeek: e.dayOfWeek,
      date: e.date.toISOString(),
      hours: e.hours,
      breakMinutes: e.breakMinutes,
      notes: e.notes,
    })),
  }));
});

/** Get the Monday of the current week */
export function getCurrentWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1, Sunday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
