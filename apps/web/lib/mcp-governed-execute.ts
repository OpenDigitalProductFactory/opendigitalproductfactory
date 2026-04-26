// Single governed entry point for tool execution.
//
// All MCP-style callers (REST /api/mcp/call, the future JSON-RPC route, and
// the in-platform agentic loop) should funnel through here so that the three
// governance layers — user capability, agent grants, audit — are enforced in
// one place. Today only agentic-loop writes ToolExecution rows; this wrapper
// closes the audit gap on the REST and JSON-RPC paths and gives the future
// external-MCP transport a stable hook.

import { prisma } from "@dpf/db";
import { can, type CapabilityKey, type UserContext } from "./permissions";
import {
  PLATFORM_TOOLS,
  executeTool,
  type ToolDefinition,
  type ToolResult,
} from "./mcp-tools";
import { deriveAuditClassForTool, deriveCapabilityId } from "./tool-audit-helpers";

export type GovernedExecuteSource =
  | "rest"
  | "jsonrpc"
  | "external-jsonrpc"
  | "agentic-loop";

export type GovernedExecuteContext = {
  agentId?: string;
  threadId?: string;
  routeContext?: string;
  taskRunId?: string;
  apiTokenId?: string;
};

export type GovernedExecuteArgs = {
  toolName: string;
  rawParams: Record<string, unknown>;
  userId: string;
  userContext: UserContext;
  context?: GovernedExecuteContext;
  source: GovernedExecuteSource;
};

export type GovernedExecuteRejection =
  | "unknown_tool"
  | "forbidden_capability"
  | "forbidden_grant";

export type GovernedExecuteResult = ToolResult & {
  governance?: {
    rejected?: GovernedExecuteRejection;
    durationMs?: number;
  };
};

// Test seam — production uses the imported real grant resolver. Tests can
// override these without mocking the import system.
export type GrantResolver = (agentId: string) => Promise<string[]>;
export type GrantPredicate = (toolName: string, grants: string[]) => boolean;

let _resolveAgentGrants: GrantResolver | null = null;
let _isAllowedByGrants: GrantPredicate | null = null;

export function _setGovernanceForTests(overrides: {
  resolveAgentGrants?: GrantResolver | null;
  isAllowedByGrants?: GrantPredicate | null;
  executeTool?: ((
    toolName: string,
    params: Record<string, unknown>,
    userId: string,
    ctx?: { agentId?: string; threadId?: string; routeContext?: string; taskRunId?: string },
  ) => Promise<ToolResult>) | null;
  toolExecutionCreate?: ((data: Record<string, unknown>) => Promise<unknown>) | null;
}): void {
  _resolveAgentGrants = overrides.resolveAgentGrants ?? null;
  _isAllowedByGrants = overrides.isAllowedByGrants ?? null;
  _executeToolOverride = overrides.executeTool ?? null;
  _toolExecutionCreateOverride = overrides.toolExecutionCreate ?? null;
}

let _executeToolOverride:
  | ((
      toolName: string,
      params: Record<string, unknown>,
      userId: string,
      ctx?: {
        agentId?: string;
        threadId?: string;
        routeContext?: string;
        taskRunId?: string;
      },
    ) => Promise<ToolResult>)
  | null = null;

let _toolExecutionCreateOverride:
  | ((data: Record<string, unknown>) => Promise<unknown>)
  | null = null;

async function resolveGrants(agentId: string): Promise<string[]> {
  if (_resolveAgentGrants) return _resolveAgentGrants(agentId);
  const { getAgentToolGrantsAsync } = await import("./tak/agent-grants");
  return getAgentToolGrantsAsync(agentId);
}

async function isAllowedByGrants(toolName: string, grants: string[]): Promise<boolean> {
  if (_isAllowedByGrants) return _isAllowedByGrants(toolName, grants);
  const { isToolAllowedByGrants } = await import("./tak/agent-grants");
  return isToolAllowedByGrants(toolName, grants);
}

async function callExecuteTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  ctx?: {
    agentId?: string;
    threadId?: string;
    routeContext?: string;
    taskRunId?: string;
  },
): Promise<ToolResult> {
  if (_executeToolOverride) return _executeToolOverride(toolName, params, userId, ctx);
  return executeTool(toolName, params, userId, ctx);
}

