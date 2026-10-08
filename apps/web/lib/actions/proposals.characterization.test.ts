// GPP Phase 2 PR-H characterization (BI-69415B68): approving a generic
// AgentActionProposal. This site stays a direct executeTool call in PR-H (see
// docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md,
// PR-H as built); these tests pin what it does today so the slice that routes
// it can prove non-disruption against the same assertions. The load-bearing
// fact: the handler receives the PROPOSING coworker's agentId and thread, and
// the only authority checked is the approving human's capability.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  persistProactivityFact: vi.fn(),
  prisma: {
    agentActionProposal: { findUnique: vi.fn(), update: vi.fn() },
    authorizationDecisionLog: { create: vi.fn() },
    agentMessage: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/mcp-tools", () => ({
  PLATFORM_TOOLS: [{ name: "contribute_to_hive", requiredCapability: "view_platform" }],
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/actions/leave", () => ({ approveLeaveRequest: vi.fn(), rejectLeaveRequest: vi.fn() }));

import { approveProposal, rejectProposal } from "./proposals";

const proposal = {
  proposalId: "AP-1",
  status: "proposed",
  actionType: "contribute_to_hive",
  parameters: { title: "Finding", body: "Details" },
  agentId: "AGT-COWORKER",
  threadId: "thread-9",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-admin", platformRole: "HR-000", isSuperuser: false } });
  mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(proposal);
  mocks.prisma.agentActionProposal.update.mockResolvedValue({});
  mocks.prisma.authorizationDecisionLog.create.mockResolvedValue({});
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.executeTool.mockResolvedValue({ success: true, entityId: "HIVE-1", message: "Contributed" });
});

describe("approveProposal (generic tool) — characterization", () => {
  it("runs the proposed tool as the approving human with the proposing coworker's agent and thread", async () => {
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: true, resultEntityId: "HIVE-1" });

    expect(mocks.executeTool).toHaveBeenCalledWith(
      "contribute_to_hive",
      { title: "Finding", body: "Details" },
      "user-admin",
      { agentId: "AGT-COWORKER", threadId: "thread-9" },
    );
    expect(mocks.prisma.agentActionProposal.update.mock.calls.map(([arg]) => arg.data.status)).toEqual(["approved", "executed"]);
    expect(mocks.prisma.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionKey: "contribute_to_hive", objectRef: "AP-1", actorRef: "user-admin", decision: "allow" }),
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadId: "thread-9", role: "system", agentId: "AGT-COWORKER" }),
    });
  });

  it("records a tool failure on the proposal and returns it", async () => {
    mocks.executeTool.mockResolvedValue({ success: false, error: "hive_unreachable", message: "No hive" });
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: false, error: "hive_unreachable" });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "failed", resultError: "hive_unreachable" },
    });
  });

  it("refuses a human without the tool's capability before anything runs", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-x", platformRole: null, isSuperuser: false } });
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: false, error: "Insufficient permissions" });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});

