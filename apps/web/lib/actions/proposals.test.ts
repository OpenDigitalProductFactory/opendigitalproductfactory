import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  can: vi.fn(),
  prisma: {
    agentActionProposal: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    authorizationDecisionLog: {
      create: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
    },
    userFact: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/mcp-tools", () => ({
  PLATFORM_TOOLS: [{ name: "create_backlog_item", requiredCapability: "manage_backlog" }],
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/actions/leave", () => ({
  approveLeaveRequest: mocks.approveLeaveRequest,
  rejectLeaveRequest: mocks.rejectLeaveRequest,
}));

import { approveProposal, rejectProposal } from "./proposals";
import { LEAVE_DECISION_VERB_REFUSAL } from "@/lib/workforce/leave/leave-decision-proposal-contract";

const proactivityParameters = {
  kind: "proactivity-change",
  agentId: "dispatcher",
  activityFamily: "field-dispatch-appointment",
  routeContext: "/storefront",
  currentLevel: "balanced",
  proposedLevel: "assertive",
  scope: "activity-family",
  rationale: "Late customer appointments should be warned earlier.",
  evidenceRefs: [{ kind: "dispatch-event", id: "running-late" }],
  spendImpact: "may increase monitoring and notification spend within existing authority",
  authorityImpact: "does not grant new tools, permissions, or approval bypasses",
};

