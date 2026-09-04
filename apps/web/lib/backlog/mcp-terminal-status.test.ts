import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTransition: vi.fn(),
  resolveRecovery: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { count: mocks.count }, epic: { findUnique: vi.fn() } } }));
vi.mock("@/lib/backlog/initiative-readiness/backlog-terminal-transition", () => ({
  completeBacklogItemTransition: mocks.completeTransition,
}));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({
  resolveTerminalInitiativeRecovery: mocks.resolveRecovery,
}));

import { completeBacklogItemTransitionTool } from "./mcp-terminal-status";

const decision = {
  subject: { kind: "backlog-item", id: "BI-ONE" },
  blockers: [],
  unmet: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED" }],
};

describe("backlog terminal MCP recovery projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches the server-issued recovery packet to a refusal", async () => {
    mocks.completeTransition.mockResolvedValue({ ok: false, code: "ACCEPTANCE_EVIDENCE_REQUIRED", decision });
    mocks.resolveRecovery.mockResolvedValue({ reviewerRoutes: [{ gate: "objective-mapping" }], escalations: [], unroutable: [] });

    const result = await completeBacklogItemTransitionTool({
      item: { status: "in-progress", epicId: null, organizationId: null },
      itemId: "BI-ONE",
      resolution: "done",
      completionEvidence: {},
      userId: "USR-ONE",
      agentId: "AGT-ONE",
    });

    expect(mocks.resolveRecovery).toHaveBeenCalledWith({
      decision,
      currentAgentId: "AGT-ONE",
      refusedWorkroomId: null,
    });
    expect(result).toMatchObject({
      success: false,
      error: "initiative_not_ready",
      data: { readiness: decision, recovery: { reviewerRoutes: [{ gate: "objective-mapping" }] } },
    });
  });

  it("does not resolve recovery for an allowed transition", async () => {
    mocks.completeTransition.mockResolvedValue({ ok: true, decision: { ...decision, unmet: [] } });
    const result = await completeBacklogItemTransitionTool({
      item: { status: "in-progress", epicId: null, organizationId: null },
      itemId: "BI-ONE",
      resolution: "done",
      completionEvidence: {},
      userId: "USR-ONE",
    });

    expect(result.success).toBe(true);
    expect(mocks.resolveRecovery).not.toHaveBeenCalled();
  });
});
