// Single governed entry point for tool execution.
//
// All MCP-style callers (REST /api/mcp/call, the future JSON-RPC route, and
// the in-platform agentic loop) should funnel through here so that the three
// governance layers — user capability, agent grants, audit — are enforced in
// one place. Today only agentic-loop writes ToolExecution rows; this wrapper
// closes the audit gap on the REST and JSON-RPC paths and gives the future
// external-MCP transport a stable hook.

import { prisma } from "@dpf/db";
import { createHash, scryptSync } from "crypto";
import { can, type CapabilityKey, type UserContext } from "./permissions";
import {
  PLATFORM_TOOLS,
  executeTool,
  type ToolDefinition,
  type ToolResult,
} from "./mcp-tools";
import { coerceMcpToolArgs } from "./mcp-arg-coercion";
import { deriveAuditClassForTool, deriveCapabilityId } from "./tool-audit-helpers";
import { getWorkCaseAction } from "./work-management/action-registry";
import type { WorkCaseExecutionContext } from "./work-management/work-case-governance-hook";

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
  /** Client product token from the caller's User-Agent (BI-0EEBA669);
   *  persisted by decision-ledger writers so a decision can be matched back
   *  to the client/session that consulted the kernel. */
  callerClient?: string;
  /** How the caller authenticated ("pat" | "session-jwt"), from the MCP route. */
  authSource?: string;
  /**
   * Build the user is currently messaging from. Plumbed by runAgenticLoop
   * (via its `featureBuildId` param) so phase-scoped tools like
   * start_ideate_research / start_scout_research target the correct build
   * instead of fishing for "latest in phase X" — which silently
   * cross-contaminates state when multiple builds are in the same phase
   * (BI-F4A30FCB, Dale dogfood 2026-05-24).
   */
  featureBuildId?: string;
  /**
   * Governed Hermes learning Slice 1: active coworker skill for this call.
   * Set by runAgenticLoop when the parent run is attributed to a specific
   * skill invocation. Persisted to ToolExecution.skillId so reflection and
   * skill metrics can attribute action evidence to the originating skill.
   */
  skillId?: string;
  /**
   * In-portal coworker chat turns surface COWORKER_READ_BASELINE_GRANTS on the
   * attached tool set (getAvailableTools' `additionalGrants` option, called from
   * actions/agent-coworker.ts — BI-FD7E4D72). Set true by runAgenticLoop for
   * interactive `chat` turns so the execution-time agent-grant check honours the
   * SAME baseline the attach side used; without it a coworker whose own role
   * grants omit a baseline read grant (e.g. ops-coordinator without
   * code_graph_read) gets search_code_graph / read_project_file attached but
   * rejected on call. Left unset for autonomous/build turns so their authority is
   * unchanged. The baseline is read-only and still bounded by the user-capability
   * gate, so honouring it here never escalates beyond what the operator may see.
   */
  coworkerReadBaseline?: boolean;
  /**
   * Optional Work Case context for consequential actions flowing through the
   * governed execution seam. Existing callers omit this and retain their
   * current audit/receipt behavior.
   */
  workCase?: WorkCaseExecutionContext;
  /**
   * EP-31815F97 S2 (BI-F82F4E04): the active agent→agent DelegationChain grouping
   * `chainId` for this call, when the executing coworker was delegated to (set by
   * the delegation-creating paths — skill-discovery / coworker-collaboration —
   * which hold the chain). Persisted to ToolExecution.delegationChainId so the
   * action joins its chain-of-custody back to the human origin (TAK §7.1, GAID
   * §10). Omitted for direct human→coworker calls (human still on userId).
   */
  delegationChainId?: string;
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

export type ToolLifecycleEvent = {
  toolName: string;
  rawParams: Record<string, unknown>;
  userId: string;
  userContext: UserContext;
  context?: GovernedExecuteContext;
  source: GovernedExecuteSource;
};

export type ToolLifecyclePostEvent = ToolLifecycleEvent & {
  result: ToolResult;
  durationMs: number;
};

export type ToolLifecycleDecision =
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

/**
 * Preflight for autonomous dispatch: does this agent hold a grant for at least
 * one of the given tools? An agent that can call NOTHING it was handed will
 * have every tool call rejected with `forbidden_grant` — entering an agentic
 * loop just burns inference calls before the circuit breaker stops it. Callers
 * use this to fail fast with an actionable "needs grant" message instead.
 * Read-only; uses the same grant resolution as the execution-time check.
 */
