import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-C5794F1D: a work-sync mirror is owned by its origin installation; a
// status written here would be reverted by the next pull without a trace, so
// the MCP status tools refuse it and name the owner. Kept out of
// backlog-pack.dispatch.test.ts, which is at its module-size baseline.

const { mockPrisma, terminalBacklog } = vi.hoisted(() => ({
  terminalBacklog: vi.fn(),
  mockPrisma: {
    backlogItem: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    backlogItemActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma, attributeBacklogPortfolio: vi.fn() }));
vi.mock("@/lib/backlog/initiative-readiness/backlog-terminal-transition", () => ({ completeBacklogItemTransition: terminalBacklog }));
vi.mock("@/lib/queue/bridges/backlog-bridge", () => ({ bridgeBacklogItemToWorkItem: vi.fn().mockResolvedValue(null) }));

import { executeTool } from "@/lib/mcp-tools";

const origin = `inst_${"c".repeat(32)}`;
const mirror = {
  id: "mirror-row", itemId: "BI-PEER01", status: "awaiting-acceptance", epicId: null, triageOutcome: "build",
  effortSize: "small", activeBuildId: null, claimStatus: null, claimedById: null, claimedByAgentId: null,
  claimedAt: null, deferredAt: null, organizationId: null,
  body: `Peer item\n\n[origin:federatedWork:${origin}:BI-PEER01]`,
};

describe("MCP status writes on a peer-owned work-sync mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma));
  });

  it.each([
    ["done", { resolution: "Shipped." }],
    ["open", {}],
  ] as const)("refuses update_backlog_item_status -> %s and names the owning installation", async (status, extra) => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue(mirror);
    const result = await executeTool("update_backlog_item_status", { itemId: "BI-PEER01", status, ...extra }, "user-1", { agentId: "AGT-1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("peer_owned_item");
    expect(result.message).toContain(`owned by installation ${origin}`);
    expect(result.message).toContain("overwritten by work sync");
    expect(terminalBacklog).not.toHaveBeenCalled();
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  it("refuses a status change through update_backlog_item", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ ...mirror, status: "open" });
    const result = await executeTool("update_backlog_item", { itemId: "BI-PEER01", status: "in-progress" }, "user-1", { agentId: "AGT-1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("peer_owned_item");
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  it("refuses retire_backlog_item", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue(mirror);
    const result = await executeTool("retire_backlog_item", { itemId: "BI-PEER01", outcome: "discard", rationale: "Not ours", reason: "x" }, "user-1", { agentId: "AGT-1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("peer_owned_item");
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  it("still lets a locally owned item change status", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ ...mirror, body: "Ours" });
    mockPrisma.backlogItem.update.mockResolvedValue({ itemId: "BI-PEER01", status: "open", epicId: null, completedAt: null });
    const result = await executeTool("update_backlog_item_status", { itemId: "BI-PEER01", status: "open" }, "user-1", { agentId: "AGT-1" });
    expect(result.success).toBe(true);
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "open" }) }));
  });
});
