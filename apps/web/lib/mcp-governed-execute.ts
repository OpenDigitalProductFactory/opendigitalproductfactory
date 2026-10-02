// Single governed entry point for tool execution.
//
// All MCP-style callers (REST /api/mcp/call, the future JSON-RPC route, and
// the in-platform agentic loop) should funnel through here so that the three
// governance layers — user capability, agent grants, audit — are enforced in
// one place. Today only agentic-loop writes ToolExecution rows; this wrapper
// closes the audit gap on the REST and JSON-RPC paths and gives the future
// external-MCP transport a stable hook.

import { prisma } from "@dpf/db";
import { can, type CapabilityKey } from "./permissions";
import { GOVERNED_REJECTION_DISPOSITION, rejectionMessage } from "./govern/authority/governed-rejection-disposition";
import { approvalPendingResult, settledApprovalResult } from "./govern/authority/approval-pending-result";
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
  type AuthorityExecutedOutcome,
} from "./govern/authority/coworker-tool-authority-gate";
export type {
  AuthorityApprovalEnvelopeCreate,
  AuthorityApprovalEnvelopeFinalize,
  PolicyAuthorityProjectionAttempt,
  PolicyAuthorityEnvelopeReserve,
  AuthorityApprovalTaskResume,
  CoworkerAuthorityInputResolver,
} from "./govern/authority/coworker-tool-authority-gate";
import { PLATFORM_TOOLS, executeTool } from "./mcp-tools";
import type { ToolDefinition, ToolResult, ToolExecutionContext } from "./mcp-tool-types";
import type {
  GovernedExecuteArgs,
  GovernedExecuteContext,
  GovernedExecuteRejection,
  GovernedExecuteResult,
  GovernedExecuteSource,
  ToolLifecycleEvent,
  ToolLifecycleHook,
  ToolLifecyclePostEvent,
} from "./mcp-governed-execute-types";
import { coerceMcpToolArgs } from "./mcp-arg-coercion";
import { canonicalWorkroomToolName } from "./tak/workroom-tool-aliases";
import {
  setGovernedToolAuditOverridesForTests,
  updateGovernedToolAudit as updateAudit,
  writeGovernedToolAudit,
} from "./governed-tool-audit";
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
} from "./tak/precondition-ordering-gate";
import type { PreconditionOrderingDecision } from "./tak/precondition-ordering-types";
import { enforceTakPreexecution } from "./tak/preexecution-control";
import {
  setGaidActorResolverOverrideForTests,
  type GaidActorResolver,
} from "./tak/gaid-actor-envelope";
import { setGppPermitStoreOverrideForTests, type GppPermitStore } from "./gpp/permit-store";
import { recordPermitObservation, resolveMonitorPermit, type MonitorPermitOutcome } from "./gpp/permit-verdict";
import {
  decidePermitEnforcement,
  enforcementObservation,
  permitRequiredData,
  permitRequiredMessage,
} from "./gpp/permit-enforcement";

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
export type GovernedToolPreflight = (event: ToolLifecycleEvent) => Promise<ToolResult | null>;

let _resolveAgentGrants: GrantResolver | null = null;
let _isAllowedByGrants: GrantPredicate | null = null;
let _toolPreflightOverride: GovernedToolPreflight | null = null;
let _lifecycleHooks: ToolLifecycleHook[] = [];

