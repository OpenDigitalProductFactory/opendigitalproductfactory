// apps/web/lib/mcp-server-tools.ts
// MCP tool discovery, namespacing, and execution bridge.

import { prisma, type McpToolPolicyStatus, type Prisma } from "@dpf/db";
import type { McpConnectionConfig } from "./mcp-server-types";
import {
  computeMcpToolContentDigest,
  isBundledMcpTool,
  namespacedMcpToolName,
  resolveDiscoveredToolPolicy,
  DISCOVERED_TOOL_REASON_TEXT,
  type DiscoveredToolDenyReason,
  type DiscoveredToolPolicyRow,
  type ResolvedDiscoveredToolPolicy,
} from "./mcp-tool-policy";

// ─── Namespacing ────────────────────────────────────────────────────────────

const NAMESPACE_SEP = "__";

export function namespaceTool(serverSlug: string, toolName: string): string {
  return namespacedMcpToolName(serverSlug, toolName);
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
  consequence?: "outward";
  discoveredPolicyGrants?: readonly string[];
};

type McpToolEntry = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** Remote MCP annotations. Untrusted: stored as hints, never read as policy. */
  annotations?: Record<string, unknown>;
};

/** Columns the policy resolver needs, plus the server identity. */
const POLICY_ROW_SELECT = {
  toolName: true,
  description: true,
  inputSchema: true,
  isEnabled: true,
  policyStatus: true,
  policyEffect: true,
  policyExecutionModes: true,
  policyGrantKey: true,
  policyVersion: true,
  approvedToolIdentity: true,
  approvedContentDigest: true,
  approvedDescription: true,
  approvedInputSchema: true,
} as const;

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

/**
 * Discovery records what a server reports; it never decides authority
 * (BI-8B7B2FE9). New tools are created `quarantined` unless the release's
 * bundled policy covers their namespaced name. A rediscovery whose sanitized
 * description + inputSchema digest differs from the approved digest returns an
 * approved tool to `quarantined` and leaves the approved snapshot untouched, so
 * the model keeps seeing nothing new until an operator re-approves (the MCP
 * tool-poisoning "rug pull", absorbed from BI-49969E39). `denied` is sticky.
 */