async function writeAudit(data: {
  toolName: string;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  userId: string;
  source: GovernedExecuteSource;
  context?: GovernedExecuteContext;
  durationMs: number;
}): Promise<void> {
  const auditClass = deriveAuditClassForTool(data.toolName);
  const capabilityId = deriveCapabilityId(data.toolName);
  const isMetricsOnly = auditClass === "metrics_only";
  const row = {
    threadId: data.context?.threadId ?? "",
    agentId: data.context?.agentId ?? "unknown",
    userId: data.userId,
    taskRunId: data.context?.taskRunId ?? null,
    toolName: data.toolName,
    parameters: isMetricsOnly ? {} : (data.rawParams as object),
    result: isMetricsOnly ? {} : (data.result as unknown as object),
    success: data.result.success,
    executionMode: data.source,
    routeContext: data.context?.routeContext ?? null,
    durationMs: data.durationMs,
    auditClass,
    capabilityId,
    summary: isMetricsOnly
      ? `${data.toolName}: ${data.result.success ? "ok" : "failed"}` +
        (data.durationMs ? ` (${data.durationMs}ms)` : "")
      : null,
    apiTokenId: data.context?.apiTokenId ?? null,
  };
  try {
    if (_toolExecutionCreateOverride) {
      await _toolExecutionCreateOverride(row);
    } else {
      await prisma.toolExecution.create({ data: row });
    }
  } catch (err) {
    // Audit MUST NOT silently fail. Log with enough context to investigate
    // without throwing back to the caller (which would mask successful tool
    // execution).
    console.error(
      `[governed-execute] audit write failed tool=${data.toolName} source=${data.source}:`,
      err,
    );
  }
}

function findTool(toolName: string): ToolDefinition | undefined {
  return PLATFORM_TOOLS.find((t) => t.name === toolName);
}

function rejectionResult(
  toolName: string,
  rejection: GovernedExecuteRejection,
  detail: string,
): GovernedExecuteResult {
  const message = `${toolName} rejected: ${detail}`;
  return {
    success: false,
    error: rejection,
    message,
    governance: { rejected: rejection },
  };
}

export async function governedExecuteTool(
  args: GovernedExecuteArgs,
): Promise<GovernedExecuteResult> {
  const tool = findTool(args.toolName);
  if (!tool) {
    return {
      success: false,
      error: "unknown_tool",
      message: `Unknown tool: ${args.toolName}`,
      governance: { rejected: "unknown_tool" },
    };
  }

  // Capability check — user must have the platform role required by the tool.
  if (tool.requiredCapability) {
    const allowed = can(args.userContext, tool.requiredCapability as CapabilityKey);
    if (!allowed) {
      const result = rejectionResult(
        args.toolName,
        "forbidden_capability",
        `user lacks capability ${tool.requiredCapability}`,
      );
      await writeAudit({
        toolName: args.toolName,
        rawParams: args.rawParams,
        result,
        userId: args.userId,
        source: args.source,
        context: args.context,
        durationMs: 0,
      });
      return result;
    }
  }

  // Agent grant check — when an agentId is in the context, the agent must
  // have a grant that authorises this tool.
  if (args.context?.agentId) {
    const grants = await resolveGrants(args.context.agentId);
    const allowed = await isAllowedByGrants(args.toolName, grants);
    if (!allowed) {
      const result = rejectionResult(
        args.toolName,
        "forbidden_grant",
        `agent ${args.context.agentId} lacks a required grant for ${args.toolName}`,
      );
      await writeAudit({
        toolName: args.toolName,
        rawParams: args.rawParams,
        result,
        userId: args.userId,
        source: args.source,
        context: args.context,
        durationMs: 0,
      });
      return result;
    }
  }

  const t0 = Date.now();
  let result: ToolResult;
  try {
    result = await callExecuteTool(args.toolName, args.rawParams, args.userId, {
      agentId: args.context?.agentId,
      threadId: args.context?.threadId,
      routeContext: args.context?.routeContext,
      taskRunId: args.context?.taskRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown tool error";
    result = {
      success: false,
      error: "tool_threw",
      message: `${args.toolName} threw: ${message}`,
    };
  }
  const durationMs = Date.now() - t0;

  await writeAudit({
    toolName: args.toolName,
    rawParams: args.rawParams,
    result,
    userId: args.userId,
    source: args.source,
    context: args.context,
    durationMs,
  });

  return { ...result, governance: { durationMs } };
}
