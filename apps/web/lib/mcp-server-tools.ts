// apps/web/lib/mcp-server-tools.ts
// MCP tool discovery, namespacing, and execution bridge.

import { prisma } from "@dpf/db";
import type { McpConnectionConfig } from "./mcp-server-types";

// ─── Namespacing ────────────────────────────────────────────────────────────

const NAMESPACE_SEP = "__";

export function namespaceTool(serverSlug: string, toolName: string): string {
  return `${serverSlug}${NAMESPACE_SEP}${toolName}`;
}

export function parseNamespacedTool(name: string): { serverSlug: string; toolName: string } | null {
  const idx = name.indexOf(NAMESPACE_SEP);
  if (idx === -1) return null;
  return { serverSlug: name.slice(0, idx), toolName: name.slice(idx + NAMESPACE_SEP.length) };
}

// ─── Types ──────────────────────────────────────────────────────────────────

// ToolDefinition shape matching mcp-tools.ts (import would create circular dep)
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: null;
  requiresExternalAccess?: boolean;
  sideEffect?: boolean;
};

type McpToolEntry = { name: string; description?: string; inputSchema?: Record<string, unknown> };

// ─── Tool Discovery ─────────────────────────────────────────────────────────

const MCP_TOOLS_LIST_REQUEST = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
};

async function fetchToolsList(config: McpConnectionConfig): Promise<McpToolEntry[]> {
  if (config.transport === "stdio") {
    throw new Error("Tool discovery for stdio requires process spawn — use activation flow");
  }

  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
    body: JSON.stringify(MCP_TOOLS_LIST_REQUEST),
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) throw new Error(`tools/list failed: HTTP ${res.status}`);
  const body = await res.json();
  return body?.result?.tools ?? [];
}

export async function discoverMcpServerTools(serverId: string): Promise<McpToolEntry[]> {
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error(`McpServer ${serverId} not found`);

  const config = server.config as McpConnectionConfig;
  const tools = await fetchToolsList(config);

  for (const tool of tools) {
    await prisma.mcpServerTool.upsert({
      where: { serverId_toolName: { serverId, toolName: tool.name } },
      create: {
        serverId,
        toolName: tool.name,
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? {}) as object,
      },
      update: {
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? {}) as object,
      },
    });
  }

  // Remove tools no longer reported (including when server reports zero)
  const discoveredNames = tools.map((t) => t.name);
  await prisma.mcpServerTool.deleteMany({
    where: {
      serverId,
      ...(discoveredNames.length > 0 ? { toolName: { notIn: discoveredNames } } : {}),
    },
  });

  return tools;
}

// ─── Get tools for agentic loop ─────────────────────────────────────────────

export async function getMcpServerTools(): Promise<ToolDefinition[]> {
  const tools = await prisma.mcpServerTool.findMany({
    where: {
      isEnabled: true,
      server: { status: "active", healthStatus: "healthy" },
    },
    include: { server: { select: { serverId: true, status: true, healthStatus: true } } },
  });

  return tools.map((t) => ({
    name: namespaceTool(t.server.serverId, t.toolName),
    description: t.description ?? `Tool from ${t.server.serverId}`,
    inputSchema: t.inputSchema as Record<string, unknown>,
    requiredCapability: null,
    requiresExternalAccess: true,
    sideEffect: true,
  }));
}

// ─── Execute a namespaced tool call ─────────────────────────────────────────

export async function executeMcpServerTool(
  serverSlug: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; message: string; data?: Record<string, unknown>; error?: string }> {
  const server = await prisma.mcpServer.findUnique({ where: { serverId: serverSlug } });
  if (!server || server.status !== "active") {
    return { success: false, error: "Server not found or inactive", message: `MCP server ${serverSlug} is not available` };
  }

  const tool = await prisma.mcpServerTool.findFirst({
    where: { serverId: server.id, toolName, isEnabled: true },
  });
  if (!tool) {
    return { success: false, error: "Tool not found or disabled", message: `Tool ${toolName} not available on ${serverSlug}` };
  }

  const config = server.config as McpConnectionConfig;

  // Lazy health check if stale (> 5 min)
  const STALE_MS = 5 * 60 * 1000;
  if (!server.lastHealthCheck || Date.now() - new Date(server.lastHealthCheck).getTime() > STALE_MS) {
    const { checkMcpServerHealth } = await import("./mcp-server-health");
    const health = await checkMcpServerHealth(config);
    await prisma.mcpServer.update({
      where: { id: server.id },
      data: {
        healthStatus: health.healthy ? "healthy" : "unreachable",
        lastHealthCheck: new Date(),
        lastHealthError: health.error ?? null,
      },
    });
    if (!health.healthy) {
      return { success: false, error: health.error ?? "Server unreachable", message: `Health check failed for ${serverSlug}` };
    }
  }

  try {
    if (config.transport === "stdio") {
      // SECURITY: Stdio MCP servers spawn as child processes of the current
      // container. In the portal (production) container, this means they inherit
      // production credentials, file access, and database connections.
      //
      // Servers with executionScope: "sandbox" MUST be routed through
      // docker exec into the sandbox container instead. This is not yet
      // implemented — block execution to prevent production bypass.
      //
      // Servers with executionScope: "external" (e.g., GitHub) are safe because
      // they only communicate with external APIs, but are also blocked until
      // the stdio execution adapter is implemented.
      const serverConfig = server.config as Record<string, unknown>;
      const scope = serverConfig.executionScope ?? "unknown";
      if (scope === "sandbox") {
        return {
          success: false,
          error: "Sandbox-scoped MCP servers cannot run in the portal container",
          message: `${serverSlug} is marked sandbox-only. Stdio execution inside the sandbox container is not yet implemented. Use the platform's built-in sandbox tools (read_sandbox_file, edit_sandbox_file, run_sandbox_command) instead.`,
        };
      }
      return { success: false, error: "stdio tool execution not yet supported", message: "stdio transport requires persistent process — follow-on" };
    }

    const res = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: params },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}`, message: `MCP server returned ${res.status}` };
    }

    const body = await res.json();
    if (body?.error) {
      return { success: false, error: body.error.message ?? "MCP error", message: body.error.message ?? "Tool call failed" };
    }

    return { success: true, message: "Tool call succeeded", data: body?.result ?? {} };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error", message: "Tool call failed" };
  }
}
