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

  // BI-DEDAC950: the refusal names the page behind each unmet code, beside the
  // decision (never inside it), and the message carries one wiki_query line.
  it("cites the governing principle of each unmet code beside the decision", async () => {
    mocks.completeTransition.mockResolvedValue({ ok: false, code: "ACCEPTANCE_EVIDENCE_REQUIRED", decision });
    mocks.resolveRecovery.mockResolvedValue({ reviewerRoutes: [], escalations: [], unroutable: [] });

    const result = await completeBacklogItemTransitionTool({
      item: { status: "in-progress", epicId: null, organizationId: null },
      itemId: "BI-ONE",
      resolution: "done",
      completionEvidence: {},
      userId: "USR-ONE",
    });

    expect(result.data).toMatchObject({
      readiness: decision,
      governingPrinciples: { ACCEPTANCE_EVIDENCE_REQUIRED: "gates-proportional-to-shape" },
    });
    expect(result.data?.readiness).not.toHaveProperty("governingPrinciples");
    expect(result.message).toBe(
      "Cannot complete BI-ONE: ACCEPTANCE_EVIDENCE_REQUIRED. "
      + "Governing rules: ACCEPTANCE_EVIDENCE_REQUIRED → gates-proportional-to-shape (look up with wiki_query).",
    );
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
