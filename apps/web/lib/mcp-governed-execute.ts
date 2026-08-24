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
import type { CoworkerAuthorityDecision } from "./govern/authority/coworker-authority-decision";
import {
  enforceCoworkerToolAuthority,
  finalizeCoworkerAuthorityApproval,
  setCoworkerToolAuthorityOverridesForTests,
  type AuthorizationDecisionCreate,
  type AuthorityApprovalEnvelopeCreate,
  type AuthorityApprovalEnvelopeFinalize,
  type AuthorityApprovalTaskResume,
  type CoworkerAuthorityInputResolver,
  type PolicyAuthorityProjectionAttempt,
  type PolicyAuthorityEnvelopeReserve,
} from "./govern/authority/coworker-tool-authority-gate";
export type {
  AuthorityApprovalEnvelopeCreate,
  AuthorityApprovalEnvelopeFinalize,
  PolicyAuthorityProjectionAttempt,
  PolicyAuthorityEnvelopeReserve,
  AuthorityApprovalTaskResume,
  CoworkerAuthorityInputResolver,
} from "./govern/authority/coworker-tool-authority-gate";
import {
  PLATFORM_TOOLS,
  executeTool,
  type ToolDefinition,
  type ToolResult,
} from "./mcp-tools";
import { coerceMcpToolArgs } from "./mcp-arg-coercion";
import {
  setGovernedToolAuditOverridesForTests,
  updateGovernedToolAudit as updateAudit,
  writeGovernedToolAudit,
} from "./governed-tool-audit";
import type { WorkCaseExecutionContext } from "./work-management/work-case-governance-hook";
import type { AuthorizedSurfaceContext, AuthorizedSurfaceInvocation } from "@/lib/coworker/authorized-surface-execution-types";
import {
  classifyConsequentialTool,
} from "./tak/consequential-tool-policy";
import {
  setAlignmentGateOverrideForTests,
  type AlignmentGate,
  type AlignmentGateDecision,
} from "./tak/alignment-tool-gate";
import {
  finalizeConsequentialToolExecutionReceipt,
  reserveConsequentialToolExecutionReceipt,
  setToolExecutionReceiptCreateOverrideForTests,
  setToolExecutionReceiptUpdateOverrideForTests,
  writeToolExecutionReceipt,
} from "./tak/tool-execution-receipt";
import {
  setPreconditionGateOverrideForTests,
  type PreconditionGate,
  type PreconditionOrderingDecision,
} from "./tak/precondition-ordering-gate";
import { enforceTakPreexecution } from "./tak/preexecution-control";
import {
  setGaidActorResolverOverrideForTests,
  type GaidActorResolver,
} from "./tak/gaid-actor-envelope";

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
  /** All coworker runtimes receive the ASC transport baseline. Domain actions
   * still re-enter this governed executor and retain their ordinary authority. */
  coworkerAuthorizedSurfaceBaseline?: boolean;
  authorizedSurfaceContext?: AuthorizedSurfaceContext;
  /**
   * Server-owned session permission for tools that cross the platform
   * boundary. Callers may set this only after the tool registry has admitted
   * the tool for the current session.
   */
  externalAccessEnabled?: boolean;
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
  /** Server-resolved MCP token limits, forwarded only so a compiled surface
   * action can re-check the original token before nested governed dispatch. */
  tokenScope?: "read" | "write" | "admin";
  tokenGrantScopes?: string[];
  /** Server-authored correlation for a domain tool reached through ASC. */
  surfaceInvocation?: AuthorizedSurfaceInvocation;
  /** Server-resolved organization identity for WWWD alignment. */
  organizationId?: string;
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
  | "hook_denied"
  | "authority_denied"
  | "approval_required"
  | "authority_evidence_unavailable"
  | "alignment_denied"
  | "alignment_escalation_required"
  | "alignment_bypass_forbidden"
  | "receipt_reservation_failed"
  | "precondition_denied"
  | "precondition_escalation_required";

