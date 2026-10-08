// BI-4E192035 — AC-LEAVE-EXPLICIT on the v1 approvals API. A leave.decide
// proposal's outcome is a leave decision, which this endpoint cannot express:
// it refuses with 409 and points at the explicit leave actions (option B,
// WWMD DI-DC208379563E) instead of flipping the proposal status and stranding
// the LeaveRequest as pending.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  prisma: {
    agentActionProposal: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leaveRequest: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/actions/leave", () => ({
  approveLeaveRequest: mocks.approveLeaveRequest,
  rejectLeaveRequest: mocks.rejectLeaveRequest,
}));
vi.mock("@/lib/proactivity/proactivity-override-preferences", () => ({
  buildProactivityDismissalFact: vi.fn(),
  buildProactivityOverrideFact: vi.fn(),
  persistProactivityFact: vi.fn(),
}));

import { POST } from "./route";
import {
  LEAVE_DECISION_ROUTE,
  LEAVE_DECISION_VERB_REFUSAL,
} from "@/lib/workforce/leave/leave-decision-proposal-contract";

function post(decision: "approve" | "reject") {
  return POST(
    new Request("http://localhost/api/v1/governance/approvals/cuid-leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
    { params: Promise.resolve({ id: "cuid-leave" }) },
  );
}

describe("AC-LEAVE-EXPLICIT: v1 approvals endpoint on a leave.decide proposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.agentActionProposal.update.mockResolvedValue({ id: "cuid-leave" });
    mocks.approveLeaveRequest.mockResolvedValue({ success: true });
    mocks.rejectLeaveRequest.mockResolvedValue({ success: true });
  });

  it.each([
    ["approve", "deny"],
    ["approve", "approve"],
    ["approve", "escalate"],
    ["reject", "deny"],
    ["reject", "approve"],
  ] as const)(
    "%s on a %s-recommendation proposal returns 409, points at the leave actions, and changes nothing",
    async (decision, recommendation) => {
      mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
        id: "cuid-leave",
        proposalId: "AP-LEAVE",
        actionType: "leave.decide",
        status: "proposed",
        parameters: { requestId: "LR-1", recommendation, rationale: "Advisor rationale.", guardReasons: [] },
        thread: { userId: "user-1" },
      });

      const response = await post(decision);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: "LEAVE_DECIDED_EXPLICITLY",
        message: LEAVE_DECISION_VERB_REFUSAL,
        decideAt: LEAVE_DECISION_ROUTE,
      });
      expect(mocks.prisma.agentActionProposal.update).not.toHaveBeenCalled();
      expect(mocks.approveLeaveRequest).not.toHaveBeenCalled();
      expect(mocks.rejectLeaveRequest).not.toHaveBeenCalled();
    },
  );
});
