// apps/web/lib/leave-data.ts
// Cached query functions for leave management.

import { cache } from "react";
import { prisma } from "@dpf/db";
import {
  LEAVE_DECISION_ACTION,
  parseLeaveDecisionProposalParameters,
} from "@/lib/workforce/leave/leave-decision-proposal-contract";
import { evaluateCurrentLeaveGuards } from "@/lib/workforce/leave/leave-guard-facts";
import { resolveLeaveDecision } from "@/lib/workforce/leave/leave-decision-policy";
import { mapOrgDecisionToLeaveOutcome } from "@/lib/workforce/leave/leave-decision-surface";

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
  employeeProfileId: string;
  employeeName: string;
  employeeId: string;
  departmentId: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  approverName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  decisionInteractionId: string | null;
  decisionRecommendation: "approve" | "deny" | "escalate" | null;
  decisionRationale: string | null;
  decisionGuardReasons: string[];
  createdAt: string;
};

type LeaveDecisionProjection = Pick<
  LeaveRequestRow,
  "decisionRecommendation" | "decisionRationale" | "decisionGuardReasons"
>;

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
  requestId?: string;
  employeeProfileId?: string;
  status?: string;
  managerId?: string;
  /** Evaluate the hard guards now for pending requests with no interaction (default true). */
  withCurrentGuards?: boolean;
}): Promise<LeaveRequestRow[]> => {
  const where: Record<string, unknown> = {};
  if (filters?.requestId) where["requestId"] = filters.requestId;
  if (filters?.employeeProfileId) where["employeeProfileId"] = filters.employeeProfileId;
  if (filters?.status) where["status"] = filters.status;

  const [rows, proposals] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
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
    }),
    prisma.agentActionProposal.findMany({
      where: { actionType: LEAVE_DECISION_ACTION },
      orderBy: { proposedAt: "desc" },
      take: 100,
      select: { parameters: true },
    }),
  ]);
  const recommendationByRequest = new Map<string, LeaveDecisionProjection>();
  for (const proposal of proposals) {
    const parsed = parseLeaveDecisionProposalParameters(proposal.parameters);
    if (parsed && !recommendationByRequest.has(parsed.requestId)) {
      recommendationByRequest.set(parsed.requestId, {
        decisionRecommendation: parsed.recommendation,
        decisionRationale: parsed.rationale,
        decisionGuardReasons: parsed.guardReasons,
      });
    }
  }

  // If filtering by managerId, filter in application layer
  const filtered = filters?.managerId
    ? rows.filter((r) => r.employeeProfile.managerEmployeeId === filters.managerId)
    : rows;

  // BI-7BCC87BB (spec D2 S5, AC-LEAVE): DecisionInteraction first, then the hard
  // guards evaluated now, then the legacy proposal (recommendationByRequest).
  const fromInteraction = await recommendationsFromInteractions(filtered);
  const fromGuards = filters?.withCurrentGuards === false
    ? new Map<string, string[]>()
    : await evaluateCurrentLeaveGuards(
      filtered
        .filter((r) => r.status === "pending" && !fromInteraction.has(r.requestId))
        .map((r) => ({
          requestId: r.requestId, employeeProfileId: r.employeeProfileId, departmentId: r.employeeProfile.departmentId,
          leaveType: r.leaveType, startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString(), days: r.days,
        })),
    ).catch(() => new Map<string, string[]>());
  const recommendationFor = (requestId: string): LeaveDecisionProjection | undefined => {
    const interaction = fromInteraction.get(requestId);
    if (interaction) return interaction;
    const reasons = fromGuards.get(requestId);
    if (reasons) {
      return { decisionRecommendation: "escalate", decisionRationale: `Needs a human approver: ${reasons.join(" ")}`, decisionGuardReasons: reasons };
    }
    return recommendationByRequest.get(requestId);
  };

  return filtered.map((r) => ({
    id: r.id,
    requestId: r.requestId,
    employeeProfileId: r.employeeProfileId,
    employeeName: r.employeeProfile.displayName,
    employeeId: r.employeeProfile.employeeId,
    departmentId: r.employeeProfile.departmentId,
    leaveType: r.leaveType,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    reason: r.reason,
    status: r.status,
    approverName: r.approver?.displayName ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    decisionInteractionId: r.decisionInteractionId,
    ...(recommendationFor(r.requestId) ?? {
      decisionRecommendation: null,
      decisionRationale: null,
      decisionGuardReasons: [],
    }),
    createdAt: r.createdAt.toISOString(),
  }));
});

/**
 * The recommendation each request's DecisionInteraction carries. An interaction
 * exists only when no hard guard fired, so it maps to approve, deny or escalate
 * exactly as the advisor resolved it (leave-decision-coworker.ts).
 */
async function recommendationsFromInteractions(
  rows: Array<{ requestId: string; decisionInteractionId: string | null }>,
): Promise<Map<string, LeaveDecisionProjection>> {
  const byRequest = new Map<string, LeaveDecisionProjection>();
  const ids = [...new Set(rows.flatMap((r) => (r.decisionInteractionId ? [r.decisionInteractionId] : [])))];
  if (ids.length === 0) return byRequest;
  const interactions = await prisma.decisionInteraction.findMany({
    where: { interactionId: { in: ids } },
    select: { interactionId: true, outcomeType: true, recommendedOptionId: true, rationale: true },
  });
  for (const row of rows) {
    const interaction = interactions.find((i) => i.interactionId === row.decisionInteractionId);
    if (!interaction) continue;
    const outcome = mapOrgDecisionToLeaveOutcome({
      outcomeType: interaction.outcomeType,
      recommendedOptionId: interaction.recommendedOptionId,
      allowed: interaction.outcomeType === "recommend" || interaction.outcomeType === "arbitrate",
    });
    byRequest.set(row.requestId, {
      decisionRecommendation: resolveLeaveDecision({ guards: { forceEscalate: false, reasons: [] }, decisionOutcome: outcome }),
      decisionRationale: interaction.rationale ?? null,
      decisionGuardReasons: [],
    });
  }
  return byRequest;
}

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
    employeeProfileId: r.employeeProfileId,
    employeeName: r.employeeProfile.displayName,
    employeeId: r.employeeProfile.employeeId,
    departmentId: r.employeeProfile.departmentId,
    leaveType: r.leaveType,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    reason: r.reason,
    status: r.status,
    approverName: r.approver?.displayName ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    decisionInteractionId: r.decisionInteractionId,
    decisionRecommendation: null,
    decisionRationale: null,
    decisionGuardReasons: [],
    createdAt: r.createdAt.toISOString(),
  }));
});
