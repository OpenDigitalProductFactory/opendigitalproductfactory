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

import { approveProposal } from "./proposals";

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
