// Governed tool-execution contract types: the shapes the governed executor
// (lib/mcp-governed-execute.ts), its authority, alignment and precondition
// gates, receipt and audit writers, and lifecycle hooks share
// (GovernedExecuteArgs, GovernedExecuteContext, GovernedExecuteResult,
// ToolLifecycleHook).
//
// Types only, and a leaf: this module may import types from modules that do
// not import back into the governed executor, never from
// lib/mcp-governed-execute.ts or a gate it runs. The types used to live in the
// executor itself, which made every gate's `import type` an edge back into
// apps/web's largest import cycle; TypeScript project references need that
// graph acyclic (dependency-diet plan, M11 step 2). The guard
// scripts/check-no-web-import-cycle-growth.mjs ratchets that cycle.

import type { UserContext } from "@/lib/permissions";
import type { ToolResult } from "@/lib/mcp-tool-types";
import type { CoworkerAuthorityDecision } from "@/lib/govern/authority/coworker-authority-decision";
import type { AuthorizedSurfaceContext, AuthorizedSurfaceInvocation } from "@/lib/coworker/authorized-surface-execution-types";
import type { ConstitutionalAlignmentResult } from "@/lib/decision-perspective/alignment-criteria";
import type { RoomAuthorityContext } from "@/lib/work-management/room-turn-authority";
import type { WorkCasePolicyInput } from "@/lib/work-management/policy-envelope";
import type { PreconditionOrderingDecision } from "@/lib/tak/precondition-ordering-types";

/** Work Case context a consequential governed call may carry. */
export type WorkCaseExecutionContext = WorkCasePolicyInput;

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
   * Server-owned permission for tools that cross the platform boundary.
   * Resolved from the coworker's standing grants and the Workroom the turn
   * runs in (lib/work-management/room-turn-authority.ts) — never from a
   * client-asserted switch (BI-947780FE).
   */
  externalAccessEnabled?: boolean;
  /**
   * EP-WORK-POSTURE §8.2 (BI-F114354D): the Workroom this call runs in and the
   * tool surface that room authorizes. The authority evaluator intersects it
   * with the coworker's grants and the human's capabilities; a tool outside
   * the room's surface is denied `room-authority-denied`. Omitted for unroomed
   * turns, which fall to the coworker's grants alone.
   */
  roomAuthority?: RoomAuthorityContext;
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
  /**
   * BI-12E5DD91: the OAuth consent binding the access-token resolver
   * revalidated on THIS request (current human, current binding, bound
   * assistant). Set only by the MCP route for `oauth` tokens; the escalation
   * gate treats it as the human's recorded delegation to `agentId`.
   */
  connectionDelegation?: { authorityBindingId: string; agentId: string };
  /**
   * GPP Phase 2 PR-C (BI-69415B68): a permit handle the caller presented —
   * an external client replaying the opaque permit id it was given, carried on
   * the MCP route as `params._meta["com.opendigitalproductfactory/authorization-handle"]`.
   * The monitor records the handle's verdict; it refuses on it only for a
   * binding promoted to enforced (PR-E, lib/gpp/binding-enforcement.ts).
   */
  permitHandle?: string;
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
  | "precondition_escalation_required"
  /**
   * GPP Phase 2 PR-E: an enforced binding covers the call and it carries no
   * valid permit. A hold, not a settled no: pass the named gate and call again.
   */
  | "permit_required";

export type GovernedExecuteResult = ToolResult & {
  governance?: {
    rejected?: GovernedExecuteRejection;
    durationMs?: number;
    authorityReason?: CoworkerAuthorityDecision["reasonCode"];
    alignment?: ConstitutionalAlignmentResult;
    alignmentInteractionId?: string;
    precondition?: PreconditionOrderingDecision;
    approvalReplayOf?: string;
    /**
     * GPP Phase 2 PR-D (BI-69415B68): the permit the reference monitor minted
     * for this call — `gpp1.<permitId>.<keyId>.<mac>`, or the bare permit id
     * when the install has no permit key — and its shadow verdict. Additive;
     * present only when a gate admitted an outward, authority or irreversible
     * call. The verdict never changes the outcome.
     */
    permit?: { handle: string; verdict: string };
    /**
     * GPP Phase 2 PR-G: when `permit.handle` expires (ISO-8601). Present
     * exactly when `permit` is. The MCP route returns the two together on
     * the tool result's `_meta` (lib/gpp/permit-carriage.ts).
     */
    permitHandleExpiresAt?: string;
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
