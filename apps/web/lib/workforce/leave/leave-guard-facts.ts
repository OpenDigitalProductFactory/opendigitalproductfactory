// The hard-guard inputs for one leave request, built from current facts, and
// the read-time evaluation the leave surface uses (BI-7BCC87BB, spec D2 S5).
//
// A guard-only recommendation (a hard rail fired, so the coworker escalated
// without consulting the organisation's stance) carries no judgment and leaves
// no DecisionInteraction. After PR-B it leaves no proposal either, so the leave
// surface evaluates the same pure `evaluateLeaveGuards` over the facts as they
// are now and shows "Needs a human approver: <reasons>". Named delta: the
// reasons reflect the facts at the time of reading, not when the advisor ran.
//
// `buildLeaveGuardInputs` is the one place the coverage arithmetic lives; the
// advisor's runtime (leave-decision-runtime.ts) uses it too.

import { prisma } from "@dpf/db";

import { getStaffingCoverage, type StaffingCoverageClient } from "@/lib/workforce/staffing/staffing-coverage";

import type { LeaveDecisionInputs } from "./leave-decision-coworker";
import { evaluateLeaveGuards } from "./leave-decision-policy";

/** The request fields the guards read. Dates are ISO strings, as LeaveRequestRow carries them. */
export type LeaveGuardRequest = {
  requestId: string;
  employeeProfileId: string;
  departmentId: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
};

export function buildLeaveGuardInputs(input: {
  request: Pick<LeaveGuardRequest, "requestId" | "leaveType" | "days">;
  organizationId: string;
  remainingBalance: number;
  approvedOverlap: Array<{ requestId: string }>;
  staffing: { coverage: Array<{ required: number; assigned: number }> };
  minCoverageCushion?: number | null;
  maxConsecutiveDays?: number | null;
  inBlackoutWindow?: boolean;
}): LeaveDecisionInputs {
  const overlapCount = input.approvedOverlap.filter((row) => row.requestId !== input.request.requestId).length;
  const weakestCoverage = input.staffing.coverage.reduce<{
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

  return {
    requestId: input.request.requestId,
    leaveType: input.request.leaveType,
    organizationId: input.organizationId,
    requestedDays: input.request.days,
    remainingBalance: input.remainingBalance,
    coverage: weakestCoverage,
    minCoverageCushion: input.minCoverageCushion,
    maxConsecutiveDays: input.maxConsecutiveDays,
    requestedConsecutiveDays: input.request.days,
    inBlackoutWindow: input.inBlackoutWindow,
  };
}

type GuardFactsDb = {
  organization: { findFirst(args: unknown): Promise<{ id: string } | null> };
  leaveBalance: {
    findMany(args: unknown): Promise<Array<{
      employeeProfileId: string; leaveType: string; year: number;
      allocated: number; carriedOver: number; adjustments: number; used: number;
    }>>;
  };
  leaveRequest: {
    findMany(args: unknown): Promise<Array<{ requestId: string; employeeProfile?: { departmentId: string | null } | null }>>;
  };
};

/**
 * The guard reasons that fire now, per request. Requests whose guards all pass
 * are absent. Uses the advisor's default cushion (0); the advisor's tool takes
 * no other policy input, so this is the same evaluation it would make today.
 */
export async function evaluateCurrentLeaveGuards(
  requests: LeaveGuardRequest[],
  db: GuardFactsDb = prisma as unknown as GuardFactsDb,
): Promise<Map<string, string[]>> {
  const reasons = new Map<string, string[]>();
  if (requests.length === 0) return reasons;
  const organization = await db.organization.findFirst({ select: { id: true } });
  if (!organization) return reasons;

  const balances = await db.leaveBalance.findMany({
    where: { employeeProfileId: { in: [...new Set(requests.map((r) => r.employeeProfileId))] } },
  });
  for (const request of requests) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    const balance = balances.find((row) =>
      row.employeeProfileId === request.employeeProfileId
      && row.leaveType === request.leaveType
      && row.year === start.getUTCFullYear());
    const [overlap, staffing] = await Promise.all([
      db.leaveRequest.findMany({
        where: { status: "approved", startDate: { lte: end }, endDate: { gte: start } },
        select: { requestId: true, employeeProfile: { select: { departmentId: true } } },
      }),
      getStaffingCoverage(db as unknown as StaffingCoverageClient, { organizationId: organization.id, startDate: start, endDate: end }),
    ]);
    const inputs = buildLeaveGuardInputs({
      request,
      organizationId: organization.id,
      remainingBalance: balance ? balance.allocated + balance.carriedOver + balance.adjustments - balance.used : 0,
      approvedOverlap: request.departmentId
        ? overlap.filter((row) => row.employeeProfile?.departmentId === request.departmentId)
        : overlap,
      staffing,
    });
    const verdict = evaluateLeaveGuards(inputs);
    if (verdict.forceEscalate) reasons.set(request.requestId, verdict.reasons);
  }
  return reasons;
}
