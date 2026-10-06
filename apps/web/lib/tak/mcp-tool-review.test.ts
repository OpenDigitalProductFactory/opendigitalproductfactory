import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  principalAlias: { findFirst: vi.fn() },
  mcpServerTool: { findUnique: vi.fn(), updateMany: vi.fn() },
  authorizationDecisionLog: { create: vi.fn() },
}));

vi.mock("@dpf/db", () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));

import { reviewMcpServerTool, McpToolReviewError } from "./mcp-tool-review";
import { computeMcpToolContentDigest, MCP_TOOL_POLICY_VERSION } from "./mcp-tool-policy";

const SCHEMA = { type: "object", properties: { q: { type: "string" } } };
const UPDATED_AT = new Date("2026-10-02T00:00:00Z");

function toolRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tool-1", toolName: "search", description: "Search Acme", inputSchema: SCHEMA,
    policyStatus: "quarantined", approvedContentDigest: null, updatedAt: UPDATED_AT,
    server: { serverId: "acme" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.principalAlias.findFirst.mockResolvedValue({ principal: { id: "PRN-1", kind: "human", status: "active" } });
  tx.mcpServerTool.findUnique.mockResolvedValue(toolRow());
  tx.mcpServerTool.updateMany.mockResolvedValue({ count: 1 });
  tx.authorizationDecisionLog.create.mockResolvedValue({});
});

describe("reviewMcpServerTool", () => {
  it("approval pins the reviewed text, grant, effect, identity and approver, and records the decision", async () => {
    const digest = computeMcpToolContentDigest("Search Acme", SCHEMA);
    const result = await reviewMcpServerTool("user-1", {
      toolId: "tool-1", decision: "approve", reviewedContentDigest: digest,
      grantKey: "registry_read", effect: "read_only", reason: "Read-only catalog search",
    });
    expect(result.status).toBe("approved");
    expect(tx.mcpServerTool.updateMany).toHaveBeenCalledWith({
      where: { id: "tool-1", updatedAt: UPDATED_AT },
      data: expect.objectContaining({
        policyStatus: "approved", policyEffect: "read_only", policyExecutionModes: ["advise", "act"],
        policyGrantKey: "registry_read", policyVersion: MCP_TOOL_POLICY_VERSION,
        approvedToolIdentity: "acme__search", approvedContentDigest: digest,
        approvedDescription: "Search Acme", approvedInputSchema: SCHEMA, approvedByPrincipalId: "PRN-1",
      }),
    });
    expect(tx.authorizationDecisionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionKey: "mcp-tool-policy-review", objectRef: "acme__search", decision: "allow", actorType: "human",
    }) });
  });

  it("a side-effecting approval may only act, never advise", async () => {
    await reviewMcpServerTool("user-1", {
      toolId: "tool-1", decision: "approve", reviewedContentDigest: computeMcpToolContentDigest("Search Acme", SCHEMA),
      grantKey: "backlog_write", effect: "side_effecting",
    });
    expect(tx.mcpServerTool.updateMany.mock.calls[0]![0].data.policyExecutionModes).toEqual(["act"]);
  });

  it("refuses approval when the tool text changed after the reviewer saw it", async () => {
    await expect(reviewMcpServerTool("user-1", {
      toolId: "tool-1", decision: "approve", reviewedContentDigest: computeMcpToolContentDigest("Old text", SCHEMA),
      grantKey: "registry_read", effect: "read_only",
    })).rejects.toBeInstanceOf(McpToolReviewError);
    expect(tx.mcpServerTool.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown grant and a bundled tool", async () => {
    const digest = computeMcpToolContentDigest("Search Acme", SCHEMA);
    await expect(reviewMcpServerTool("user-1", {
      toolId: "tool-1", decision: "approve", reviewedContentDigest: digest, grantKey: "root", effect: "read_only",
    })).rejects.toThrow(/permission/);
    tx.mcpServerTool.findUnique.mockResolvedValue(toolRow({ toolName: "browse_open", server: { serverId: "mcp-browser-use" } }));
    await expect(reviewMcpServerTool("user-1", {
      toolId: "tool-1", decision: "approve", reviewedContentDigest: digest, grantKey: "browser_read", effect: "read_only",
    })).rejects.toThrow(/ships with the platform/);
  });

  it("refuses a reviewer with no active human identity", async () => {
    tx.principalAlias.findFirst.mockResolvedValue({ principal: { id: "PRN-A", kind: "agent", status: "active" } });
    await expect(reviewMcpServerTool("user-1", { toolId: "tool-1", decision: "deny" })).rejects.toBeInstanceOf(McpToolReviewError);
  });

  it("deny and return-to-review take effect without touching the approved snapshot", async () => {
    await reviewMcpServerTool("user-1", { toolId: "tool-1", decision: "deny", reason: "Not needed" });
    expect(tx.mcpServerTool.updateMany.mock.calls[0]![0].data).toEqual({ policyStatus: "denied", policyChangedAt: expect.any(Date) });
    await reviewMcpServerTool("user-1", { toolId: "tool-1", decision: "return-to-review" });
    expect(tx.mcpServerTool.updateMany.mock.calls[1]![0].data.policyStatus).toBe("quarantined");
    expect(tx.authorizationDecisionLog.create.mock.calls[1]![0].data.decision).toBe("deny");
  });

  it("refuses when a concurrent rediscovery changed the row", async () => {
    tx.mcpServerTool.updateMany.mockResolvedValue({ count: 0 });
    await expect(reviewMcpServerTool("user-1", { toolId: "tool-1", decision: "deny" })).rejects.toBeInstanceOf(McpToolReviewError);
    expect(tx.authorizationDecisionLog.create).not.toHaveBeenCalled();
  });
});
