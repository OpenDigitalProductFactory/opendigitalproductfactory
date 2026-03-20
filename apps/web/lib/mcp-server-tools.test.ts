import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpServerTool: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    mcpServer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  discoverMcpServerTools,
  namespaceTool,
  parseNamespacedTool,
  getMcpServerTools,
} from "./mcp-server-tools";

describe("namespaceTool", () => {
  it("prefixes tool name with server slug", () => {
    expect(namespaceTool("stripe", "create_payment")).toBe("stripe__create_payment");
  });
});

describe("parseNamespacedTool", () => {
  it("splits namespaced tool into slug and name", () => {
    expect(parseNamespacedTool("stripe__create_payment")).toEqual({
      serverSlug: "stripe",
      toolName: "create_payment",
    });
  });

  it("returns null for non-namespaced tool", () => {
    expect(parseNamespacedTool("create_backlog_item")).toBeNull();
  });

  it("handles tool names with underscores after slug", () => {
    expect(parseNamespacedTool("my_server__my_tool_name")).toEqual({
      serverSlug: "my_server",
      toolName: "my_tool_name",
    });
  });
});

describe("getMcpServerTools", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns namespaced tool definitions from active healthy servers", async () => {
    vi.mocked(prisma.mcpServerTool.findMany).mockResolvedValue([
      {
        id: "t1", serverId: "s1", toolName: "create_payment",
        description: "Create a payment", inputSchema: { type: "object", properties: {} },
        isEnabled: true, discoveredAt: new Date(), updatedAt: new Date(),
        server: { serverId: "stripe", status: "active", healthStatus: "healthy" },
      },
    ] as never);

    const tools = await getMcpServerTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("stripe__create_payment");
    expect(tools[0].requiresExternalAccess).toBe(true);
    expect(tools[0].sideEffect).toBe(true);
  });
});

describe("discoverMcpServerTools", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("upserts discovered tools from MCP tools/list response", async () => {
    vi.mocked(prisma.mcpServer.findUnique).mockResolvedValue({
      id: "s1", serverId: "stripe", config: { transport: "http", url: "https://mcp.stripe.com" },
    } as never);
    vi.mocked(prisma.mcpServerTool.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.mcpServerTool.deleteMany).mockResolvedValue({ count: 0 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: {
          tools: [
            { name: "create_payment", description: "Create payment", inputSchema: { type: "object" } },
            { name: "get_balance", description: "Get balance", inputSchema: { type: "object" } },
          ],
        },
      }),
    } as Response));

    const result = await discoverMcpServerTools("s1");
    expect(result).toHaveLength(2);
    expect(prisma.mcpServerTool.upsert).toHaveBeenCalledTimes(2);
  });

  it("removes stale tools when server reports zero tools", async () => {
    vi.mocked(prisma.mcpServer.findUnique).mockResolvedValue({
      id: "s1", serverId: "stripe", config: { transport: "http", url: "https://mcp.stripe.com" },
    } as never);
    vi.mocked(prisma.mcpServerTool.deleteMany).mockResolvedValue({ count: 2 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { tools: [] } }),
    } as Response));

    const result = await discoverMcpServerTools("s1");
    expect(result).toHaveLength(0);
    expect(prisma.mcpServerTool.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ serverId: "s1" }) }),
    );
  });
});
