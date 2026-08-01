// apps/web/lib/actions/leave.ts
"use server";

import { ROUTES } from "@/lib/routes";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";
import {
  describeUnresolvedRouting,
  resolveAccountableApprover,
} from "@/lib/workforce/approval-routing";
import type { WorkforceStatus } from "@/lib/workforce/workforce-types";

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

  revalidatePath(ROUTES.employee);
  return { success: true, requestId };
}

/**
 * Decide whether the signed-in user may rule on this employee's leave (BI-HCM-004).
 *
 * Before this existed, `approveLeaveRequest` and `rejectLeaveRequest` loaded the requester's
 * `managerEmployeeId` and never compared it to anything: any signed-in user could approve
 * anyone's leave, and `approverEmployeeId` recorded whoever happened to click — or null.
 *
 * Authority now comes from the org chart via the shared approval walk, so leave, timesheets,
 * and anything else route the same way instead of each inventing a single-hop rule.
 */
async function authorizeLeaveDecision(
  userId: string,
  subjectEmployeeProfileId: string,
): Promise<
  | { ok: true; approverEmployeeId: string; onBehalfOf: string | null }
  | { ok: false; error: string }
> {
  const actor = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!actor) {
    return { ok: false, error: "You do not have an employee profile, so you cannot decide leave." };
  }

  const rows = await prisma.employeeProfile.findMany({
    select: { id: true, managerEmployeeId: true, status: true },
  });

  const routing = resolveAccountableApprover(
    rows.map((r) => ({
      id: r.id,
      managerEmployeeId: r.managerEmployeeId,
      status: r.status as WorkforceStatus,
    })),
    subjectEmployeeProfileId,
  );

  if (!routing.resolved) {
    // Fail loudly with the reason and the fix, rather than letting the request sit unexplained.
    const names = new Map(rows.map((r) => [r.id, r.id]));
    const withNames = await prisma.employeeProfile.findMany({
      where: { id: { in: [subjectEmployeeProfileId] } },
      select: { id: true, displayName: true },
    });
    for (const r of withNames) names.set(r.id, r.displayName);
    return {
      ok: false,
      error: describeUnresolvedRouting(
        routing,
        (id) => names.get(id) ?? "This employee",
        subjectEmployeeProfileId,
      ),
    };
  }

  if (routing.approverEmployeeId !== actor.id) {
    return {
      ok: false,
      error: "You are not the accountable approver for this request.",
    };
  }

  return { ok: true, approverEmployeeId: actor.id, onBehalfOf: routing.onBehalfOf };
}

export async function approveLeaveRequest(
  requestId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const request = await prisma.leaveRequest.findUnique({ where: { requestId } });
  if (!request) return { success: false, error: "Request not found" };
  if (request.status !== "pending") return { success: false, error: "Request already decided" };

  // Authority check BEFORE any state change — the balance deduction below is not something to
  // do on behalf of someone who may not decide this.
  const authorized = await authorizeLeaveDecision(session.user.id, request.employeeProfileId);
  if (!authorized.ok) return { success: false, error: authorized.error };
  const approverProfile = { id: authorized.approverEmployeeId };

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
      approverEmployeeId: approverProfile.id,
      approvedAt: new Date(),
    },
  });

  revalidatePath(ROUTES.employee);
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

  const authorized = await authorizeLeaveDecision(session.user.id, request.employeeProfileId);
  if (!authorized.ok) return { success: false, error: authorized.error };
  const approverProfile = { id: authorized.approverEmployeeId };

  await prisma.leaveRequest.update({
    where: { requestId },
    data: {
      status: "rejected",
      approverEmployeeId: approverProfile.id,
      rejectionReason: reason,
    },
  });

  revalidatePath(ROUTES.employee);
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

  revalidatePath(ROUTES.employee);
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

  revalidatePath(ROUTES.employee);
  return { success: true, allocated };
}
