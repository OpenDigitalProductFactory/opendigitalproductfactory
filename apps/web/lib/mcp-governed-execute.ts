// Single governed entry point for tool execution.
//
// All MCP-style callers (REST /api/mcp/call, the future JSON-RPC route, and
// the in-platform agentic loop) should funnel through here so that the three
// governance layers — user capability, agent grants, audit — are enforced in
// one place. Today only agentic-loop writes ToolExecution rows; this wrapper
// closes the audit gap on the REST and JSON-RPC paths and gives the future
// external-MCP transport a stable hook.

import { prisma } from "@dpf/db";
import { createHash, createHmac } from "crypto";
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
  | "internal-mcp-session"
  | "agentic-loop";

export type GovernedExecuteContext = {
  agentId?: string;
  threadId?: string;
  routeContext?: string;
  taskRunId?: string;
  apiTokenId?: string;
  /**
   * Governed Hermes learning Slice 1: active coworker skill for this call.
   * Set by runAgenticLoop when the parent run is attributed to a specific
   * skill invocation. Persisted to ToolExecution.skillId so reflection and
   * skill metrics can attribute action evidence to the originating skill.
   */
  skillId?: string;
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
  | "forbidden_grant"
  | "hook_denied";

export type GovernedExecuteResult = ToolResult & {
  governance?: {
    rejected?: GovernedExecuteRejection;
    durationMs?: number;
  };
};

type ToolLifecycleEvent = {
  toolName: string;
  rawParams: Record<string, unknown>;
  userId: string;
  userContext: UserContext;
  context?: GovernedExecuteContext;
  source: GovernedExecuteSource;
};

type ToolLifecyclePostEvent = ToolLifecycleEvent & {
  result: ToolResult;
  durationMs: number;
};

type ToolLifecycleDecision =
  | { decision: "allow"; reason?: string }
  | { decision: "deny"; reason: string };

export type ToolLifecycleHook = {
  id: string;
  onPreToolUse?: (event: ToolLifecycleEvent) => Promise<ToolLifecycleDecision | void> | ToolLifecycleDecision | void;
  onPostToolUse?: (event: ToolLifecyclePostEvent) => Promise<void> | void;
};

export function registerToolLifecycleHook(hook: ToolLifecycleHook): () => void {
  _lifecycleHooks = [..._lifecycleHooks.filter((existing) => existing.id !== hook.id), hook];
  return () => {
    _lifecycleHooks = _lifecycleHooks.filter((existing) => existing.id !== hook.id);
  };
}

// Test seam — production uses the imported real grant resolver. Tests can
// override these without mocking the import system.
export type GrantResolver = (agentId: string) => Promise<string[]>;
export type GrantPredicate = (toolName: string, grants: string[]) => boolean;

let _resolveAgentGrants: GrantResolver | null = null;
let _isAllowedByGrants: GrantPredicate | null = null;
let _lifecycleHooks: ToolLifecycleHook[] = [];

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
  toolExecutionReceiptCreate?: ((data: Record<string, unknown>) => Promise<unknown>) | null;
  lifecycleHooks?: ToolLifecycleHook[] | null;
}): void {
  _resolveAgentGrants = overrides.resolveAgentGrants ?? null;
  _isAllowedByGrants = overrides.isAllowedByGrants ?? null;
  _executeToolOverride = overrides.executeTool ?? null;
  _toolExecutionCreateOverride = overrides.toolExecutionCreate ?? null;
  _toolExecutionReceiptCreateOverride = overrides.toolExecutionReceiptCreate ?? null;
  _lifecycleHooks = overrides.lifecycleHooks ?? [];
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

let _toolExecutionReceiptCreateOverride:
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
}): Promise<{ id: string } | null> {
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
    skillId: data.context?.skillId ?? null,
  };
  try {
    if (_toolExecutionCreateOverride) {
      const created = await _toolExecutionCreateOverride(row);
      return typeof (created as { id?: unknown } | undefined)?.id === "string"
        ? { id: String((created as { id: string }).id) }
        : null;
    } else {
      return await prisma.toolExecution.create({
        data: row,
        select: { id: true },
      });
    }
  } catch (err) {
    // Audit MUST NOT silently fail. Log with enough context to investigate
    // without throwing back to the caller (which would mask successful tool
    // execution).
    // CodeQL #49 (js/tainted-format-string): tool/source names are user-influenced.
    console.error(
      "[governed-execute] audit write failed tool=%s source=%s:",
      data.toolName,
      data.source,
      err,
    );
    return null;
  }
}

