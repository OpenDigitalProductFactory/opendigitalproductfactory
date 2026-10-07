import { describe, expect, it, vi } from "vitest";

import {
  LEAVE_DECISION_ACTION,
  prepareLeaveDecisionProposal,
  proposeLeaveDecision,
  type LeaveDecisionProposalPersistence,
} from "./decide-proposal";

const decision = {
  action: "approve" as const,
  interactionId: "DI-1",
  orgProfileSelected: true,
  operatorMessage: "Approve under the recorded staffing stance.",
  guardReasons: [],
  request: {
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
    decisionGuardReasons: [],
    createdAt: "2026-08-12T00:00:00.000Z",
  },
  inputs: {
    requestId: "LR-1",
    leaveType: "vacation",
    organizationId: "org-1",
    requestedDays: 2,
    remainingBalance: 8,
    coverage: { requiredHeadcount: 3, coveredIfApproved: 4 },
    minCoverageCushion: 1,
    requestedConsecutiveDays: 2,
  },
};

describe("leave decision proposal", () => {
  it("prepares a propose-only leave.decide payload with the WWWD audit link", () => {
    const draft = prepareLeaveDecisionProposal(decision);
    expect(draft.actionType).toBe(LEAVE_DECISION_ACTION);
    expect(draft.autoDecide).toBe(false);
    expect(draft.parameters).toMatchObject({
      requestId: "LR-1",
      recommendation: "approve",
      interactionId: "DI-1",
      orgProfileSelected: true,
      minCoverageCushion: 1,
    });
  });

  it("writes one proposed AgentActionProposal and links the request without changing leave status", async () => {
    const persistence: LeaveDecisionProposalPersistence = {
      findExisting: vi.fn().mockResolvedValue(null),
      ensureThread: vi.fn().mockResolvedValue({ id: "thread-1" }),
      createProposalBundle: vi.fn().mockResolvedValue({ proposalId: "leave-decision:LR-1:DI-1", status: "proposed" }),
    };

    const result = await proposeLeaveDecision({
      decision,
      userId: "user-1",
      agentId: "time-off-advisor",
      persistence,
    });

    expect(persistence.createProposalBundle).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "leave-decision:LR-1:DI-1",
      threadId: "thread-1",
      actionType: "leave.decide",
      status: "proposed",
      leaveRequestUpdate: {
        requestId: "LR-1",
        decisionInteractionId: "DI-1",
      },
    }));
    expect(result).toEqual({ proposalId: "leave-decision:LR-1:DI-1", status: "proposed" });
  });

  it("is idempotent for the same request and interaction", async () => {
    const persistence: LeaveDecisionProposalPersistence = {
      findExisting: vi.fn().mockResolvedValue({ proposalId: "leave-decision:LR-1:DI-1", status: "proposed" }),
      ensureThread: vi.fn(),
      createProposalBundle: vi.fn(),
    };
    const result = await proposeLeaveDecision({ decision, userId: "user-1", persistence });
    expect(result).toEqual({ proposalId: "leave-decision:LR-1:DI-1", status: "proposed", existing: true });
    expect(persistence.ensureThread).not.toHaveBeenCalled();
    expect(persistence.createProposalBundle).not.toHaveBeenCalled();
  });
});

// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S5.
describe("leave decision proposal — convergence characterisation", () => {
  function persistence(): LeaveDecisionProposalPersistence {
    return {
      findExisting: vi.fn().mockResolvedValue(null),
      ensureThread: vi.fn().mockResolvedValue({ id: "thread-1" }),
      createProposalBundle: vi.fn().mockResolvedValue({ proposalId: "x", status: "proposed" }),
    };
  }

  it("writes the 'Time-off recommendation' assistant message in the same bundle as the proposal", async () => {
    const store = persistence();
    await proposeLeaveDecision({ decision, userId: "user-1", agentId: "time-off-advisor", taskRunId: "TR-1", persistence: store });
    expect(store.createProposalBundle).toHaveBeenCalledWith({
      proposalId: "leave-decision:LR-1:DI-1",
      threadId: "thread-1",
      taskRunId: "TR-1",
      agentId: "time-off-advisor",
      actionType: "leave.decide",
      parameters: expect.objectContaining({ requestId: "LR-1", recommendation: "approve", interactionId: "DI-1", guardReasons: [] }),
      messageContent: "Time-off recommendation: approve. Approve under the recorded staffing stance.",
      status: "proposed",
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: "DI-1" },
    });
  });

  it("a guard-only recommendation has no interaction: keyed by the guard, links nothing", async () => {
    const store = persistence();
    const guarded = {
      ...decision, action: "escalate" as const, interactionId: null, orgProfileSelected: false,
      operatorMessage: "Escalated to a human approver: Coverage would breach.", guardReasons: ["Coverage would breach."],
    };
    await proposeLeaveDecision({ decision: guarded, userId: "user-1", persistence: store });
    expect(store.findExisting).toHaveBeenCalledWith("leave-decision:LR-1:guard-escalate");
    expect(store.createProposalBundle).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "leave-decision:LR-1:guard-escalate",
      agentId: "time-off-advisor",
      parameters: expect.objectContaining({ recommendation: "escalate", interactionId: null, guardReasons: ["Coverage would breach."] }),
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: null },
    }));
  });
});
