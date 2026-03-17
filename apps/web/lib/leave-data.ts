// apps/web/lib/leave-data.ts
// Cached query functions for leave management.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LeavePolicyRow = {
  id: string;
  policyId: string;
  leaveType: string;
  name: string;
  annualAllocation: number;
  accrualRule: string;
  carryoverLimit: number | null;
  requiresApproval: boolean;
  probationDays: number;
  isDefault: boolean;
  status: string;
};

export type LeaveBalanceRow = {
  id: string;
  leaveType: string;
  year: number;
  allocated: number;
  used: number;
  carriedOver: number;
  adjustments: number;
  remaining: number;
};

export type LeaveRequestRow = {
  id: string;
  requestId: string;
  employeeName: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  approverName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getLeavePolicies = cache(async (): Promise<LeavePolicyRow[]> => {
  const rows = await prisma.leavePolicy.findMany({
    where: { status: "active" },
    orderBy: { leaveType: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    policyId: r.policyId,
    leaveType: r.leaveType,
    name: r.name,
    annualAllocation: r.annualAllocation,
    accrualRule: r.accrualRule,
    carryoverLimit: r.carryoverLimit,
    requiresApproval: r.requiresApproval,
    probationDays: r.probationDays,
    isDefault: r.isDefault,
    status: r.status,
  }));
});

export const getLeaveBalances = cache(async (employeeProfileId: string, year?: number): Promise<LeaveBalanceRow[]> => {
  const targetYear = year ?? new Date().getFullYear();
  const rows = await prisma.leaveBalance.findMany({
    where: { employeeProfileId, year: targetYear },
    orderBy: { leaveType: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    leaveType: r.leaveType,
    year: r.year,
    allocated: r.allocated,
    used: r.used,
    carriedOver: r.carriedOver,
    adjustments: r.adjustments,
    remaining: r.allocated + r.carriedOver + r.adjustments - r.used,
  }));
});

export const getLeaveRequests = cache(async (filters?: {
  employeeProfileId?: string;
  status?: string;
  managerId?: string;
}): Promise<LeaveRequestRow[]> => {
  const where: Record<string, unknown> = {};
  if (filters?.employeeProfileId) where["employeeProfileId"] = filters.employeeProfileId;
  if (filters?.status) where["status"] = filters.status;

  const rows = await prisma.leaveRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      employeeProfile: { select: { displayName: true, employeeId: true, managerEmployeeId: true } },
      approver: { select: { displayName: true } },
    },
  });

  // If filtering by managerId, filter in application layer
  const filtered = filters?.managerId
    ? rows.filter((r) => r.employeeProfile.managerEmployeeId === filters.managerId)
    : rows;

  return filtered.map((r) => ({
    id: r.id,
    requestId: r.requestId,
    employeeName: r.employeeProfile.displayName,
    employeeId: r.employeeProfile.employeeId,
    leaveType: r.leaveType,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    reason: r.reason,
    status: r.status,
    approverName: r.approver?.displayName ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
  }));
});

export const getTeamLeaveCalendar = cache(async (
  departmentId?: string,
  startDate?: Date,
  endDate?: Date,
): Promise<LeaveRequestRow[]> => {
  const now = new Date();
  const start = startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const where: Record<string, unknown> = {
    status: "approved",
    startDate: { lte: end },
    endDate: { gte: start },
  };

  const rows = await prisma.leaveRequest.findMany({
    where,
    orderBy: { startDate: "asc" },
    include: {
      employeeProfile: {
        select: {
          displayName: true,
          employeeId: true,
          departmentId: true,
          managerEmployeeId: true,
        },
      },
      approver: { select: { displayName: true } },
    },
  });

  const filtered = departmentId
    ? rows.filter((r) => r.employeeProfile.departmentId === departmentId)
    : rows;

  return filtered.map((r) => ({
    id: r.id,
    requestId: r.requestId,
    employeeName: r.employeeProfile.displayName,
    employeeId: r.employeeProfile.employeeId,
    leaveType: r.leaveType,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    reason: r.reason,
    status: r.status,
    approverName: r.approver?.displayName ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
  }));
});