export type GovernedExecuteResult = ToolResult & {
  governance?: {
    rejected?: GovernedExecuteRejection;
    durationMs?: number;
    authorityReason?: CoworkerAuthorityDecision["reasonCode"];
    alignment?: AlignmentGateDecision["alignment"];
    alignmentInteractionId?: string;
    precondition?: PreconditionOrderingDecision;
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
  toolExecutionUpdate?: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null;
  toolExecutionReceiptCreate?: ((data: Record<string, unknown>) => Promise<unknown>) | null;
  toolExecutionReceiptUpdate?: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null;
  resolveCoworkerAuthorityInput?: CoworkerAuthorityInputResolver | null;
  authorizationDecisionCreate?: AuthorizationDecisionCreate | null;
  authorityApprovalEnvelopeCreate?: AuthorityApprovalEnvelopeCreate | null;
  authorityApprovalTaskResume?: AuthorityApprovalTaskResume | null;
  authorityApprovalEnvelopeFinalize?: AuthorityApprovalEnvelopeFinalize | null;
  policyAuthorityProjectionAttempt?: PolicyAuthorityProjectionAttempt | null;
  policyAuthorityEnvelopeReserve?: PolicyAuthorityEnvelopeReserve | null;
  lifecycleHooks?: ToolLifecycleHook[] | null;
  alignmentGate?: AlignmentGate | null;
  preconditionGate?: PreconditionGate | null;
  gaidActorResolver?: GaidActorResolver | null;
}): void {
  _resolveAgentGrants = overrides.resolveAgentGrants ?? null;
  _isAllowedByGrants = overrides.isAllowedByGrants ?? null;
  _executeToolOverride = overrides.executeTool ?? null;
  setGovernedToolAuditOverridesForTests({
    create: overrides.toolExecutionCreate ?? null,
    update: overrides.toolExecutionUpdate ?? null,
  });
  setToolExecutionReceiptCreateOverrideForTests(overrides.toolExecutionReceiptCreate ?? null);
  setToolExecutionReceiptUpdateOverrideForTests(overrides.toolExecutionReceiptUpdate ?? null);
  setCoworkerToolAuthorityOverridesForTests(overrides);
  _lifecycleHooks = overrides.lifecycleHooks ?? [];
  setAlignmentGateOverrideForTests(overrides.alignmentGate ?? null);
  setPreconditionGateOverrideForTests(overrides.preconditionGate ?? null);
  setGaidActorResolverOverrideForTests(overrides.gaidActorResolver ?? null);
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
    userContext?: UserContext;
    governedSource?: GovernedExecuteSource;
    tokenScope?: "read" | "write" | "admin";
    tokenGrantScopes?: string[];
    authorizedSurfaceContext?: GovernedExecuteContext["authorizedSurfaceContext"];
    authorityDecisionId?: string;
    governedDispatch?: (
      toolName: string,
      params: Record<string, unknown>,
      invocation?: { surfaceId: string; sessionId: string; revision: string; actionId: string },
    ) => Promise<ToolResult>;
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
  alignmentDecision?: AlignmentGateDecision | null;
  preconditionDecision?: PreconditionOrderingDecision | null;
}): Promise<{ id: string } | null> {
  const tool = findTool(data.toolName);
  return writeGovernedToolAudit({ ...data, tool });
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
  let approvedAuthorityEnvelopeId: string | null = null;
  let authorityDecisionId: string | undefined;
  let alignmentDecision: AlignmentGateDecision | null = null;
  let preconditionDecision: PreconditionOrderingDecision | null = null;
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
  const consequence = classifyConsequentialTool({
    toolName: args.toolName,
    tool,
    workCase: args.context?.workCase,
  });

  const humanCapabilityAllowed = !tool.requiredCapability
    || can(args.userContext, tool.requiredCapability as CapabilityKey);

  // Direct human transports retain the existing capability contract. Coworker
  // calls are evaluated below as one combined human + agent + delegation
  // decision so every attempted action produces one complete authority record.
  if (!args.context?.agentId && !humanCapabilityAllowed) {
      const result = rejectionResult(
        args.toolName,
        "forbidden_capability",
        `user lacks capability ${tool.requiredCapability}`,
      );
      const auditRow = await writeAudit({
        toolName: args.toolName,
        rawParams: args.rawParams,
        result,
        userId: args.userId,
        source: args.source,
        context: args.context,
        durationMs: 0,
      });
      if (auditRow?.id && consequence.consequential) {
        await writeToolExecutionReceipt({
          auditRowId: auditRow.id,
          buildId: null,
          rawParams: args.rawParams,
          result,
          toolName: args.toolName,
          context: args.context,
          consequential: true,
          governedArgs: args,
        });
      }
      return result;
  }

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
    if (args.context.coworkerAuthorizedSurfaceBaseline) {
      const { COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } = await import("@/lib/coworker/authorized-surface-coworker-contract");
      grants = Array.from(new Set([...grants, ...COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS]));
    }
    const agentGrantAllowed = await isAllowedByGrants(args.toolName, grants);

    const authorityGate = await enforceCoworkerToolAuthority(
      args,
      tool,
      agentGrantAllowed,
    );
    if (authorityGate.outcome === "reject") {
      const result: GovernedExecuteResult = {
        ...rejectionResult(
          args.toolName,
          authorityGate.rejection,
          authorityGate.message,
        ),
        ...(authorityGate.data ? { data: authorityGate.data } : {}),
        governance: {
          rejected: authorityGate.rejection,
          ...(authorityGate.authorityReason
            ? { authorityReason: authorityGate.authorityReason }
            : {}),
        },
      };
      if (
        authorityGate.rejection === "authority_denied"
        || authorityGate.rejection === "approval_required"
        || consequence.consequential
      ) {
        const auditRow = await writeAudit({
          toolName: args.toolName,
          rawParams: args.rawParams,
          result,
          userId: args.userId,
          source: args.source,
          context: args.context,
          durationMs: 0,
        });
        if (auditRow?.id && consequence.consequential) {
          await writeToolExecutionReceipt({
            auditRowId: auditRow.id,
            buildId: null,
            rawParams: args.rawParams,
            result,
            toolName: args.toolName,
            context: args.context,
            consequential: true,
            governedArgs: args,
          });
        }
      }
      return result;
    }
    approvedAuthorityEnvelopeId = authorityGate.approvedEnvelopeId;
    authorityDecisionId = authorityGate.authorityDecisionId;
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
    const auditRow = await writeAudit({
      toolName: args.toolName,
      rawParams: args.rawParams,
      result: hookRejection,
      userId: args.userId,
      source: args.source,
      context: args.context,
      durationMs: 0,
    });
    if (auditRow?.id && consequence.consequential) {
      await writeToolExecutionReceipt({
        auditRowId: auditRow.id,
        buildId: null,
        rawParams: args.rawParams,
        result: hookRejection,
        toolName: args.toolName,
        context: args.context,
        consequential: true,
        governedArgs: args,
      });
    }
    return hookRejection;
  }

  const preexecution = await enforceTakPreexecution({
    args,
    alignmentRequired: consequence.alignmentRequired,
    preconditionRequired: consequence.preconditionRequired,
    writeAudit: ({ result, alignmentDecision: alignment, preconditionDecision: precondition }) => writeAudit({
      toolName: args.toolName, rawParams: args.rawParams, result, userId: args.userId,
      source: args.source, context: args.context, durationMs: 0,
      alignmentDecision: alignment, preconditionDecision: precondition,
    }),
  });
  alignmentDecision = preexecution.alignmentDecision;
  preconditionDecision = preexecution.preconditionDecision;
  if (preexecution.result) return preexecution.result;

  let reservedAuditId: string | null = null;
  let reservedReceiptId: string | null = null;
  if (consequence.consequential) {
    const reservationResult: ToolResult = {
      success: false, error: "execution_reserved", message: "Consequential execution awaiting side effect.",
    };
    const reservedAudit = await writeAudit({
      toolName: args.toolName, rawParams: args.rawParams, result: reservationResult,
      userId: args.userId, source: args.source, context: args.context, durationMs: 0,
      alignmentDecision, preconditionDecision,
    });
    reservedAuditId = reservedAudit?.id ?? null;
    const reservedReceipt = reservedAuditId
      ? await reserveConsequentialToolExecutionReceipt({
          auditRowId: reservedAuditId, args, alignmentDecision, preconditionDecision,
        })
      : null;
    reservedReceiptId = reservedReceipt?.id ?? null;
    if (!reservedAuditId || !reservedReceiptId) {
      const failure = rejectionResult(
        args.toolName,
        "receipt_reservation_failed",
        "the mandatory GAID receipt channel could not be reserved before execution",
      );
      if (reservedAuditId) await updateAudit(reservedAuditId, failure, 0);
      return failure;
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
      featureBuildId: args.context?.featureBuildId,
      // Caller attribution for the decision ledger (BI-0EEBA669). Without these
      // three, every principle_decide consult recorded an all-null caller — the
      // route builds them from the request UA + resolved token, but this
      // forwarding dropped them on the floor, so the ledger never saw them.
      callerClient: args.context?.callerClient,
      apiTokenId: args.context?.apiTokenId,
      authSource: args.context?.authSource,
      userContext: args.userContext,
      governedSource: args.source,
      tokenScope: args.context?.tokenScope,
      tokenGrantScopes: args.context?.tokenGrantScopes,
      authorizedSurfaceContext: args.context?.authorizedSurfaceContext,
      authorityDecisionId,
      governedDispatch: async (nestedToolName, nestedParams, surfaceInvocation) => {
        const nestedTool = findTool(nestedToolName);
        if (!nestedTool) {
          return { success: false, error: "unknown_tool", message: `Unknown tool: ${nestedToolName}` };
        }
        if (args.context?.apiTokenId) {
          const requiredGrants = (await import("./tak/agent-grants")).TOOL_TO_GRANTS[nestedToolName];
          const expanded = (await import("./tak/agent-grants")).expandGrants(args.context.tokenGrantScopes ?? []);
          const grantAllowed = !!requiredGrants?.some((grant) => expanded.includes(grant));
          const requiredScope = requiredGrants?.some((grant) => grant.startsWith("admin_"))
            ? "admin"
            : nestedTool.sideEffect ? "write" : "read";
          const actualScope = args.context.tokenScope;
          const scopeAllowed = requiredScope === "read"
            || (requiredScope === "write" && (actualScope === "write" || actualScope === "admin"))
            || (requiredScope === "admin" && actualScope === "admin");
          if (!grantAllowed || !scopeAllowed) {
            return {
              success: false,
              error: "insufficient_token_scope",
              message: `The originating MCP token is not authorized for nested surface action '${nestedToolName}'.`,
            };
          }
        }
        return governedExecuteTool({
          ...args,
          toolName: nestedToolName,
          rawParams: nestedParams,
          context: {
            ...args.context,
            ...(surfaceInvocation ? { surfaceInvocation } : {}),
          },
        });
      },
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

  if (approvedAuthorityEnvelopeId) {
    try {
      await finalizeCoworkerAuthorityApproval(
        approvedAuthorityEnvelopeId,
        result.success,
      );
    } catch (err) {
      // The action has already run, so this cannot fail closed without
      // misreporting the side effect. Preserve the result and surface the
      // evidence defect in server logs for reconciliation.
      console.error(
        "[governed-execute] approval envelope finalization failed envelope=%s tool=%s: %s",
        JSON.stringify(approvedAuthorityEnvelopeId),
        JSON.stringify(args.toolName),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
      );
    }
  }

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

  const resultBuildId =
    result.data
    && typeof result.data === "object"
    && typeof (result.data as Record<string, unknown>).buildId === "string"
      ? String((result.data as Record<string, unknown>).buildId)
      : null;
  const shouldWriteReceipt = Boolean(
    resultBuildId || args.context?.workCase || consequence.consequential,
  );
  let auditRow: { id: string } | null = reservedAuditId ? { id: reservedAuditId } : null;
  if (reservedAuditId && reservedReceiptId) {
    await updateAudit(reservedAuditId, result, durationMs);
    try {
      await finalizeConsequentialToolExecutionReceipt({
        receiptId: reservedReceiptId, result, toolName: args.toolName, args,
        alignmentDecision, preconditionDecision, buildId: resultBuildId,
      });
    } catch (err) {
      // The receipt was durably reserved before the side effect. Preserve the
      // actual tool result; reconciliation can finalize the reserved envelope.
      console.error(
        "[governed-execute] reserved receipt finalization failed receipt=%s tool=%s: %s",
        JSON.stringify(reservedReceiptId), JSON.stringify(args.toolName),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
      );
    }
  } else {
    auditRow = await writeAudit({
      toolName: args.toolName, rawParams: args.rawParams, result, userId: args.userId,
      source: args.source, context: args.context, durationMs,
      alignmentDecision, preconditionDecision,
    });
  }
  if (auditRow?.id && shouldWriteReceipt && !reservedReceiptId) {
    await writeToolExecutionReceipt({
      auditRowId: auditRow.id,
      buildId: resultBuildId,
      rawParams: args.rawParams,
      result,
      toolName: args.toolName,
      context: args.context,
      consequential: consequence.consequential,
      alignmentDecision,
      preconditionDecision,
      governedArgs: args,
    });
  }

  return { ...result, governance: { durationMs } };
}
