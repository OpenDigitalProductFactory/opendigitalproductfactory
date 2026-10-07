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

// Approval convergence A1 characterisation (BI-C8EC05C9): the recommendation
// is read from the newest leave.decide proposal per request, any status; a
// request with none projects nulls. A guard-only proposal carries its reasons.
describe("getLeaveRequests recommendation projection — convergence characterisation", () => {
  const request = (requestId: string) => ({
    id: `db-${requestId}`, requestId, employeeProfileId: "ep-1", leaveType: "vacation",
    startDate: new Date("2026-08-20T00:00:00.000Z"), endDate: new Date("2026-08-21T00:00:00.000Z"),
    days: 2, reason: null, status: "pending", approvedAt: null, rejectionReason: null, decisionInteractionId: null,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    employeeProfile: { displayName: "Ada", employeeId: "EMP-1", departmentId: "dept-1", managerEmployeeId: null },
    approver: null,
  });

  it("takes the newest proposal per request, keeps guard reasons, and projects nulls without one", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([request("LR-1"), request("LR-2")]);
    prisma.agentActionProposal.findMany.mockResolvedValue([
      { parameters: { requestId: "LR-1", recommendation: "escalate", interactionId: null, rationale: "Escalated to a human approver: Coverage would breach.", guardReasons: ["Coverage would breach."] } },
      { parameters: { requestId: "LR-1", recommendation: "approve", interactionId: "DI-old", rationale: "older", guardReasons: [] } },
    ]);
    const rows = await getLeaveRequests();
    expect(prisma.agentActionProposal.findMany).toHaveBeenCalledWith({
      where: { actionType: "leave.decide" }, orderBy: { proposedAt: "desc" }, take: 100, select: { parameters: true },
    });
    expect(rows.map((row) => [row.requestId, row.decisionRecommendation, row.decisionRationale, row.decisionGuardReasons])).toEqual([
      ["LR-1", "escalate", "Escalated to a human approver: Coverage would breach.", ["Coverage would breach."]],
      ["LR-2", null, null, []],
    ]);
  });
});
