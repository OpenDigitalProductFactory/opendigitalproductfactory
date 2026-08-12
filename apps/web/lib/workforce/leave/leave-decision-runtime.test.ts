import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLeaveRequests: vi.fn(),
  getLeaveBalances: vi.fn(),
  getTeamLeaveCalendar: vi.fn(),
  getStaffingCoverage: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { marker: "db" } }));
vi.mock("@/lib/leave-data", () => ({
  getLeaveRequests: mocks.getLeaveRequests,
  getLeaveBalances: mocks.getLeaveBalances,
  getTeamLeaveCalendar: mocks.getTeamLeaveCalendar,
}));
vi.mock("@/lib/workforce/staffing/staffing-coverage", () => ({
  getStaffingCoverage: mocks.getStaffingCoverage,
}));
vi.mock("@/lib/decision-perspective/org-business-gate", () => ({
  evaluateOrgBusinessDecisionGate: mocks.gate,
}));

import { decideLeaveRequestFromData } from "./leave-decision-runtime";

const request = {
  id: "leave-db-1",
  requestId: "LR-1",
  employeeProfileId: "employee-profile-1",
  employeeName: "Ada Lovelace",
  employeeId: "EMP-1",
  departmentId: "dept-1",
  leaveType: "vacation",
  startDate: "2026-08-20T00:00:00.000Z",
  endDate: "2026-08-21T00:00:00.000Z",
  days: 2,
  reason: null,
  status: "pending",
  approverName: null,
  approvedAt: null,
  rejectionReason: null,
  decisionInteractionId: null,
  decisionRecommendation: null,
  decisionRationale: null,
  createdAt: "2026-08-12T00:00:00.000Z",
};

describe("decideLeaveRequestFromData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLeaveRequests.mockResolvedValue([request]);
    mocks.getLeaveBalances.mockResolvedValue([
      { id: "balance-1", leaveType: "vacation", year: 2026, allocated: 10, used: 2, carriedOver: 0, adjustments: 0, remaining: 8 },
    ]);
    mocks.getTeamLeaveCalendar.mockResolvedValue([{ ...request, requestId: "LR-approved", status: "approved" }]);
    mocks.getStaffingCoverage.mockResolvedValue({
      coverage: [{ demandId: "demand-1", required: 3, assigned: 6, covered: true, status: "covered" }],
      uncoveredCount: 0,
    });
    mocks.gate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-1",
      orgProfileSelected: true,
      operatorMessage: "Approve under the recorded staffing stance.",
      evaluation: { outcomeType: "recommend", recommendedOptionId: "approve" },
    });
  });

  it("loads the canonical leave and overlapping coverage data, then calls the real WWWD seam", async () => {
    const result = await decideLeaveRequestFromData({
      requestId: "LR-1",
      organizationId: "org-1",
      minCoverageCushion: 1,
    });

    expect(mocks.getLeaveRequests).toHaveBeenCalledWith({ requestId: "LR-1" });
    expect(mocks.getLeaveBalances).toHaveBeenCalledWith("employee-profile-1", 2026);
    expect(mocks.getTeamLeaveCalendar).toHaveBeenCalledWith(
      "dept-1",
      new Date(request.startDate),
      new Date(request.endDate),
    );
    expect(mocks.getStaffingCoverage).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      startDate: new Date(request.startDate),
      endDate: new Date(request.endDate),
    });
    expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      domainClass: "risk-assessment",
    }));
    expect(result).toMatchObject({
      action: "approve",
      interactionId: "DI-1",
      orgProfileSelected: true,
      request,
      inputs: {
        requestedDays: 2,
        remainingBalance: 8,
        minCoverageCushion: 1,
        requestedConsecutiveDays: 2,
        coverage: { requiredHeadcount: 3, coveredIfApproved: 4 },
      },
    });
  });

  it("short-circuits to a human without calling WWWD when the balance rail fires", async () => {
    mocks.getLeaveBalances.mockResolvedValue([
      { id: "balance-1", leaveType: "vacation", year: 2026, allocated: 1, used: 0, carriedOver: 0, adjustments: 0, remaining: 1 },
    ]);

    const result = await decideLeaveRequestFromData({ requestId: "LR-1", organizationId: "org-1" });

    expect(result.action).toBe("escalate");
    expect(result.interactionId).toBeNull();
    expect(result.guardReasons[0]).toContain("overdraw");
    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it("fails honestly when the request does not exist", async () => {
    mocks.getLeaveRequests.mockResolvedValue([]);
    await expect(
      decideLeaveRequestFromData({ requestId: "LR-missing", organizationId: "org-1" }),
    ).rejects.toThrow("Leave request LR-missing was not found");
  });
});
