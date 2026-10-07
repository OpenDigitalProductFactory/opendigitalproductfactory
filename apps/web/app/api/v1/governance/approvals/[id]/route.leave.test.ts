// BI-4E192035 — AC-LEAVE-EXPLICIT on the v1 approvals API. A leave.decide
// proposal's outcome is a leave decision; the endpoint must not record the
// proposal as decided while the LeaveRequest it names is left untouched.

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

  it.each(["deny", "approve"] as const)(
    "approving a %s-recommendation proposal does not mark it decided while its leave request is untouched",
    async (recommendation) => {
      mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
        id: "cuid-leave",
        proposalId: "AP-LEAVE",
        actionType: "leave.decide",
        status: "proposed",
        parameters: { requestId: "LR-1", recommendation, rationale: "Advisor rationale.", guardReasons: [] },
        thread: { userId: "user-1" },
      });

      const response = await post("approve");

      const leaveFollowed =
        mocks.approveLeaveRequest.mock.calls.length + mocks.rejectLeaveRequest.mock.calls.length > 0;
      const refused = response.status >= 400;
      // Either the leave decision path ran, or the endpoint refused — never a
      // bare proposal status flip that strands the LeaveRequest as pending.
      expect(
        leaveFollowed || refused,
        `leave decision path ran=${leaveFollowed}, endpoint refused=${refused} (HTTP ${response.status})`,
      ).toBe(true);
      expect(mocks.prisma.agentActionProposal.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "approve" }) }),
      );
      if (recommendation === "deny") expect(mocks.approveLeaveRequest).not.toHaveBeenCalled();
    },
  );
});
