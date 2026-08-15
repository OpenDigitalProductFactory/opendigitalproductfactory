// Thin I/O wrapper for the time-off recommendation coworker (BI-4D030159).
// It gathers canonical leave + staffing facts, then delegates every decision
// to the pure propose-only core. It never changes LeaveRequest.status.

import { prisma } from "@dpf/db";

import { evaluateOrgBusinessDecisionGate } from "@/lib/decision-perspective/org-business-gate";
import {
  getLeaveBalances,
  getLeaveRequests,
  getTeamLeaveCalendar,
  type LeaveRequestRow,
} from "@/lib/leave-data";
import {
  getStaffingCoverage,
  type StaffingCoverageClient,
} from "@/lib/workforce/staffing/staffing-coverage";

import {
  decideLeaveRequest,
  type LeaveDecisionInputs,
  type LeaveDecisionResult,
} from "./leave-decision-coworker";

export type DecideLeaveRequestFromDataInput = {
  requestId: string;
  organizationId: string;
  minCoverageCushion?: number | null;
  maxConsecutiveDays?: number | null;
  inBlackoutWindow?: boolean;
};

export type LeaveDecisionRuntimeResult = LeaveDecisionResult & {
  request: LeaveRequestRow;
  inputs: LeaveDecisionInputs;
};

export async function decideLeaveRequestFromData(
  input: DecideLeaveRequestFromDataInput,
): Promise<LeaveDecisionRuntimeResult> {
  const [request] = await getLeaveRequests({ requestId: input.requestId });
  if (!request) throw new Error(`Leave request ${input.requestId} was not found`);
  if (request.status !== "pending") {
    throw new Error(`Leave request ${input.requestId} is ${request.status}, not pending`);
  }

  const startDate = new Date(request.startDate);
  const endDate = new Date(request.endDate);
  const [balances, approvedOverlap, staffing] = await Promise.all([
    getLeaveBalances(request.employeeProfileId, startDate.getUTCFullYear()),
    getTeamLeaveCalendar(request.departmentId ?? undefined, startDate, endDate),
    getStaffingCoverage(prisma as unknown as StaffingCoverageClient, {
      organizationId: input.organizationId,
      startDate,
      endDate,
    }),
  ]);

  const balance = balances.find((row) => row.leaveType === request.leaveType);
  const overlapCount = approvedOverlap.filter((row) => row.requestId !== request.requestId).length;
  const weakestCoverage = staffing.coverage.reduce<{
    requiredHeadcount: number;
    coveredIfApproved: number;
  } | null>((weakest, row) => {
    const candidate = {
      requiredHeadcount: row.required,
      coveredIfApproved: Math.max(0, row.assigned - overlapCount - 1),
    };
    if (!weakest) return candidate;
    const weakestHeadroom = weakest.coveredIfApproved - weakest.requiredHeadcount;
    const candidateHeadroom = candidate.coveredIfApproved - candidate.requiredHeadcount;
    return candidateHeadroom < weakestHeadroom ? candidate : weakest;
  }, null) ?? { requiredHeadcount: 0, coveredIfApproved: 0 };

  const decisionInputs: LeaveDecisionInputs = {
    requestId: request.requestId,
    leaveType: request.leaveType,
    organizationId: input.organizationId,
    requestedDays: request.days,
    remainingBalance: balance?.remaining ?? 0,
    coverage: weakestCoverage,
    minCoverageCushion: input.minCoverageCushion,
    maxConsecutiveDays: input.maxConsecutiveDays,
    requestedConsecutiveDays: request.days,
    inBlackoutWindow: input.inBlackoutWindow,
  };
  const result = await decideLeaveRequest(decisionInputs, {
    db: prisma,
    gate: evaluateOrgBusinessDecisionGate,
  });

  return { ...result, request, inputs: decisionInputs };
}