export function _setGovernanceForTests(overrides: {
  resolveAgentGrants?: GrantResolver | null;
  isAllowedByGrants?: GrantPredicate | null;
  toolPreflight?: GovernedToolPreflight | null;
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
  authorityExecutedOutcome?: AuthorityExecutedOutcome | null;
  lifecycleHooks?: ToolLifecycleHook[] | null;
  alignmentGate?: AlignmentGate | null;
  preconditionGate?: PreconditionGate | null;
  gaidActorResolver?: GaidActorResolver | null;
  gppPermitStore?: GppPermitStore | null;
}): void {
  _resolveAgentGrants = overrides.resolveAgentGrants ?? null;
  _isAllowedByGrants = overrides.isAllowedByGrants ?? null;
  _toolPreflightOverride = overrides.toolPreflight ?? null;
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
  setGppPermitStoreOverrideForTests(overrides.gppPermitStore ?? null);
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

async function runGovernedToolPreflight(event: ToolLifecycleEvent): Promise<ToolResult | null> {
  if (_toolPreflightOverride) return _toolPreflightOverride(event);
  if (event.context?.authSource === "oauth" && typeof event.rawParams.capsuleId === "string") {
    const { workroomTargetAccessRefusal } = await import("./work-capsules/oauth-workroom-ownership");
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === event.toolName);
    const refusal = await workroomTargetAccessRefusal({
      params: event.rawParams,
      userId: event.userId,
      ...event.context,
      toolName: event.toolName,
      action: tool?.sideEffect !== false,
    });
    if (refusal) return refusal;
  }
  if (event.toolName === "invite_room_participant") {
    const { preflightRoomParticipantInvitation } = await import(
      "./work-management/room-participant-invitation-preflight.server"
    );
    const outcome = await preflightRoomParticipantInvitation({
      params: event.rawParams,
      userId: event.userId,
      agentId: event.context?.agentId,
    });
    return outcome.verdict === "allow" ? null : outcome.result;
  }
  return null;
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
  ctx?: ToolExecutionContext,
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
  envelopeId?: string | null;
  gppPermit?: MonitorPermitOutcome | null;
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
  // Only a settled no is worded "rejected"; see governed-rejection-disposition.
  const disposition = GOVERNED_REJECTION_DISPOSITION[rejection];
  const message = rejectionMessage(toolName, detail, disposition);
  return {
    success: false,
    error: rejection,
    message,
    disposition,
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
  args = { ...args, toolName: canonicalWorkroomToolName(args.toolName) };
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

    // Deterministic target preconditions come after capability/grant checks so
    // they disclose nothing to an unauthorized caller, but before authority
    // escalation because approving an impossible call cannot make it valid.
    // BI-061D7192: an unadmitted coworker repeatedly produced approval cards
    // for invite/recovery calls that the exact-room gate then refused.
    if (humanCapabilityAllowed && agentGrantAllowed) {
      const preflight = await runGovernedToolPreflight({
        toolName: args.toolName,
        rawParams: args.rawParams,
        userId: args.userId,
        userContext: args.userContext,
        context: args.context,
        source: args.source,
      });
      if (preflight) {
        const result: GovernedExecuteResult = {
          ...preflight,
          governance: { rejected: "precondition_denied" },
        };
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
    }

    const authorityGate = await enforceCoworkerToolAuthority(
      args,
      tool,
      agentGrantAllowed,
    );
    if (authorityGate.outcome === "settled") return settledApprovalResult(args.toolName, authorityGate);
    if (authorityGate.outcome === "reject") {
      const result: GovernedExecuteResult = {
        ...(authorityGate.rejection === "approval_required"
          ? approvalPendingResult(args.toolName, authorityGate.message, authorityGate.data)
          : rejectionResult(
            args.toolName,
            authorityGate.rejection,
            authorityGate.message,
          )),
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

  // EP-WORK-POSTURE 8.2 (BI-F114354D item 6): inside a Workroom, EVERY tool the
  // classification marks consequential clears the WWWD x WSID alignment gate,
  // not only the outward/legacy-named subset. The room is where the coworker's
  // job (WSID) and the org's constitution (WWWD) are both in scope; unroomed
  // calls keep the narrower reach so nothing outside a room changes.
  const alignmentRequired = consequence.alignmentRequired
    || (consequence.consequential && Boolean(args.context?.roomAuthority?.workroomId));
  const preexecution = await enforceTakPreexecution({
    args,
    alignmentRequired,
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

  // GPP Phase 2 PR-C (BI-69415B68): shadow permit. For an outward, authority or
  // irreversible call only, mint a permit under the binding whose gate just
  // admitted it, verify the presented handle or the minted permit, and record
  // the verdict. Shadow by contract: the verdict never changes the outcome,
  // and mint/record failures are swallowed inside the gpp modules. Routine
  // reads and ordinary writes take no new path.
  const gppPermit = consequence.consequential
    ? await resolveMonitorPermit({
        toolName: args.toolName,
        tool: { consequential: true, name: args.toolName },
        alignmentApproved: alignmentDecision?.verdict === "approve",
        alignmentInteractionId: alignmentDecision?.interactionId ?? null,
        approvedEnvelopeId: approvedAuthorityEnvelopeId,
        authorityDecisionId: authorityDecisionId ?? null,
        actorUserId: args.userId,
        actorAgentId: args.context?.agentId ?? null,
        workroomId: args.context?.roomAuthority?.workroomId ?? null,
        permitHandle: args.context?.permitHandle,
        // PR-D: the exact call's arguments, bound as paramHash at mint and
        // compared against a presented handle (param_mismatch).
        params: args.rawParams,
      })
    : null;
  // GPP Phase 2 PR-E: only a binding in the checked-in enforcement table acts
  // on the verdict. With none covering the call (the shipped state) this is
  // `not-applicable` and the observation and path below are unchanged.
  const permitEnforcement = gppPermit
    ? decidePermitEnforcement({ tool: { consequential: true, name: args.toolName }, outcome: gppPermit })
    : { kind: "not-applicable" as const };
  const enforcementRecord = enforcementObservation(permitEnforcement);
  const observePermit = async (permit: MonitorPermitOutcome, toolExecutionId: string | null) => recordPermitObservation({
    permitRowId: permit.permitRowId, bindingId: permit.bindingId, toolName: args.toolName, verdict: permit.verdict,
    path: "monitor", toolExecutionId, callerSite: null,
    ...(enforcementRecord.enforcement ? { enforcement: enforcementRecord.enforcement } : {}),
    detail: { ...permit.detail, source: args.source, ...enforcementRecord.detail },
  });
  if (gppPermit && permitEnforcement.kind === "refuse") {
    const refused: GovernedExecuteResult = {
      ...rejectionResult(args.toolName, "permit_required", permitRequiredMessage(permitEnforcement)),
      data: permitRequiredData(permitEnforcement, gppPermit.verdict),
    };
    const auditRow = await writeAudit({
      toolName: args.toolName, rawParams: args.rawParams, result: refused, userId: args.userId,
      source: args.source, context: args.context, durationMs: 0,
      alignmentDecision, preconditionDecision, envelopeId: approvedAuthorityEnvelopeId, gppPermit,
    });
    await observePermit(gppPermit, auditRow?.id ?? null);
    if (auditRow?.id) {
      await writeToolExecutionReceipt({
        auditRowId: auditRow.id, buildId: null, rawParams: args.rawParams, result: refused,
        toolName: args.toolName, context: args.context, consequential: true, governedArgs: args,
      });
    }
    return refused;
  }

  let reservedAuditId: string | null = null;
  let reservedReceiptId: string | null = null;
  if (consequence.consequential) {
    const reservationResult: ToolResult = {
      success: false, error: "execution_reserved", message: "Consequential execution awaiting side effect.",
    };
    const reservedAudit = await writeAudit({
      toolName: args.toolName, rawParams: args.rawParams, result: reservationResult,
      userId: args.userId, source: args.source, context: args.context, durationMs: 0,
      alignmentDecision, preconditionDecision, envelopeId: approvedAuthorityEnvelopeId, gppPermit,
    });
    reservedAuditId = reservedAudit?.id ?? null;
    if (gppPermit) await observePermit(gppPermit, reservedAuditId);
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
      approvedAuthorityEnvelopeId,
      ...(gppPermit?.permitId ? { gppPermitId: gppPermit.permitId } : {}),
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
            // A presented permit handle names the outer call; a nested surface
            // action is its own call and is admitted (or not) on its own.
            permitHandle: undefined,
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
      alignmentDecision, preconditionDecision, envelopeId: approvedAuthorityEnvelopeId, gppPermit,
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

  // PR-D: the handle of the permit minted for this call, additively, so a
  // caller can cite or replay it. The handler and the audit row get the opaque
  // permit id only (gppPermitId / gppPermitRef), never the MAC.
  return {
    ...result,
    governance: {
      durationMs,
      ...(gppPermit?.handle ? { permit: { handle: gppPermit.handle, verdict: gppPermit.verdict } } : {}),
      ...(gppPermit?.handle && gppPermit.handleExpiresAt ? { permitHandleExpiresAt: gppPermit.handleExpiresAt } : {}),
    },
  };
}
