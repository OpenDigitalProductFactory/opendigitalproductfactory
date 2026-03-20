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
