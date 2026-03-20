import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findUnique: vi.fn() },
    mcpServer: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    mcpServerTool: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({
    user: { id: "user-1", platformRole: "admin", isSuperuser: true },
  })),
}));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));
vi.mock("@/lib/mcp-server-health", () => ({
  checkMcpServerHealth: vi.fn(),
}));
vi.mock("@/lib/mcp-server-tools", () => ({
  discoverMcpServerTools: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { checkMcpServerHealth } from "@/lib/mcp-server-health";
import { discoverMcpServerTools } from "@/lib/mcp-server-tools";
import {
  activateMcpIntegration,
  deactivateMcpServer,
  queryMcpServers,
  testMcpConnection,
} from "./mcp-services";

describe("activateMcpIntegration", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates McpServer when health check passes", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue({
      id: "int-1", slug: "stripe", name: "Stripe", status: "active",
      category: "finance", tags: ["payments"],
    } as never);
    vi.mocked(checkMcpServerHealth).mockResolvedValue({ healthy: true, latencyMs: 42 });
    vi.mocked(prisma.mcpServer.create).mockResolvedValue({ id: "srv-1" } as never);
    vi.mocked(discoverMcpServerTools).mockResolvedValue([]);

    const result = await activateMcpIntegration("int-1", { transport: "http", url: "https://mcp.stripe.com" });
    expect(result.ok).toBe(true);
    expect(prisma.mcpServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serverId: "stripe",
          status: "active",
          healthStatus: "healthy",
        }),
      }),
    );
  });

  it("rejects when health check fails", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue({
      id: "int-1", slug: "stripe", name: "Stripe", status: "active",
      category: "finance", tags: ["payments"],
    } as never);
    vi.mocked(checkMcpServerHealth).mockResolvedValue({ healthy: false, latencyMs: 0, error: "Connection refused" });

    const result = await activateMcpIntegration("int-1", { transport: "http", url: "https://mcp.stripe.com" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection refused");
    expect(prisma.mcpServer.create).not.toHaveBeenCalled();
  });

  it("rejects when integration not found", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue(null);
    const result = await activateMcpIntegration("nonexistent", { transport: "http", url: "https://example.com" });
    expect(result.ok).toBe(false);
  });
});

describe("deactivateMcpServer", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets status to deactivated", async () => {
    vi.mocked(prisma.mcpServer.findUnique).mockResolvedValue({ id: "srv-1", status: "active" } as never);
    vi.mocked(prisma.mcpServer.update).mockResolvedValue({} as never);

    const result = await deactivateMcpServer("srv-1");
    expect(result.ok).toBe(true);
    expect(prisma.mcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "deactivated" }),
      }),
    );
  });
});

describe("testMcpConnection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs health check without creating DB row", async () => {
    vi.mocked(checkMcpServerHealth).mockResolvedValue({ healthy: true, latencyMs: 50 });
    const result = await testMcpConnection({ transport: "http", url: "https://mcp.example.com" });
    expect(result.healthy).toBe(true);
    expect(prisma.mcpServer.create).not.toHaveBeenCalled();
  });
});

describe("queryMcpServers", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns servers with tool counts", async () => {
    vi.mocked(prisma.mcpServer.findMany).mockResolvedValue([
      { id: "srv-1", serverId: "stripe", name: "Stripe", status: "active", healthStatus: "healthy" },
    ] as never);

    const servers = await queryMcpServers();
    expect(servers).toHaveLength(1);
  });
});
