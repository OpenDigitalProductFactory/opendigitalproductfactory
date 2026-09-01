import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Denied extends Error {
    constructor(readonly result: { code: string; decision: unknown }) {
      super(result.code);
    }
  }
  return { updateStatus: vi.fn(), resolveRecovery: vi.fn(), Denied };
});

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn().mockResolvedValue({ id: "PRN-AGENT" }),
  syncUserPrincipal: vi.fn().mockResolvedValue({ id: "PRN-USER" }),
}));
vi.mock("./work-capsule-store", () => ({
  updateWorkCapsuleStatus: mocks.updateStatus,
  heartbeatWorkCapsule: vi.fn(),
  WorkCapsuleCompletionDeniedError: mocks.Denied,
  ScopeOverlapError: class ScopeOverlapError extends Error {},
  adoptWorktreeCapsule: vi.fn(),
  claimWorkCapsuleScope: vi.fn(),
  createWorkCapsule: vi.fn(),
  reassignWorkCapsuleExecutor: vi.fn(),
  planCapsuleWorkspace: vi.fn(),
  releaseWorkCapsuleScope: vi.fn(),
  recordWorkCapsuleEvidence: vi.fn(),
  recordAgentActivity: vi.fn(),
}));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({
  resolveTerminalInitiativeRecovery: mocks.resolveRecovery,
}));

import { updateWorkCapsuleStatusTool } from "./mcp-handlers";

const decision = {
  subject: { kind: "backlog-item", id: "BI-ONE" },
  blockers: [],
  unmet: [{ code: "OBJECTIVE_RECONCILIATION_REQUIRED" }],
};

describe("workroom terminal MCP recovery projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches the same recovery shape using the exact refused Workroom", async () => {
    mocks.updateStatus.mockRejectedValue(new mocks.Denied({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", decision }));
    mocks.resolveRecovery.mockResolvedValue({ reviewerRoutes: [{ gate: "objective-mapping" }], escalations: [], unroutable: [] });

    const result = await updateWorkCapsuleStatusTool(
      { capsuleId: "WC-ONE", status: "complete", reason: "Delivered and verified." },
      "USR-ONE",
      { agentId: "AGT-ONE" },
    );

    expect(mocks.resolveRecovery).toHaveBeenCalledWith({
      decision,
      currentAgentId: "AGT-ONE",
      refusedWorkroomId: "WC-ONE",
    });
    expect(result).toMatchObject({
      success: false,
      error: "initiative_not_ready",
      data: { readiness: decision, recovery: { reviewerRoutes: [{ gate: "objective-mapping" }] } },
    });
  });
});
