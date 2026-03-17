// apps/web/lib/actions/leave.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Leave Request Flow ──────────────────────────────────────────────────────

export async function submitLeaveRequest(input: {
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
}): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!profile) return { success: false, error: "Employee profile not found" };
  if (profile.status !== "active") return { success: false, error: "Only active employees can request leave" };

  // Check balance
  const year = new Date(input.startDate).getFullYear();
  const balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeProfileId_leaveType_year: {
        employeeProfileId: profile.id,
        leaveType: input.leaveType,
        year,
      },
    },
  });

  if (balance) {
    const remaining = balance.allocated + balance.carriedOver + balance.adjustments - balance.used;
    if (input.days > remaining) {
      return { success: false, error: `Insufficient balance: ${remaining} days remaining` };
    }
  }

  const requestId = `LR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.leaveRequest.create({
    data: {
      requestId,
      employeeProfileId: profile.id,
      leaveType: input.leaveType,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      days: input.days,
      reason: input.reason ?? null,
    },
  });

  revalidatePath("/employee");
  return { success: true, requestId };
}

export async function approveLeaveRequest(
  requestId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const request = await prisma.leaveRequest.findUnique({
    where: { requestId },
    include: { employeeProfile: { select: { managerEmployeeId: true } } },
  });
  if (!request) return { success: false, error: "Request not found" };
  if (request.status !== "pending") return { success: false, error: "Request already decided" };

  // Find approver's employee profile
  const approverProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  // Deduct from balance
  const year = request.startDate.getFullYear();
  await prisma.leaveBalance.upsert({
    where: {
      employeeProfileId_leaveType_year: {
        employeeProfileId: request.employeeProfileId,
        leaveType: request.leaveType,
        year,
      },
    },
    create: {
      employeeProfileId: request.employeeProfileId,
      leaveType: request.leaveType,
      year,
      allocated: 0,
      used: request.days,
    },
    update: {
      used: { increment: request.days },
    },
  });

  await prisma.leaveRequest.update({
    where: { requestId },
    data: {
      status: "approved",
      approverEmployeeId: approverProfile?.id ?? null,
      approvedAt: new Date(),
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

export async function rejectLeaveRequest(
  requestId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const request = await prisma.leaveRequest.findUnique({ where: { requestId } });
  if (!request) return { success: false, error: "Request not found" };
  if (request.status !== "pending") return { success: false, error: "Request already decided" };

  const approverProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  await prisma.leaveRequest.update({
    where: { requestId },
    data: {
      status: "rejected",
      approverEmployeeId: approverProfile?.id ?? null,
      rejectionReason: reason,
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Leave Policy Management ─────────────────────────────────────────────────

export async function createLeavePolicy(input: {
  leaveType: string;
  name: string;
  annualAllocation: number;
  accrualRule?: string;
  carryoverLimit?: number;
  requiresApproval?: boolean;
  probationDays?: number;
  isDefault?: boolean;
}): Promise<{ success: boolean; policyId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const policyId = `LP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.leavePolicy.create({
    data: {
      policyId,
      leaveType: input.leaveType,
      name: input.name,
      annualAllocation: input.annualAllocation,
      accrualRule: input.accrualRule ?? "annual",
      carryoverLimit: input.carryoverLimit ?? null,
      requiresApproval: input.requiresApproval ?? true,
      probationDays: input.probationDays ?? 0,
      isDefault: input.isDefault ?? false,
    },
  });

  revalidatePath("/employee");
  return { success: true, policyId };
}

// ─── Allocate Leave Balances ─────────────────────────────────────────────────

export async function allocateLeaveBalances(
  employeeProfileId: string,
  year?: number,
): Promise<{ success: boolean; allocated: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, allocated: 0, error: "Unauthorized" };

  const targetYear = year ?? new Date().getFullYear();
  const policies = await prisma.leavePolicy.findMany({
    where: { status: "active", isDefault: true },
  });

  let allocated = 0;
  for (const policy of policies) {
    await prisma.leaveBalance.upsert({
      where: {
        employeeProfileId_leaveType_year: {
          employeeProfileId,
          leaveType: policy.leaveType,
          year: targetYear,
        },
      },
      create: {
        employeeProfileId,
        leaveType: policy.leaveType,
        year: targetYear,
        allocated: policy.annualAllocation,
      },
      update: {},
    });
    allocated++;
  }

  revalidatePath("/employee");
  return { success: true, allocated };
}
