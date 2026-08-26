import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimGovernedBacklogWorkspace: vi.fn(),
}));

vi.mock("./governed-work-claim", () => ({
  claimGovernedBacklogWorkspace: mocks.claimGovernedBacklogWorkspace,
}));

vi.mock("./capsule-workitem-anchor.server", () => ({
  ensureCapsuleWorkItemAnchorWithPrisma: vi.fn(),
}));

import { claimBacklogItemForWork } from "./claim-backlog-item-handler";
import type { CapsuleDb } from "./work-capsule-store-types";

describe("claimBacklogItemForWork MCP boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves governed recovery on an initiative_not_ready result", async () => {
    const recovery = {
      reviewerRoutes: [{
        accountableRole: "design-checklist-reviewer",
        toolName: "record_initiative_design_review",
        grant: "initiative_design_review",
        gate: "spec-approval",
        targetAgentId: "AGT-WS-REVIEW",
        targetDisplayName: "Work Surface Reviewer",
        independent: true,
        workroomId: "WC-7FF8A505",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        branchName: "fix/initiative-readiness-traversal-recovery",
        headSha: "d47536a552c7d588b2f963e478ae99369f720783",
        requestCoworker: {
          targetAgent: "AGT-WS-REVIEW",
          objective: "Review the exact governed artifact.",
          questionPacketSummary: "spec-approval for BI-F0715C9C at d47536a552c",
          requestKey: "initiative-readiness:BI-F0715C9C:spec-approval:d47536a552c7d588b2f963e478ae99369f720783",
          tier: 2,
          enteredVia: "handoff",
        },
      }],
      escalations: [],
    };
    mocks.claimGovernedBacklogWorkspace.mockResolvedValue({
      ok: false,
      error: "Cannot start implementation: SPEC_APPROVAL_REQUIRED.",
      data: {
        code: "initiative_not_ready",
        workIntent: "implementation",
        readiness: { verdict: "input-required" },
        recovery,
      },
    });

    const result = await claimBacklogItemForWork({
      params: {
        itemId: "BI-F0715C9C",
        worktreePath: "D:/DPF-worktrees/initiative-readiness-recovery",
        branchName: "fix/initiative-readiness-traversal-recovery",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        provider: "codex",
        sessionRef: "session-1",
        workIntent: "implementation",
      },
      userId: "user-1",
      context: { agentId: "AGT-AUTHOR" },
      db: {} as CapsuleDb,
      resolveActor: vi.fn().mockResolvedValue({ userId: "user-1", agentId: "AGT-AUTHOR", principalId: "PRN-1" }),
    });

    expect(result).toMatchObject({
      success: false,
      error: "initiative_not_ready",
      data: {
        workIntent: "implementation",
        readiness: { verdict: "input-required" },
        recovery,
      },
    });
  });
});
