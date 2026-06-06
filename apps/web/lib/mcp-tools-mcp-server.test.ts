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
vi.mock("./mcp-server-tools", () => ({
  getMcpServerTools: vi.fn(),
  parseNamespacedTool: vi.fn((name: string) => {
    const idx = name.indexOf("__");
    if (idx === -1) return null;
    return { serverSlug: name.slice(0, idx), toolName: name.slice(idx + 2) };
  }),
  executeMcpServerTool: vi.fn(),
}));

import { getAvailableTools, executeTool } from "./mcp-tools";
import { getMcpServerTools, executeMcpServerTool } from "./mcp-server-tools";

describe("getAvailableTools with MCP server tools", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("includes MCP server tools alongside platform tools when external access enabled", async () => {
    vi.mocked(getMcpServerTools).mockResolvedValue([
      {
        name: "stripe__create_payment",
        description: "Create a payment",
        inputSchema: { type: "object" },
        requiredCapability: null,
        requiresExternalAccess: true,
        sideEffect: true,
      },
    ]);

    const tools = await getAvailableTools(
      { platformRole: "admin", isSuperuser: true },
      { externalAccessEnabled: true },
    );

    const mcpTool = tools.find((t) => t.name === "stripe__create_payment");
    expect(mcpTool).toBeDefined();
  });

  it("grant-gates discovered browser-driving tools but not unmapped MCP tools (EP-BROWSER-DRIVE Verdict 5)", async () => {
    // browse_act + browse_open carry TOOL_TO_GRANTS entries; stripe__create_payment
    // does not. With no agent grants (grantless context) the mapped browser tools
    // must be filtered out even though External Access is on — the gap Verdict 5
    // closes — while the unmapped tool still passes through unchanged.
    vi.mocked(getMcpServerTools).mockResolvedValue([
      { name: "mcp-browser-use__browse_act", description: "drive", inputSchema: { type: "object" }, requiredCapability: null, requiresExternalAccess: true, sideEffect: true },
      { name: "mcp-browser-use__browse_open", description: "open", inputSchema: { type: "object" }, requiredCapability: null, requiresExternalAccess: true, sideEffect: true },
      { name: "stripe__create_payment", description: "pay", inputSchema: { type: "object" }, requiredCapability: null, requiresExternalAccess: true, sideEffect: true },
    ]);

    const tools = await getAvailableTools(
      { platformRole: "admin", isSuperuser: true },
      { externalAccessEnabled: true },
    );
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("mcp-browser-use__browse_act");
    expect(names).not.toContain("mcp-browser-use__browse_open");
    expect(names).toContain("stripe__create_payment");
  });
});

describe("executeTool with namespaced MCP server tools", () => {
  it("routes namespaced tools to executeMcpServerTool", async () => {
    vi.mocked(executeMcpServerTool).mockResolvedValue({
      success: true,
      message: "Payment created",
      data: { id: "pay_123" },
    });

    const result = await executeTool("stripe__create_payment", { amount: 1000 }, "user-1");
    expect(executeMcpServerTool).toHaveBeenCalledWith("stripe", "create_payment", { amount: 1000 });
    expect(result.success).toBe(true);
  });
});
