import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const prisma = vi.hoisted(() => ({
  leaveRequest: { findMany: vi.fn() },
  agentActionProposal: { findMany: vi.fn() },
  decisionInteraction: { findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma }));
const guards = vi.hoisted(() => ({ evaluateCurrentLeaveGuards: vi.fn() }));
vi.mock("@/lib/workforce/leave/leave-guard-facts", () => guards);

import { getLeaveRequests } from "./leave-data";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decisionInteraction.findMany.mockResolvedValue([]);
  guards.evaluateCurrentLeaveGuards.mockResolvedValue(new Map());
});

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

// PR-B (BI-7BCC87BB; spec D2 S5, AC-LEAVE; BI-7BCC87BB "moved here from PR-A"):
// the recommendation is read DecisionInteraction first, then the hard guards
// evaluated now over current facts, then the legacy proposal.
describe("getLeaveRequests recommendation — dual read", () => {
  const request = (requestId: string, over: Record<string, unknown> = {}) => ({
    id: `db-${requestId}`, requestId, employeeProfileId: "ep-1", leaveType: "vacation",
    startDate: new Date("2026-08-20T00:00:00.000Z"), endDate: new Date("2026-08-21T00:00:00.000Z"),
    days: 2, reason: null, status: "pending", approvedAt: null, rejectionReason: null, decisionInteractionId: null,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    employeeProfile: { displayName: "Ada", employeeId: "EMP-1", departmentId: "dept-1", managerEmployeeId: null },
    approver: null,
    ...over,
  });

  it("reads the recommendation through the request's DecisionInteraction", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([request("LR-1", { decisionInteractionId: "DI-1" }), request("LR-2", { decisionInteractionId: "DI-2" })]);
    prisma.decisionInteraction.findMany.mockResolvedValue([
      { interactionId: "DI-1", outcomeType: "recommend", recommendedOptionId: "approve", rationale: "Coverage holds." },
      { interactionId: "DI-2", outcomeType: "escalate", recommendedOptionId: null, rationale: "The stance is silent here." },
    ]);
    prisma.agentActionProposal.findMany.mockResolvedValue([
      { parameters: { requestId: "LR-1", recommendation: "deny", interactionId: "DI-1", rationale: "stale legacy", guardReasons: [] } },
    ]);
    const rows = await getLeaveRequests();
    expect(prisma.decisionInteraction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { interactionId: { in: ["DI-1", "DI-2"] } },
    }));
    expect(rows.map((row) => [row.requestId, row.decisionRecommendation, row.decisionRationale, row.decisionGuardReasons])).toEqual([
      ["LR-1", "approve", "Coverage holds.", []],
      ["LR-2", "escalate", "The stance is silent here.", []],
    ]);
    // Requests with an interaction are not re-evaluated.
    expect(guards.evaluateCurrentLeaveGuards).toHaveBeenCalledWith([]);
  });

  it("a pending request with no interaction shows the guards that fire now: needs a human approver", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([request("LR-3"), request("LR-4"), request("LR-5", { status: "approved" })]);
    prisma.agentActionProposal.findMany.mockResolvedValue([
      { parameters: { requestId: "LR-4", recommendation: "escalate", interactionId: null, rationale: "Escalated earlier: balance.", guardReasons: ["Old balance reason."] } },
    ]);
    guards.evaluateCurrentLeaveGuards.mockResolvedValue(new Map([["LR-3", ["Approving would breach required coverage (1 covered vs 2 required)."]]]));

    const rows = await getLeaveRequests();
    expect(guards.evaluateCurrentLeaveGuards).toHaveBeenCalledWith([expect.objectContaining({ requestId: "LR-3" }), expect.objectContaining({ requestId: "LR-4" })]);
    expect(rows.map((row) => [row.requestId, row.decisionRecommendation, row.decisionRationale, row.decisionGuardReasons])).toEqual([
      ["LR-3", "escalate", "Needs a human approver: Approving would breach required coverage (1 covered vs 2 required).", ["Approving would breach required coverage (1 covered vs 2 required)."]],
      // No guard fires now: the legacy guard-only proposal still shows.
      ["LR-4", "escalate", "Escalated earlier: balance.", ["Old balance reason."]],
      ["LR-5", null, null, []],
    ]);
  });

  it("a guard evaluation that fails falls back to the legacy read, never to an error", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([request("LR-6")]);
    prisma.agentActionProposal.findMany.mockResolvedValue([]);
    guards.evaluateCurrentLeaveGuards.mockRejectedValue(new Error("staffing unavailable"));
    const [row] = await getLeaveRequests();
    expect(row?.decisionRecommendation).toBeNull();
  });

  it("the advisor's own read can skip the current-guard evaluation", async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([request("LR-7")]);
    prisma.agentActionProposal.findMany.mockResolvedValue([]);
    await getLeaveRequests({ requestId: "LR-7", withCurrentGuards: false });
    expect(guards.evaluateCurrentLeaveGuards).not.toHaveBeenCalled();
  });
});
