import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  $executeRawUnsafe: vi.fn(),
  authorizationDecisionLog: { findUnique: vi.fn() },
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  backlogItem: { findFirst: vi.fn() },
};

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));
vi.mock("@/lib/work-capsules/scope-epoch-enrollment.server", () => ({
  assertScopeEpochEnrollmentReady: async () => ({ assertCurrent() {} }),
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "principal-agent" })),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

describe("Workroom pre-human routing boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a decision-shaped blocked status without a routing disposition", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("update_workroom_status", {
      capsuleId: "WC-STATUS",
      status: "blocked",
      reason: "Waiting for the operator to choose whether I should create the finishing task.",
    }, "user-1", { agentId: "codex" });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: "decision_routing_required",
    }));
    expect(mockPrisma.workroom.update).not.toHaveBeenCalled();
  });

  it("records a ledger-bound legitimate escalation on a decision-shaped blocker", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-STATUS",
      workspaceState: { note: "preserve me" },
    });
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-STATUS", status: "blocked" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("update_workroom_status", {
      capsuleId: "WC-STATUS",
      status: "blocked",
      reason: "WWMD returned low confidence; the operator must choose the finishing scope.",
      routingDisposition: "legitimate-escalation",
      decisionInteractionId: "DI-45E8FB6E767F",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceState: expect.objectContaining({
          statusOverride: expect.objectContaining({
            routingDisposition: "legitimate-escalation",
            decisionInteractionId: "DI-45E8FB6E767F",
          }),
        }),
      }),
    }));
  });

  it("keeps factual infrastructure blockers representable without a fake decision ledger", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-STATUS", workspaceState: {} });
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-STATUS", status: "blocked" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("update_workroom_status", {
      capsuleId: "WC-STATUS",
      status: "blocked",
      reason: "Provider credential is unavailable.",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
  });
});
