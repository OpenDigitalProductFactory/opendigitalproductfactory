import { beforeEach, describe, expect, it, vi } from "vitest";

// D1 (BI-04529D29): approveLeaveRequest / rejectLeaveRequest must write an
// AuthorizationDecisionLog through the governance path — allow on a completed
// decision, deny when the org-chart approval authority refuses. Leave uses the
// manager-authority model (authorizeApprovalDecision), not the platform-capability
// wrapper, so the audit log is written directly around that check.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/routes", () => ({ ROUTES: { employee: "/employee" } }));
vi.mock("@/lib/governance-data", () => ({ createAuthorizationDecisionLog: vi.fn() }));
vi.mock("@/lib/workforce/approval-authority", () => ({ authorizeApprovalDecision: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    leaveRequest: { findUnique: vi.fn(), update: vi.fn() },
    leaveBalance: { upsert: vi.fn() },
    agentActionProposal: { updateMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { createAuthorizationDecisionLog } from "@/lib/governance-data";
import { authorizeApprovalDecision } from "@/lib/workforce/approval-authority";
import { approveLeaveRequest, rejectLeaveRequest } from "./leave";

const authMock = auth as unknown as { mockResolvedValue: (value: unknown) => void };

const pendingRequest = {
  requestId: "LR-ABCD1234",
  status: "pending",
  employeeProfileId: "emp-subject",
  leaveType: "annual",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2026-09-03"),
  days: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-approver" } });
  vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest } as never);
  vi.mocked(prisma.leaveRequest.update).mockResolvedValue({} as never);
  vi.mocked(prisma.leaveBalance.upsert).mockResolvedValue({} as never);
  vi.mocked(createAuthorizationDecisionLog).mockResolvedValue();
});

describe("approveLeaveRequest — governance audit", () => {
  it("writes an allow AuthorizationDecisionLog on a successful approval", async () => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({
      ok: true,
      approverEmployeeId: "emp-approver",
    } as never);

    const result = await approveLeaveRequest("LR-ABCD1234");

    expect(result.success).toBe(true);
    expect(prisma.leaveRequest.update).toHaveBeenCalled();
    expect(prisma.agentActionProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actionType: "leave.decide", status: "proposed" }),
      data: expect.objectContaining({ status: "executed", decidedById: "user-approver" }),
    }));
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "user",
        actorRef: "user-approver",
        actionKey: "leave.approve",
        objectRef: "LR-ABCD1234",
        decision: "allow",
      }),
    );
  });

  it("writes a deny AuthorizationDecisionLog and does not mutate state when authority refuses", async () => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({
      ok: false,
      error: "not the accountable approver",
    } as never);

    const result = await approveLeaveRequest("LR-ABCD1234");

    expect(result.success).toBe(false);
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: "leave.approve",
        objectRef: "LR-ABCD1234",
        decision: "deny",
      }),
    );
  });
});

describe("rejectLeaveRequest — governance audit", () => {
  it("writes an allow AuthorizationDecisionLog on a successful rejection", async () => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({
      ok: true,
      approverEmployeeId: "emp-approver",
    } as never);

    const result = await rejectLeaveRequest("LR-ABCD1234", "insufficient coverage");

    expect(result.success).toBe(true);
    expect(prisma.leaveRequest.update).toHaveBeenCalled();
    expect(prisma.agentActionProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actionType: "leave.decide", status: "proposed" }),
      data: expect.objectContaining({ status: "rejected", decidedById: "user-approver" }),
    }));
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "user",
        actorRef: "user-approver",
        actionKey: "leave.reject",
        objectRef: "LR-ABCD1234",
        decision: "allow",
      }),
    );
  });

  it("writes a deny AuthorizationDecisionLog and does not mutate state when authority refuses", async () => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({
      ok: false,
      error: "not the accountable approver",
    } as never);

    const result = await rejectLeaveRequest("LR-ABCD1234", "any reason");

    expect(result.success).toBe(false);
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(createAuthorizationDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: "leave.reject",
        objectRef: "LR-ABCD1234",
        decision: "deny",
      }),
    );
  });
});
