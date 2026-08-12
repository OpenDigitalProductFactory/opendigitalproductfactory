/**
 * AI Staffing Coworker — human-authority boundary (EP-WORKFORCE-OPS /
 * BI-4AD09A35 Phase 4). Spec §11 (authority progression) + §12.3 (employment AI
 * boundary) + founder decision 2 (publish authority = owner/operator, delegable
 * by scope later).
 *
 * The rule the whole feature turns on: an optimizer or AI model may never, by
 * itself, publish a schedule, message an employee, decide leave, approve an
 * exception, or impose an adverse employment consequence (spec §2.2). Those
 * require a human actor with the authority — or an explicit, scoped, unexpired
 * delegation the human granted. Evidence-gathering (prepare/refresh) is the only
 * thing the coworker may do unattended in Phase 1.
 *
 * This module is a pure decision function; persistence and the actual side
 * effect live outside it. It returns a verdict + reason for the audit record.
 */

/** Every action the staffing coworker or a human can take, ranked by consequence. */
export type StaffingAction =
  | "prepare_proposal" // read facts, run solver, compose options — evidence only
  | "refresh_proposal" // re-run when only demand changed — low-risk, delegable
  | "prepare_leave_decision" // recommend + queue for a human; never decide leave
  | "send_notification" // message employees — consequential
  | "publish_schedule" // bind assignments, project to calendar — consequential
  | "approve_exception" // waive an org rule — consequential
  | "decide_leave"; // approve/deny leave — consequential

/** Actions that always require a human decision (spec §11 Phase-3 carve-outs). */
const HUMAN_ONLY: ReadonlySet<StaffingAction> = new Set([
  "approve_exception",
  "decide_leave",
]);

/** Consequential actions: allowed for the coworker ONLY under a matching grant. */
const CONSEQUENTIAL: ReadonlySet<StaffingAction> = new Set([
  "send_notification",
  "publish_schedule",
  "approve_exception",
  "decide_leave",
]);

export function requiresHumanApproval(action: StaffingAction): boolean {
  return CONSEQUENTIAL.has(action);
}

export type Actor =
  | { kind: "agent"; agentId: string }
  | {
      kind: "human";
      userId: string;
      /** Capabilities the human holds, e.g. "staffing.publish". */
      capabilities: string[];
    };

/**
 * A scoped delegation a human granted to the coworker (mirrors DelegationGrant:
 * scopeJson, status, validFrom/expiresAt, maxUses/useCount).
 */
export type StaffingDelegation = {
  granteeAgentId: string;
  status: string; // "active" | "revoked" | ...
  validFrom: Date;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  /** Which actions + scope the grant covers. */
  scope: {
    actions: StaffingAction[];
    organizationId?: string;
    locationIds?: string[];
  };
};

export type AuthorizationContext = {
  action: StaffingAction;
  actor: Actor;
  organizationId: string;
  /** The location the action affects, if scoped. */
  locationId?: string | null;
  now: Date;
  delegation?: StaffingDelegation | null;
};

export type AuthorizationVerdict = {
  allowed: boolean;
  /** Machine + human readable reason, recorded in the decision evidence. */
  reason: string;
};

function delegationValid(
  d: StaffingDelegation,
  ctx: AuthorizationContext,
): boolean {
  if (d.status !== "active") return false;
  if (ctx.now < d.validFrom || ctx.now >= d.expiresAt) return false;
  if (d.maxUses !== null && d.useCount >= d.maxUses) return false;
  if (!d.scope.actions.includes(ctx.action)) return false;
  if (d.scope.organizationId && d.scope.organizationId !== ctx.organizationId) return false;
  if (
    d.scope.locationIds &&
    ctx.locationId &&
    !d.scope.locationIds.includes(ctx.locationId)
  ) {
    return false;
  }
  return true;
}

/**
 * The authorization decision. Evidence-gathering is always allowed; human-only
 * actions are never delegable; other consequential actions need either a human
 * with the capability or a matching, valid delegation.
 */
export function authorizeStaffingAction(ctx: AuthorizationContext): AuthorizationVerdict {
  const { action, actor } = ctx;

  // Evidence-gathering (prepare/refresh) is the coworker's Phase-1 authority.
  if (!requiresHumanApproval(action)) {
    return { allowed: true, reason: `${action} is evidence-gathering; no approval required` };
  }

  if (actor.kind === "human") {
    // Human-only actions (leave, exception) require the human simply to be
    // authorized; publish/notify require the publish capability (decision 2).
    if (HUMAN_ONLY.has(action)) {
      return { allowed: true, reason: `human ${actor.userId} decides ${action}` };
    }
    const capable = actor.capabilities.includes("staffing.publish");
    return capable
      ? { allowed: true, reason: `human ${actor.userId} holds staffing.publish` }
      : { allowed: false, reason: `human ${actor.userId} lacks staffing.publish capability` };
  }

  // Agent actor.
  if (HUMAN_ONLY.has(action)) {
    return { allowed: false, reason: `${action} is human-only and cannot be delegated (spec §11)` };
  }
  const d = ctx.delegation;
  if (d && d.granteeAgentId === actor.agentId && delegationValid(d, ctx)) {
    return { allowed: true, reason: `agent ${actor.agentId} acts under delegation for ${action}` };
  }
  return {
    allowed: false,
    reason: `agent ${actor.agentId} needs a valid, scoped delegation to ${action}`,
  };
}
