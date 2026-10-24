import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findMany: vi.fn() },
    mcpServerTool: { findMany: vi.fn() },
    mcpServer: { findUnique: vi.fn(), update: vi.fn() },
    backlogItem: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true), requireCap: vi.fn() }));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: vi.fn() }));
vi.mock("./tak/mcp-server-tools", () => ({
  getDiscoveredToolCandidates: vi.fn(),
  parseNamespacedTool: vi.fn((name: string) => {
    const idx = name.indexOf("__");
    if (idx === -1) return null;
    return { serverSlug: name.slice(0, idx), toolName: name.slice(idx + 2) };
  }),
  executeMcpServerTool: vi.fn(),
}));

import { getAvailableTools, executeTool } from "./mcp-tools";
import { getDiscoveredToolCandidates, executeMcpServerTool } from "./tak/mcp-server-tools";

function candidate(name: string, grants: string[], effect: "read_only" | "side_effecting") {
  return {
    definition: {
      name, description: name, inputSchema: { type: "object" }, requiredCapability: null,
      requiresExternalAccess: true, sideEffect: effect !== "read_only", discoveredPolicyGrants: grants,
    },
    policy: {
      namespacedName: name, source: "bundled" as const, grants, effect,
      modes: effect === "read_only" ? (["advise", "act"] as const) : (["act"] as const),
      description: name, inputSchema: { type: "object" }, contentDigest: "sha256:x",
    },
  };
}

describe("getAvailableTools with discovered MCP tools", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("grant-gates discovered browser-driving tools even for a grantless context (EP-BROWSER-DRIVE Verdict 5)", async () => {
    vi.mocked(getDiscoveredToolCandidates).mockResolvedValue([
      candidate("mcp-browser-use__browse_act", ["browser_drive"], "side_effecting"),
      candidate("mcp-browser-use__browse_open", ["browser_read"], "read_only"),
    ] as never);

    const tools = await getAvailableTools(
      { platformRole: "admin", isSuperuser: true },
      { externalAccessEnabled: true },
    );
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("mcp-browser-use__browse_act");
    expect(names).not.toContain("mcp-browser-use__browse_open");
  });

  it("never asks for discovered tools when External Access is off", async () => {
    await getAvailableTools({ platformRole: "admin", isSuperuser: true }, { externalAccessEnabled: false });
    expect(getDiscoveredToolCandidates).not.toHaveBeenCalled();
  });
});

describe("executeTool with namespaced MCP server tools", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("routes a governed, authorized namespaced call to executeMcpServerTool with its digest", async () => {
    vi.mocked(executeMcpServerTool).mockResolvedValue({ success: true, message: "ok", data: { id: "pay_123" } });
    const result = await executeTool("stripe__create_payment", { amount: 1000 }, "user-1", {
      governedSource: "agentic-loop",
      discoveredToolAuthorization: { namespacedName: "stripe__create_payment", contentDigest: "sha256:abc" },
    });
    expect(executeMcpServerTool).toHaveBeenCalledWith("stripe", "create_payment", { amount: 1000 }, {
      kind: "governed-call", namespacedName: "stripe__create_payment", contentDigest: "sha256:abc",
    });
    expect(result.success).toBe(true);
  });

  it("refuses a direct namespaced call that carries no governed authorization", async () => {
    const result = await executeTool("stripe__create_payment", { amount: 1000 }, "user-1");
    expect(result.success).toBe(false);
    expect(executeMcpServerTool).not.toHaveBeenCalled();
  });

  it("refuses when the governed authorization names a different tool", async () => {
    const result = await executeTool("stripe__refund", {}, "user-1", {
      governedSource: "agentic-loop",
      discoveredToolAuthorization: { namespacedName: "stripe__create_payment", contentDigest: "sha256:abc" },
    });
    expect(result.success).toBe(false);
    expect(executeMcpServerTool).not.toHaveBeenCalled();
  });
});