function deriveReceiptKind(toolName: string): string | null {
  switch (toolName) {
    case "run_sandbox_tests":
      return "sandbox-test-run";
    case "run_sandbox_command":
      return "sandbox-command";
    case "run_ux_test":
      return "ux-run";
    default:
      return null;
  }
}

// CodeQL #63 (js/insufficient-password-hash): API tokens flow into this
// digestPayload via dataflow; plain SHA-256 isn't appropriate for token
// hashing per CodeQL's pattern. HMAC-SHA256 keyed on a server-side env
// is the recognised sanitiser. Falls back to plain SHA-256 when env not
// set (dev only).
function digestPayload(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  const hmacKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (hmacKey) {
    return createHmac("sha256", hmacKey).update(json).digest("hex");
  }
  return createHash("sha256").update(json).digest("hex");
}

async function writeReceipt(data: {
  auditRowId: string;
  buildId: string;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  toolName: string;
}): Promise<void> {
  const receiptKind = deriveReceiptKind(data.toolName);
  if (!receiptKind) {
    return;
  }

  const row = {
    buildId: data.buildId,
    executionStatus: data.result.success ? "succeeded" : "failed",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    inputFingerprint: digestPayload({
      params: data.rawParams,
      toolName: data.toolName,
    }),
    outputDigest: {
      sha256: digestPayload({
        data: data.result.data ?? null,
        error: data.result.error ?? null,
        message: data.result.message ?? null,
        success: data.result.success,
      }),
    },
    receiptKind,
    receiptStatus: data.result.success ? "valid" : "invalid",
    toolExecutionId: data.auditRowId,
  };

  try {
    if (_toolExecutionReceiptCreateOverride) {
      await _toolExecutionReceiptCreateOverride(row);
    } else {
      await prisma.toolExecutionReceipt.create({ data: row });
    }
  } catch (err) {
    // CodeQL #50 (js/tainted-format-string): tool/build names via format-args.
    console.error(
      "[governed-execute] receipt write failed tool=%s build=%s:",
      data.toolName,
      data.buildId,
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

async function runPreToolHooks(event: ToolLifecycleEvent): Promise<GovernedExecuteResult | null> {
  for (const hook of _lifecycleHooks) {
    const decision = await hook.onPreToolUse?.(event);
    if (decision?.decision === "deny") {
      return rejectionResult(event.toolName, "hook_denied", decision.reason);
    }
  }
  return null;
}

async function runPostToolHooks(event: ToolLifecyclePostEvent): Promise<void> {
  for (const hook of _lifecycleHooks) {
    try {
      await hook.onPostToolUse?.(event);
    } catch (err) {
      // CodeQL #51 (js/tainted-format-string): hook/tool names via format-args.
      console.error(
        "[governed-execute] post-tool hook failed hook=%s tool=%s:",
        hook.id,
        event.toolName,
        err,
      );
    }
  }
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

  const hookRejection = await runPreToolHooks({
    toolName: args.toolName,
    rawParams: args.rawParams,
    userId: args.userId,
    userContext: args.userContext,
    context: args.context,
    source: args.source,
  });
  if (hookRejection) {
    await writeAudit({
      toolName: args.toolName,
      rawParams: args.rawParams,
      result: hookRejection,
      userId: args.userId,
      source: args.source,
      context: args.context,
      durationMs: 0,
    });
    return hookRejection;
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

  await runPostToolHooks({
    toolName: args.toolName,
    rawParams: args.rawParams,
    userId: args.userId,
    userContext: args.userContext,
    context: args.context,
    source: args.source,
    result,
    durationMs,
  });

  const auditRow = await writeAudit({
    toolName: args.toolName,
    rawParams: args.rawParams,
    result,
    userId: args.userId,
    source: args.source,
    context: args.context,
    durationMs,
  });

  const resultBuildId =
    result.data
    && typeof result.data === "object"
    && typeof (result.data as Record<string, unknown>).buildId === "string"
      ? String((result.data as Record<string, unknown>).buildId)
      : null;
  if (auditRow?.id && resultBuildId) {
    await writeReceipt({
      auditRowId: auditRow.id,
      buildId: resultBuildId,
      rawParams: args.rawParams,
      result,
      toolName: args.toolName,
    });
  }

  return { ...result, governance: { durationMs } };
}