export async function agentHasAnyGrant(agentId: string, toolNames: string[]): Promise<boolean> {
  if (toolNames.length === 0) return true; // no tools attached → nothing to gate
  const grants = await resolveGrants(agentId);
  for (const name of toolNames) {
    if (await isAllowedByGrants(name, grants)) return true;
  }
  return false;
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
    featureBuildId?: string;
    callerClient?: string;
    apiTokenId?: string;
    authSource?: string;
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
    // EP-31815F97 S2: join this execution to its chain-of-custody when the
    // executing coworker was delegated to; the human origin stays on userId.
    delegationChainId: data.context?.delegationChainId ?? null,
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
      "[governed-execute] audit write failed tool=%s source=%s: %s",
      JSON.stringify(data.toolName),
      JSON.stringify(data.source),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}

function deriveReceiptKind(
  toolName: string,
  context?: GovernedExecuteContext,
): string | null {
  if (context?.workCase) {
    const action = getWorkCaseAction(context.workCase.action);
    if (action?.consequential) {
      return "work-case-governed-action";
    }
  }

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
// digestPayload via dataflow; CodeQL requires a slow KDF for any value
// it traces from a password-like source. scrypt with a fixed salt
// ("dpf-receipt") gives a deterministic digest (receipts are content-
// addressable — a random salt would defeat the lookup). N=2^14 r=8 p=1
// is the standard Node default and takes ~1-5ms per digest.
function digestPayload(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return scryptSync(json, "dpf-receipt", 32, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  }).toString("hex");
}
// Keep createHash imported for any future non-KDF digest sites.
void createHash;

async function writeReceipt(data: {
  auditRowId: string;
  buildId: string | null;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  toolName: string;
  context?: GovernedExecuteContext;
}): Promise<void> {
  const receiptKind = deriveReceiptKind(data.toolName, data.context);
  if (!receiptKind) {
    return;
  }

  const row = {
    buildId: data.buildId ?? null,
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
      "[governed-execute] receipt write failed tool=%s build=%s: %s",
      JSON.stringify(data.toolName),
      JSON.stringify(data.buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
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
        "[governed-execute] post-tool hook failed hook=%s tool=%s: %s",
        JSON.stringify(hook.id),
        JSON.stringify(event.toolName),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
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

  // Re-hydrate any tool args a client serialized as JSON strings — the whole
  // arguments object, or individual array/object-typed fields — before the
  // governance hooks, audit, and tool switch see them. Schema-driven so
  // string-typed params are never parsed. This is the single funnel for all
  // MCP wire transports (REST /api/mcp/call, JSON-RPC /api/mcp/v1, internal
  // MCP session), which is exactly where client-side JSON-string framing
  // happens; in-process executeTool() callers pass native objects and are
  // unaffected. BI-16A80690.
  args = {
    ...args,
    rawParams: coerceMcpToolArgs(args.rawParams, tool.inputSchema),
  };

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
    let grants = await resolveGrants(args.context.agentId);
    // In-portal coworker chat turns attach COWORKER_READ_BASELINE_GRANTS to the
    // tool surface at resolution time (getAvailableTools' `additionalGrants` in
    // actions/agent-coworker.ts, BI-FD7E4D72). Mirror that here so the same
    // baseline reads the model was offered are also executable — otherwise a
    // coworker whose own role grants omit a baseline grant gets a read tool
    // (search_code_graph, read_project_file, doc_search, …) attached but rejected
    // on call. Read-only by construction and already bounded by the
    // user-capability gate above; scoped to coworker chat turns (runAgenticLoop
    // sets the flag), so autonomous/build authority is unchanged.
    if (args.context.coworkerReadBaseline) {
      const { COWORKER_READ_BASELINE_GRANTS } = await import("./tak/agent-grants");
      grants = Array.from(new Set([...grants, ...COWORKER_READ_BASELINE_GRANTS]));
    }
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
      featureBuildId: args.context?.featureBuildId,
      // Caller attribution for the decision ledger (BI-0EEBA669). Without these
      // three, every principle_decide consult recorded an all-null caller — the
      // route builds them from the request UA + resolved token, but this
      // forwarding dropped them on the floor, so the ledger never saw them.
      callerClient: args.context?.callerClient,
      apiTokenId: args.context?.apiTokenId,
      authSource: args.context?.authSource,
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
  const shouldWriteReceipt = Boolean(resultBuildId || args.context?.workCase);
  if (auditRow?.id && shouldWriteReceipt) {
    await writeReceipt({
      auditRowId: auditRow.id,
      buildId: resultBuildId,
      rawParams: args.rawParams,
      result,
      toolName: args.toolName,
      context: args.context,
    });
  }

  return { ...result, governance: { durationMs } };
}