// Approval convergence A1 (BI-C8EC05C9): the remaining load-bearing facts of
// this direct site that convert-and-run (PR-C, spec D5) must reproduce.
describe("approveProposal / rejectProposal — convergence characterisation", () => {
  it("writes the decision log rationale and the exact system message", async () => {
    await approveProposal("AP-1");
    expect(mocks.prisma.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: {
        decisionId: expect.stringMatching(/^DEC-/),
        actionKey: "contribute_to_hive",
        objectRef: "AP-1",
        actorType: "user",
        actorRef: "user-admin",
        decision: "allow",
        rationale: { proposalId: "AP-1", parameters: { title: "Finding", body: "Details" }, result: "Contributed" },
      },
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-9", role: "system", content: "contribute_to_hive completed successfully. Contributed", agentId: "AGT-COWORKER" },
    });
  });

  it("reads then updates: approved is written before the run, with no compare-and-set", async () => {
    await approveProposal("AP-1");
    expect(mocks.prisma.agentActionProposal.update.mock.calls[0][0]).toEqual({
      where: { proposalId: "AP-1" },
      data: { status: "approved", decidedAt: expect.any(Date), decidedById: "user-admin" },
    });
    expect(mocks.prisma.agentActionProposal.update.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.executeTool.mock.invocationCallOrder[0]!);
  });

  it("an unregistered action type fails as Unknown tool and the row goes to failed (S4)", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({ ...proposal, actionType: "field_dispatch_customer_notification" });
    mocks.executeTool.mockResolvedValue({ success: false, error: "Unknown tool", message: "Tool not found" });
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: false, error: "Unknown tool" });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" }, data: { status: "failed", resultError: "Unknown tool" },
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: "field_dispatch_customer_notification failed: Unknown tool" }),
    });
  });

  it("refuses an already-decided proposal before anything runs", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({ ...proposal, status: "executed" });
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: false, error: "Proposal already decided" });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("leave.decide: generic approve and reject refuse and change nothing (BI-4E192035)", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({ ...proposal, actionType: "leave.decide" });
    const approved = await approveProposal("AP-1");
    const rejected = await rejectProposal("AP-1");
    expect(approved.success).toBe(false);
    expect(rejected.success).toBe(false);
    expect(approved.error).toBe(rejected.error);
    expect(approved.error).toMatch(/Approve leave|Deny leave/);
    expect(mocks.prisma.agentActionProposal.update).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("reject records rejected and a deny decision, and runs nothing", async () => {
    await expect(rejectProposal("AP-1", "Not now")).resolves.toEqual({ success: true });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledWith({
      where: { proposalId: "AP-1" }, data: { status: "rejected", decidedAt: expect.any(Date), decidedById: "user-admin" },
    });
    expect(mocks.prisma.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ decision: "deny", rationale: { proposalId: "AP-1", reason: "Not now" } }),
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/proactivity/proactivity-override-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proactivity/proactivity-override-preferences")>()),
  persistProactivityFact: mocks.persistProactivityFact,
}));

// Approval convergence A1 (BI-C8EC05C9): propose_proactivity_change has no
// creation site, and its decision handlers never execute a tool. They stay
// unchanged through the convergence, so any pending row stays decidable.
describe("propose_proactivity_change — convergence characterisation", () => {
  const proactivity = {
    ...proposal,
    actionType: "propose_proactivity_change",
    parameters: {
      kind: "proactivity-change", agentId: "dispatcher", activityFamily: "field-dispatch-appointment",
      currentLevel: "balanced", proposedLevel: "assertive", scope: "activity-family",
      rationale: "Warn earlier.", evidenceRefs: [{ kind: "dispatch-event", id: "late" }],
      spendImpact: "within existing authority", authorityImpact: "does not grant new tools",
    },
  };

  it("approve persists the override fact and records executed, without running a tool", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(proactivity);
    await expect(approveProposal("AP-1")).resolves.toEqual({
      success: true, resultEntityId: "proactivity-override:activity-family:field-dispatch-appointment",
    });
    expect(mocks.persistProactivityFact).toHaveBeenCalledWith("user-admin", expect.objectContaining({
      key: "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
    }));
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledWith({
      where: { proposalId: "AP-1" },
      data: expect.objectContaining({ status: "executed", decidedById: "user-admin", resultEntityId: "proactivity-override:activity-family:field-dispatch-appointment" }),
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("reject persists a 7-day cooldown fact and records rejected", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(proactivity);
    await expect(rejectProposal("AP-1")).resolves.toEqual({ success: true });
    const [, fact] = mocks.persistProactivityFact.mock.calls[0]!;
    const value = JSON.parse((fact as { value: string }).value) as { dismissedAt: string; cooldownUntil: string };
    expect(new Date(value.cooldownUntil).getTime() - new Date(value.dismissedAt).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledWith({
      where: { proposalId: "AP-1" }, data: expect.objectContaining({ status: "rejected", decidedById: "user-admin" }),
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});
