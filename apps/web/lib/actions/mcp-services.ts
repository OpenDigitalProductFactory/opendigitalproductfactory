"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { checkMcpServerHealth } from "@/lib/mcp-server-health";
import { discoverMcpServerTools } from "@/lib/mcp-server-tools";
import { validateConnectionConfig, redactConfig, type McpConnectionConfig } from "@/lib/mcp-server-types";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

export async function activateMcpIntegration(
  integrationId: string,
  connectionConfig: McpConnectionConfig,
): Promise<{ ok: boolean; message: string; serverId?: string }> {
  const userId = await requireManageProviders();

  const integration = await prisma.mcpIntegration.findUnique({ where: { id: integrationId } });
  if (!integration || integration.status !== "active") {
    return { ok: false, message: "Integration not found or not active" };
  }

  const validation = validateConnectionConfig(connectionConfig);
  if (!validation.valid) {
    return { ok: false, message: validation.error };
  }

  const health = await checkMcpServerHealth(connectionConfig);
  if (!health.healthy) {
    return { ok: false, message: `Health check failed: ${health.error ?? "unknown error"}` };
  }

  const server = await prisma.mcpServer.create({
    data: {
      serverId: integration.slug,
      name: integration.name,
      config: connectionConfig as object,
      status: "active",
      transport: connectionConfig.transport,
      category: integration.category,
      tags: integration.tags,
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
      integrationId: integration.id,
      activatedBy: userId,
      activatedAt: new Date(),
    },
  });

  void discoverMcpServerTools(server.id).catch(() => {});

  return { ok: true, message: "Service activated", serverId: server.id };
}

export async function registerMcpServer(
  name: string,
  serverId: string,
  connectionConfig: McpConnectionConfig,
  category?: string,
): Promise<{ ok: boolean; message: string; id?: string }> {
  const userId = await requireManageProviders();

  const validation = validateConnectionConfig(connectionConfig);
  if (!validation.valid) {
    return { ok: false, message: validation.error };
  }

  const health = await checkMcpServerHealth(connectionConfig);
  if (!health.healthy) {
    return { ok: false, message: `Health check failed: ${health.error ?? "unknown error"}` };
  }

  const server = await prisma.mcpServer.create({
    data: {
      serverId,
      name,
      config: connectionConfig as object,
      status: "active",
      transport: connectionConfig.transport,
      category: category ?? null,
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
      activatedBy: userId,
      activatedAt: new Date(),
    },
  });

  void discoverMcpServerTools(server.id).catch(() => {});

  return { ok: true, message: "Service registered", id: server.id };
}

export async function deactivateMcpServer(
  serverId: string,
): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();

  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) return { ok: false, message: "Server not found" };

  await prisma.mcpServer.update({
    where: { id: serverId },
    data: { status: "deactivated", deactivatedAt: new Date() },
  });

  return { ok: true, message: "Service deactivated" };
}

export async function checkMcpServerHealthAction(
  serverId: string,
): Promise<{ ok: boolean; message: string; healthy?: boolean; latencyMs?: number }> {
  await requireManageProviders();

  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) return { ok: false, message: "Server not found" };

  const config = server.config as McpConnectionConfig;
  const result = await checkMcpServerHealth(config);

  await prisma.mcpServer.update({
    where: { id: serverId },
    data: {
      healthStatus: result.healthy ? "healthy" : "unreachable",
      lastHealthCheck: new Date(),
      lastHealthError: result.error ?? null,
    },
  });

  if (result.healthy) {
    void discoverMcpServerTools(serverId).catch(() => {});
  }

  return { ok: true, message: result.healthy ? "Healthy" : `Unhealthy: ${result.error}`, healthy: result.healthy, latencyMs: result.latencyMs };
}

export async function testMcpConnection(
  config: McpConnectionConfig,
): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  await requireManageProviders();
  const validation = validateConnectionConfig(config);
  if (!validation.valid) return { healthy: false, latencyMs: 0, error: validation.error };
  return checkMcpServerHealth(config);
}

export async function toggleMcpServerTool(
  toolId: string,
  isEnabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();
  await prisma.mcpServerTool.update({ where: { id: toolId }, data: { isEnabled } });
  return { ok: true, message: isEnabled ? "Tool enabled" : "Tool disabled" };
}

export async function queryMcpServers(options?: {
  status?: string;
  category?: string;
}) {
  return prisma.mcpServer.findMany({
    where: {
      ...(options?.status ? { status: options.status } : { status: { not: "deactivated" } }),
      ...(options?.category ? { category: options.category } : {}),
    },
    include: {
      _count: { select: { tools: true } },
      integration: { select: { id: true, name: true, logoUrl: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getMcpServerDetail(serverId: string) {
  const server = await prisma.mcpServer.findUnique({
    where: { id: serverId },
    include: {
      tools: { orderBy: { toolName: "asc" } },
      integration: { select: { id: true, name: true, logoUrl: true, documentationUrl: true } },
    },
  });
  if (!server) return null;

  const config = server.config as McpConnectionConfig;
  return { ...server, config: redactConfig(config) };
}