export async function discoverMcpServerTools(serverId: string): Promise<McpToolEntry[]> {
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error(`McpServer ${serverId} not found`);

  const config = server.config as McpConnectionConfig;
  const tools = await fetchToolsList(config);

  const existing = await prisma.mcpServerTool.findMany({
    where: { serverId },
    select: { toolName: true, policyStatus: true, approvedContentDigest: true },
  });
  const existingByName = new Map(existing.map((row) => [row.toolName, row]));
  const now = new Date();

  for (const tool of tools) {
    const description = tool.description ?? null;
    const inputSchema = (tool.inputSchema ?? {}) as Record<string, unknown>;
    const digest = computeMcpToolContentDigest(description, inputSchema);
    const hints = tool.annotations && typeof tool.annotations === "object"
      ? (tool.annotations as Prisma.InputJsonValue)
      : undefined;
    const bundled = isBundledMcpTool(namespaceTool(server.serverId, tool.name));
    const prior = existingByName.get(tool.name);

    const update: Prisma.McpServerToolUpdateInput = {
      description,
      inputSchema: inputSchema as Prisma.InputJsonValue,
      discoveredContentDigest: digest,
      ...(hints ? { discoveryHints: hints } : {}),
    };
    if (prior && prior.policyStatus !== "denied") {
      const nextStatus = nextStatusOnRediscovery({
        bundled,
        status: prior.policyStatus,
        approvedDigest: prior.approvedContentDigest,
        digest,
      });
      if (nextStatus && nextStatus !== prior.policyStatus) {
        update.policyStatus = nextStatus;
        update.policyChangedAt = now;
      }
    }

    await prisma.mcpServerTool.upsert({
      where: { serverId_toolName: { serverId, toolName: tool.name } },
      create: {
        serverId,
        toolName: tool.name,
        description,
        inputSchema: inputSchema as Prisma.InputJsonValue,
        discoveredContentDigest: digest,
        ...(hints ? { discoveryHints: hints } : {}),
        policyStatus: bundled ? "approved" : "quarantined",
        policyChangedAt: now,
      },
      update,
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

/** Status a rediscovered (non-denied) tool moves to, or null to leave it. */
function nextStatusOnRediscovery(args: {
  bundled: boolean;
  status: McpToolPolicyStatus;
  approvedDigest: string | null;
  digest: string;
}): McpToolPolicyStatus | null {
  // Bundled text ships with the release and its policy is code-owned.
  if (args.bundled) return "approved";
  if (args.status !== "approved") return null;
  return args.approvedDigest === args.digest ? null : "quarantined";
}

// ─── Get tools for agentic loop ─────────────────────────────────────────────

export type DiscoveredToolCandidate = {
  definition: ToolDefinition;
  policy: ResolvedDiscoveredToolPolicy;
};

function toPolicyRow(row: Omit<DiscoveredToolPolicyRow, "server">, server: { serverId: string; status: string }): DiscoveredToolPolicyRow {
  return { ...row, server: { serverId: server.serverId, status: server.status } };
}

/** The model-visible definition of a tool whose DPF-owned policy resolved. */
export function discoveredToolDefinition(policy: ResolvedDiscoveredToolPolicy): ToolDefinition {
  const sideEffect = policy.effect !== "read_only";
  return {
    name: policy.namespacedName,
    description: policy.description || `Tool ${policy.namespacedName}`,
    inputSchema: policy.inputSchema,
    requiredCapability: null,
    requiresExternalAccess: true,
    sideEffect,
    // A side-effecting third-party call leaves the platform.
    ...(sideEffect ? { consequence: "outward" as const } : {}),
    discoveredPolicyGrants: policy.grants,
  };
}

/**
 * Discovered tools whose DPF-owned policy resolves (approved or bundled,
 * complete, current, content unchanged) on active, healthy servers. Everything
 * else — quarantined, denied, incomplete, renamed, changed — is absent. The
 * caller still intersects with the acting context (evaluateDiscoveredToolAccess).
 */
export async function getDiscoveredToolCandidates(): Promise<DiscoveredToolCandidate[]> {
  const rows = await prisma.mcpServerTool.findMany({
    where: {
      isEnabled: true,
      policyStatus: "approved",
      server: { status: "active", healthStatus: "healthy" },
    },
    select: { ...POLICY_ROW_SELECT, server: { select: { serverId: true, status: true } } },
  });
  const candidates: DiscoveredToolCandidate[] = [];
  for (const row of rows) {
    const resolved = resolveDiscoveredToolPolicy(toPolicyRow(row, row.server));
    if (resolved.resolved) candidates.push({ definition: discoveredToolDefinition(resolved.policy), policy: resolved.policy });
  }
  return candidates;
}

/** Back-compat listing helper: model-visible definitions only. */
export async function getMcpServerTools(): Promise<ToolDefinition[]> {
  return (await getDiscoveredToolCandidates()).map((c) => c.definition);
}

/**
 * Re-resolve one namespaced discovered tool from the database right now — the
 * governed executor calls this instead of trusting any earlier listing.
 */
export async function resolveDiscoveredToolForCall(
  namespacedName: string,
): Promise<{ resolved: true; policy: ResolvedDiscoveredToolPolicy; definition: ToolDefinition } | { resolved: false; reason: DiscoveredToolDenyReason | "unknown-tool" }> {
  const parsed = parseNamespacedTool(namespacedName);
  if (!parsed) return { resolved: false, reason: "unknown-tool" };
  const server = await prisma.mcpServer.findUnique({
    where: { serverId: parsed.serverSlug },
    select: { id: true, serverId: true, status: true },
  });
  if (!server) return { resolved: false, reason: "unknown-tool" };
  const row = await prisma.mcpServerTool.findFirst({
    where: { serverId: server.id, toolName: parsed.toolName },
    select: POLICY_ROW_SELECT,
  });
  if (!row) return { resolved: false, reason: "unknown-tool" };
  const resolved = resolveDiscoveredToolPolicy(toPolicyRow(row, server));
  if (!resolved.resolved) return { resolved: false, reason: resolved.reason };
  return { resolved: true, policy: resolved.policy, definition: discoveredToolDefinition(resolved.policy) };
}

// ─── Execute a namespaced tool call ─────────────────────────────────────────

/**
 * Who is asking for the remote call. There is no unauthenticated form:
 * - `governed-call`: the governed executor authorized this namespaced tool for
 *   an acting coworker against a specific approved content digest.
 * - `bundled-orchestrator`: a first-party orchestrator that is itself grant-
 *   gated (drive_browser_task → the browser-use sidecar) reaching a bundled tool.
 */
export type McpServerToolCallAuthority =
  | { kind: "governed-call"; namespacedName: string; contentDigest: string }
  | { kind: "bundled-orchestrator" };

type McpCallResult = { success: boolean; message: string; data?: Record<string, unknown>; error?: string };

function policyRefusal(serverSlug: string, toolName: string, reason: string): McpCallResult {
  const text = (DISCOVERED_TOOL_REASON_TEXT as Record<string, string>)[reason] ?? "Not authorized.";
  return {
    success: false,
    error: `discovered_tool_not_authorized:${reason}`,
    message: `Tool ${toolName} on ${serverSlug} is not authorized for coworkers. ${text}`,
  };
}

export async function executeMcpServerTool(
  serverSlug: string,
  toolName: string,
  params: Record<string, unknown>,
  authority: McpServerToolCallAuthority,
): Promise<McpCallResult> {
  const server = await prisma.mcpServer.findUnique({ where: { serverId: serverSlug } });
  if (!server || server.status !== "active") {
    return { success: false, error: "Server not found or inactive", message: `MCP server ${serverSlug} is not available` };
  }

  const tool = await prisma.mcpServerTool.findFirst({
    where: { serverId: server.id, toolName, isEnabled: true },
    select: POLICY_ROW_SELECT,
  });
  if (!tool) {
    return { success: false, error: "Tool not found or disabled", message: `Tool ${toolName} not available on ${serverSlug}` };
  }

  // Re-resolve the DPF-owned policy immediately before the remote call
  // (BI-8B7B2FE9). A listing, a proposal or an approval minted earlier is not
  // authority; the row as it stands now is.
  const resolved = resolveDiscoveredToolPolicy(toPolicyRow(tool, server));
  if (!resolved.resolved) return policyRefusal(serverSlug, toolName, resolved.reason);
  if (authority.kind === "bundled-orchestrator") {
    if (resolved.policy.source !== "bundled") return policyRefusal(serverSlug, toolName, "quarantined");
  } else if (
    authority.namespacedName !== resolved.policy.namespacedName
    || authority.contentDigest !== resolved.policy.contentDigest
  ) {
    return policyRefusal(serverSlug, toolName, "content-changed");
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
