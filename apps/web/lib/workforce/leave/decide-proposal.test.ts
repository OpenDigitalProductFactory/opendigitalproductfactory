import { describe, expect, it, vi } from "vitest";

import {
  LEAVE_DECISION_ACTION,
  prepareLeaveDecisionProposal,
  proposeLeaveDecision,
  type LeaveDecisionRecommendationPersistence,
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

// PR-B named delta (BI-7BCC87BB; spec D2 S5, AC-LEAVE): the recommendation is
// no longer an AgentActionProposal. The assistant message and the request's
// DecisionInteraction link are written; no proposal and no envelope.
function persistence(over: Partial<LeaveDecisionRecommendationPersistence> = {}): LeaveDecisionRecommendationPersistence {
  return {
    ensureThread: vi.fn().mockResolvedValue({ id: "thread-1" }),
    findExistingMessage: vi.fn().mockResolvedValue(null),
    writeRecommendation: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
    ...over,
  };
}

describe("leave decision recommendation", () => {
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

  it("writes the 'Time-off recommendation' assistant message and links the request, without a proposal", async () => {
    const store = persistence();
    const result = await proposeLeaveDecision({ decision, userId: "user-1", agentId: "time-off-advisor", taskRunId: "TR-1", persistence: store });
    expect(store.writeRecommendation).toHaveBeenCalledWith({
      threadId: "thread-1",
      taskRunId: "TR-1",
      agentId: "time-off-advisor",
      messageContent: "Time-off recommendation: approve. Approve under the recorded staffing stance.",
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: "DI-1" },
    });
    expect(result).toEqual({ recommendationId: "leave-decision:LR-1:DI-1", status: "proposed" });
  });

  it("is idempotent: the same recommendation already in the thread is not written twice", async () => {
    const store = persistence({ findExistingMessage: vi.fn().mockResolvedValue({ id: "msg-0" }) });
    const result = await proposeLeaveDecision({ decision, userId: "user-1", persistence: store });
    expect(store.findExistingMessage).toHaveBeenCalledWith({
      threadId: "thread-1",
      content: "Time-off recommendation: approve. Approve under the recorded staffing stance.",
    });
    expect(result).toEqual({ recommendationId: "leave-decision:LR-1:DI-1", status: "proposed", existing: true });
    expect(store.writeRecommendation).not.toHaveBeenCalled();
  });

  it("a guard-only recommendation has no interaction: keyed by the guard, links nothing", async () => {
    const store = persistence();
    const guarded = {
      ...decision, action: "escalate" as const, interactionId: null, orgProfileSelected: false,
      operatorMessage: "Escalated to a human approver: Coverage would breach.", guardReasons: ["Coverage would breach."],
    };
    const result = await proposeLeaveDecision({ decision: guarded, userId: "user-1", persistence: store });
    expect(store.writeRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "time-off-advisor",
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: null },
    }));
    expect(result.recommendationId).toBe("leave-decision:LR-1:guard-escalate");
  });

  it("the module no longer touches the proposal table", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./decide-proposal.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("agentActionProposal");
  });
});
