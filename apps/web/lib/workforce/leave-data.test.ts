import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const prisma = vi.hoisted(() => ({
  leaveRequest: { findMany: vi.fn() },
  agentActionProposal: { findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma }));

import { getLeaveRequests } from "./leave-data";

describe("getLeaveRequests recommendation projection", () => {
  it("joins the latest leave.decide proposal into the request read model", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([{
      id: "leave-db-1",
      requestId: "LR-1",
      employeeProfileId: "employee-profile-1",
      leaveType: "vacation",
      startDate: new Date("2026-08-20T00:00:00.000Z"),
      endDate: new Date("2026-08-21T00:00:00.000Z"),
      days: 2,
      reason: null,
      status: "pending",
      approvedAt: null,
      rejectionReason: null,
      decisionInteractionId: "DI-1",
      createdAt: new Date("2026-08-12T00:00:00.000Z"),
      employeeProfile: { displayName: "Ada", employeeId: "EMP-1", departmentId: "dept-1", managerEmployeeId: null },
      approver: null,
    }]);
    prisma.agentActionProposal.findMany.mockResolvedValue([{
      parameters: {
        requestId: "LR-1",
        recommendation: "approve",
        interactionId: "DI-1",
        rationale: "Coverage stays above the recorded cushion.",
        guardReasons: [],
      },
    }]);

    const [row] = await getLeaveRequests({ requestId: "LR-1" });
    expect(prisma.agentActionProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { actionType: "leave.decide" },
    }));
    expect(row).toMatchObject({
      decisionInteractionId: "DI-1",
      decisionRecommendation: "approve",
      decisionRationale: "Coverage stays above the recorded cushion.",
      decisionGuardReasons: [],
    });
  });
});