describe("proposal actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-06-30T18:30:00.000Z"));
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: true },
    });
    mocks.can.mockReturnValue(true);
    mocks.prisma.agentActionProposal.update.mockResolvedValue({});
    mocks.prisma.authorizationDecisionLog.create.mockResolvedValue({});
    mocks.prisma.agentMessage.create.mockResolvedValue({});
    mocks.prisma.userFact.findFirst.mockResolvedValue(null);
    mocks.prisma.userFact.update.mockResolvedValue({});
    mocks.prisma.userFact.create.mockResolvedValue({});
    mocks.executeTool.mockResolvedValue({ success: true, entityId: "BI-1", message: "Created" });
    mocks.approveLeaveRequest.mockResolvedValue({ success: true });
    mocks.rejectLeaveRequest.mockResolvedValue({ success: true });
  });

  // BI-4E192035 (option B, WWMD DI-DC208379563E) — a leave.decide proposal
  // carries the advisor's recommendation. "Approve" / "reject" of it never says
  // which leave outcome the person meant, so the generic verbs refuse and never
  // touch the leave; the leave is decided by the explicit Approve leave / Deny
  // leave actions (approveLeaveRequest / rejectLeaveRequest).
  const leaveProposal = (recommendation: "approve" | "deny" | "escalate") => ({
    proposalId: "AP-LEAVE",
    status: "proposed",
    actionType: "leave.decide",
    parameters: { requestId: "LR-1", recommendation, rationale: "Advisor rationale.", guardReasons: [] },
    agentId: "time-off-advisor",
    threadId: "thread-1",
  });

  describe("AC-LEAVE-RECOMMENDATION: approving a leave proposal never approves the leave", () => {
    it.each(["deny", "approve", "escalate"] as const)(
      "approving a %s-recommendation proposal refuses and leaves the leave request untouched",
      async (recommendation) => {
        mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(leaveProposal(recommendation));

        expect(await approveProposal("AP-LEAVE")).toEqual({
          success: false,
          error: LEAVE_DECISION_VERB_REFUSAL,
        });
        expect(mocks.approveLeaveRequest).not.toHaveBeenCalled();
        expect(mocks.rejectLeaveRequest).not.toHaveBeenCalled();
        expect(mocks.executeTool).not.toHaveBeenCalled();
        expect(mocks.prisma.agentActionProposal.update).not.toHaveBeenCalled();
      },
    );
  });

  describe("AC-LEAVE-EXPLICIT: rejecting a leave proposal never decides the leave", () => {
    it.each(["deny", "approve", "escalate"] as const)(
      "rejecting a %s-recommendation proposal refuses and leaves the leave request untouched",
      async (recommendation) => {
        mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(leaveProposal(recommendation));

        expect(await rejectProposal("AP-LEAVE", "I disagree")).toEqual({
          success: false,
          error: LEAVE_DECISION_VERB_REFUSAL,
        });
        expect(mocks.rejectLeaveRequest).not.toHaveBeenCalled();
        expect(mocks.approveLeaveRequest).not.toHaveBeenCalled();
        expect(mocks.prisma.agentActionProposal.update).not.toHaveBeenCalled();
      },
    );

    it("tells the person how the leave is decided", () => {
      expect(LEAVE_DECISION_VERB_REFUSAL).toMatch(/^Leave is decided with Approve leave \/ Deny leave/);
    });
  });

  it("approves proactivity changes by persisting a scoped preference override without executing a tool", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
      proposalId: "AP-PROACTIVE",
      status: "proposed",
      actionType: "propose_proactivity_change",
      parameters: proactivityParameters,
      agentId: "dispatcher",
      threadId: "thread-1",
    });

    const result = await approveProposal("AP-PROACTIVE");

    expect(result).toEqual({
      success: true,
      resultEntityId: "proactivity-override:activity-family:field-dispatch-appointment",
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.prisma.userFact.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        category: "preference",
        key: "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
        sourceRoute: "/storefront",
        sourceAgentId: "dispatcher",
        value: expect.any(String),
        confidence: 1,
        lastValidatedAt: new Date("2026-06-30T18:30:00.000Z"),
      },
    });
    const savedValue = JSON.parse(mocks.prisma.userFact.create.mock.calls[0][0].data.value);
    expect(savedValue).toMatchObject({
      scopeKey: "activity-family:field-dispatch-appointment",
      level: "assertive",
      previousLevel: "balanced",
      proposalId: "AP-PROACTIVE",
      acknowledgedByUserId: "user-1",
    });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledWith({
      where: { proposalId: "AP-PROACTIVE" },
      data: expect.objectContaining({
        status: "executed",
        resultEntityId: "proactivity-override:activity-family:field-dispatch-appointment",
      }),
    });
  });

  it("rejects proactivity changes by recording a cooldown marker", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
      proposalId: "AP-PROACTIVE",
      status: "proposed",
      actionType: "propose_proactivity_change",
      parameters: proactivityParameters,
      agentId: "dispatcher",
      threadId: "thread-1",
    });

    const result = await rejectProposal("AP-PROACTIVE", "Not now");

    expect(result).toEqual({ success: true });
    expect(mocks.prisma.userFact.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        category: "preference",
        key: "aiCoworkerProactivityCooldown:activity-family:field-dispatch-appointment",
        sourceRoute: "/storefront",
        sourceAgentId: "dispatcher",
        value: expect.any(String),
        confidence: 1,
      },
    });
    const savedValue = JSON.parse(mocks.prisma.userFact.create.mock.calls[0][0].data.value);
    expect(savedValue).toMatchObject({
      scopeKey: "activity-family:field-dispatch-appointment",
      proposedLevel: "assertive",
      dismissedByUserId: "user-1",
      dismissedAt: "2026-06-30T18:30:00.000Z",
      cooldownUntil: "2026-07-07T18:30:00.000Z",
    });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledWith({
      where: { proposalId: "AP-PROACTIVE" },
      data: expect.objectContaining({ status: "rejected", decidedById: "user-1" }),
    });
  });

  it("returns a narrow-boundary request to the coworker without routing the owner to a builder screen", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
      proposalId: "AP-PROACTIVE",
      status: "proposed",
      actionType: "propose_proactivity_change",
      parameters: proactivityParameters,
      agentId: "dispatcher",
      threadId: "thread-1",
    });

    await rejectProposal("AP-PROACTIVE", "Please narrow the operating boundary before asking again");

    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-1",
        role: "system",
        content: "Proactivity proposal declined: Please narrow the operating boundary before asking again.",
        agentId: "dispatcher",
      },
    });
  });
});
