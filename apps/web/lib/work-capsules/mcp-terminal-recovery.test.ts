import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Denied extends Error {
    constructor(readonly result: { code: string; decision: unknown }) {
      super(result.code);
    }
  }
  class Refused extends Error {
    readonly code: string;
    readonly reason: string;
    constructor(input: { code: string; reason: string }) {
      super(input.reason);
      this.code = input.code;
      this.reason = input.reason;
    }
  }
  return { updateStatus: vi.fn(), resolveRecovery: vi.fn(), Denied, Refused };
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
  WorkCapsulePublicationRefusedError: mocks.Refused,
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

  // BI-023EF164: a claim-created room has no immutable head yet. The publication
  // boundary refuses ready-for-review; that refusal must reach the caller as a
  // structured answer with the repair step, not as "tool_threw".
  it("answers an incomplete source identity with the adopt_worktree repair step instead of throwing", async () => {
    mocks.updateStatus.mockRejectedValue(new mocks.Refused({
      code: "workroom_identity_incomplete",
      reason: "Workroom source identity is missing: headSha not set. Re-sync the Workroom with adopt_worktree (repositoryFullName, headBranch, worktreePath, baseSha, headSha), then retry.",
    }));

    const result = await updateWorkCapsuleStatusTool(
      { capsuleId: "WC-ONE", status: "ready-for-review", reason: "PR open." },
      "USR-ONE",
      { agentId: "AGT-ONE" },
    );

    expect(mocks.resolveRecovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: "workroom_identity_incomplete",
      message: expect.stringContaining("headSha not set"),
      data: {
        capsuleId: "WC-ONE",
        requestedStatus: "ready-for-review",
        nextAction: expect.stringContaining("adopt_worktree"),
      },
    });
  });

  it("answers a missing failure review with the reviewer step", async () => {
    mocks.updateStatus.mockRejectedValue(new mocks.Refused({
      code: "failure_review_required",
      reason: "No failure-analysis review exists for this final change.",
    }));

    const result = await updateWorkCapsuleStatusTool(
      { capsuleId: "WC-ONE", status: "ready-for-promotion", reason: "Reviewed." },
      "USR-ONE",
      { agentId: "AGT-ONE" },
    );

    expect(result).toMatchObject({
      success: false,
      error: "failure_review_required",
      data: { nextAction: expect.stringContaining("review_semantic_change") },
    });
  });

  it("still surfaces unknown failures as thrown errors", async () => {
    mocks.updateStatus.mockRejectedValue(new Error("database gone"));
    await expect(updateWorkCapsuleStatusTool(
      { capsuleId: "WC-ONE", status: "working", reason: "x" },
      "USR-ONE",
      { agentId: "AGT-ONE" },
    )).rejects.toThrow("database gone");
  });
});
