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
    linkDecisionInteraction: vi.fn().mockResolvedValue(undefined),
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
      messageContent: "Time-off recommendation for LR-1: approve. Approve under the recorded staffing stance.",
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: "DI-1" },
    });
    expect(result).toEqual({ recommendationId: "leave-decision:LR-1:DI-1", status: "proposed" });
  });

  it("is idempotent per request: the same request's recommendation is not written twice, and its link is still made", async () => {
    const store = persistence({ findExistingMessage: vi.fn().mockResolvedValue({ id: "msg-0" }) });
    const result = await proposeLeaveDecision({ decision, userId: "user-1", persistence: store });
    expect(store.findExistingMessage).toHaveBeenCalledWith({
      threadId: "thread-1",
      content: "Time-off recommendation for LR-1: approve. Approve under the recorded staffing stance.",
    });
    expect(result).toEqual({ recommendationId: "leave-decision:LR-1:DI-1", status: "proposed", existing: true });
    expect(store.writeRecommendation).not.toHaveBeenCalled();
    // A message written before the link landed must not leave the request unlinked.
    expect(store.linkDecisionInteraction).toHaveBeenCalledWith({ requestId: "LR-1", decisionInteractionId: "DI-1" });
  });

  it("a second request with the same recommendation prose gets its own message and its own link", async () => {
    const written = new Set<string>();
    const store = persistence({
      findExistingMessage: vi.fn(async ({ content }: { content: string }) => (written.has(content) ? { id: "msg-x" } : null)),
      writeRecommendation: vi.fn(async (input: { messageContent: string }) => {
        written.add(input.messageContent);
        return { messageId: `msg-${written.size}` };
      }),
    });
    await proposeLeaveDecision({ decision, userId: "user-1", persistence: store });
    const second = {
      ...decision, interactionId: "DI-2",
      request: { ...decision.request, requestId: "LR-2" }, inputs: { ...decision.inputs, requestId: "LR-2" },
    };
    const result = await proposeLeaveDecision({ decision: second, userId: "user-1", persistence: store });
    expect(result).toEqual({ recommendationId: "leave-decision:LR-2:DI-2", status: "proposed" });
    expect(store.writeRecommendation).toHaveBeenCalledTimes(2);
    expect(store.writeRecommendation).toHaveBeenLastCalledWith(expect.objectContaining({
      leaveRequestUpdate: { requestId: "LR-2", decisionInteractionId: "DI-2" },
    }));
  });

  // BI-5CA6AB34: a recommendation reaches the manager only with the kernel
  // record behind it. Without one nothing is written; the request stays in the
  // approver's leave queue, so no human authority is lost.
  it("a recommendation with no kernel record is refused and nothing is written or linked", async () => {
    const store = persistence();
    const unrecorded = {
      ...decision, action: "escalate" as const, interactionId: null, orgProfileSelected: false,
      operatorMessage: "Escalated to a human approver: Coverage would breach.", guardReasons: ["Coverage would breach."],
    };
    const result = await proposeLeaveDecision({ decision: unrecorded, userId: "user-1", persistence: store });
    expect(result.status).toBe("refused");
    expect(store.writeRecommendation).not.toHaveBeenCalled();
    expect(store.linkDecisionInteraction).not.toHaveBeenCalled();
    expect(store.ensureThread).not.toHaveBeenCalled();
  });

  it("a fired rail's recommendation carries its rail record like any other", async () => {
    const store = persistence();
    const railed = {
      ...decision, action: "escalate" as const, interactionId: "DI-RAIL-1", orgProfileSelected: false,
      operatorMessage: "Escalated to a human approver: Coverage would breach.", guardReasons: ["Coverage would breach."],
    };
    const result = await proposeLeaveDecision({ decision: railed, userId: "user-1", persistence: store });
    expect(result.status).toBe("proposed");
    expect(store.writeRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      leaveRequestUpdate: { requestId: "LR-1", decisionInteractionId: "DI-RAIL-1" },
    }));
    expect(result.recommendationId).toBe("leave-decision:LR-1:DI-RAIL-1");
  });

  it("the module no longer touches the proposal table", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./decide-proposal.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("agentActionProposal");
  });
});
