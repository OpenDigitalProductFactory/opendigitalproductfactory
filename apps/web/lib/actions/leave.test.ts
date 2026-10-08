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
vi.mock("@/lib/decision/decision-outcome-store", () => ({ recordDecisionOutcome: vi.fn() }));
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
import { recordDecisionOutcome } from "@/lib/decision/decision-outcome-store";
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

// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S5:
// the manager's own decision, authority first, then balance, status, settle
// and audit. PR-B adds the DecisionInteraction resolution; these stay.
describe("leave decision — convergence characterisation", () => {
  beforeEach(() => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({ ok: true, approverEmployeeId: "emp-approver" } as never);
  });

  it("approve: authority, then balance, then status, then settle, then audit — in that order", async () => {
    await approveLeaveRequest("LR-ABCD1234");
    const order = [
      vi.mocked(authorizeApprovalDecision).mock.invocationCallOrder[0],
      vi.mocked(prisma.leaveBalance.upsert).mock.invocationCallOrder[0],
      vi.mocked(prisma.leaveRequest.update).mock.invocationCallOrder[0],
      vi.mocked(prisma.agentActionProposal.updateMany).mock.invocationCallOrder[0],
      vi.mocked(createAuthorizationDecisionLog).mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a! - b!)).toEqual(order);
    expect(authorizeApprovalDecision).toHaveBeenCalledWith("user-approver", "emp-subject", "leave");
    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { used: { increment: 3 } },
      create: expect.objectContaining({ employeeProfileId: "emp-subject", leaveType: "annual", year: 2026, allocated: 0, used: 3 }),
    }));
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { requestId: "LR-ABCD1234" },
      data: { status: "approved", approverEmployeeId: "emp-approver", approvedAt: expect.any(Date) },
    });
    expect(prisma.agentActionProposal.updateMany).toHaveBeenCalledWith({
      where: { actionType: "leave.decide", status: "proposed", parameters: { path: ["requestId"], equals: "LR-ABCD1234" } },
      data: { status: "executed", decidedAt: expect.any(Date), decidedById: "user-approver", executedAt: expect.any(Date), resultEntityId: "LR-ABCD1234" },
    });
  });

  it("reject: no balance change; settles the proposal rejected with no execution fields", async () => {
    await rejectLeaveRequest("LR-ABCD1234", "coverage");
    expect(prisma.leaveBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { requestId: "LR-ABCD1234" },
      data: { status: "rejected", approverEmployeeId: "emp-approver", rejectionReason: "coverage" },
    });
    expect(prisma.agentActionProposal.updateMany).toHaveBeenCalledWith({
      where: { actionType: "leave.decide", status: "proposed", parameters: { path: ["requestId"], equals: "LR-ABCD1234" } },
      data: { status: "rejected", decidedAt: expect.any(Date), decidedById: "user-approver" },
    });
  });

  it("a decided request is refused before the authority check", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest, status: "approved" } as never);
    await expect(approveLeaveRequest("LR-ABCD1234")).resolves.toEqual({ success: false, error: "Request already decided" });
    expect(authorizeApprovalDecision).not.toHaveBeenCalled();
  });
});

// PR-B (BI-7BCC87BB; spec D2 S5, AC-LEAVE): the manager's decision resolves the
// recommendation's DecisionInteraction. No envelope is minted; the legacy
// proposal settle stays for rows written before the change.
describe("leave decision — the manager's decision resolves the recommendation", () => {
  beforeEach(() => {
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({ ok: true, approverEmployeeId: "emp-approver" } as never);
    vi.mocked(recordDecisionOutcome).mockResolvedValue({ recorded: true } as never);
  });

  it("approve records 'approve' as the human's choice on the request's interaction", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest, decisionInteractionId: "DI-1" } as never);
    expect((await approveLeaveRequest("LR-ABCD1234")).success).toBe(true);
    expect(recordDecisionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "DI-1", chosenOptionId: "approve", resolvedBy: "human",
    }));
  });

  it("reject records 'deny' with the manager's reason", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest, decisionInteractionId: "DI-2" } as never);
    expect((await rejectLeaveRequest("LR-ABCD1234", "Coverage is short that week.")).success).toBe(true);
    expect(recordDecisionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "DI-2", chosenOptionId: "deny", resolvedBy: "human", rationale: "Coverage is short that week.",
    }));
  });

  it("records nothing when the request has no interaction (guard-only or no recommendation)", async () => {
    await approveLeaveRequest("LR-ABCD1234");
    expect(recordDecisionOutcome).not.toHaveBeenCalled();
  });

  it("a failure to record the outcome never undoes the manager's decision", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest, decisionInteractionId: "DI-1" } as never);
    vi.mocked(recordDecisionOutcome).mockRejectedValue(new Error("ledger down"));
    expect((await approveLeaveRequest("LR-ABCD1234")).success).toBe(true);
    expect(prisma.leaveRequest.update).toHaveBeenCalled();
  });

  it("is refused by authority before anything is recorded", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ ...pendingRequest, decisionInteractionId: "DI-1" } as never);
    vi.mocked(authorizeApprovalDecision).mockResolvedValue({ ok: false, error: "not the approver" } as never);
    await approveLeaveRequest("LR-ABCD1234");
    expect(recordDecisionOutcome).not.toHaveBeenCalled();
  });
});
