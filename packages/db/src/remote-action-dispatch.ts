// EP-REMOTE-ACTION · P2 (read-only pilot) — pure dispatch eligibility + lifecycle.
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.
// Threat model: docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md.
//
// THE CHANNEL IS PULL, NOT PUSH. The Edge is outbound/pull-only today (it pulls
// adapter config + heartbeat, pushes discovery/events/metrics). P2 keeps that shape:
// the node POLLS for the queued RemoteActions it is allowed to claim — there is no
// new inbound-to-Edge port, which strictly improves the SSRF/firewall posture over a
// downward dispatch. This module is the pure decision at the heart of that poll:
// "which queued actions may THIS node claim right now?"
//
// It enforces, in one place (threat model §5 R3/R5 + the read-only-pilot go/no-go):
//   - the READ-ONLY gate (P2 ships diagnostics only; mutating actions stay gated to P3),
//   - tenant SCOPE (a node acts only within its own estate scope), and
//   - node trust + the action.execute capability.
//
// It is the SAME logic for both event-management scenarios — only the scope fields
// differ: INTERNAL (the org's own estate: customerAccountId null) and IT-MSP CUSTOMER
// (scoped to a customerAccountId/customerSiteId). Federated (Topology B) actions, once
// the customer has approved them, are claimed by the customer's OWN node like any other
// in-scope action — originLinkId governed approval (P1), not execution-by-own-node.
//
// Pure (no prisma): callers map rows → the view interfaces below, so the security
// core is exhaustively unit-tested without a DB.

/** The only action types the read-only pilot will dispatch. Mutating verbs
 *  (service.restart / patch.apply / reboot) are gated to P3 and excluded here even
 *  if a row is mislabeled — defense in depth alongside the riskClass check. */
export const READONLY_DISPATCH_ACTION_TYPES = ["diagnostics.collect", "inventory.collect"] as const;
export type ReadonlyDispatchActionType = (typeof READONLY_DISPATCH_ACTION_TYPES)[number];

export function isReadonlyDispatchActionType(actionType: string): boolean {
  return (READONLY_DISPATCH_ACTION_TYPES as readonly string[]).includes(actionType);
}

export const PRIVILEGED_DISPATCH_ACTION_TYPES = [
  "organization.join.issue",
  "organization.join.import",
] as const;

export function isPrivilegedDispatchActionType(actionType: string): boolean {
  return (PRIVILEGED_DISPATCH_ACTION_TYPES as readonly string[]).includes(actionType);
}

export function isDispatchActionType(actionType: string): boolean {
  return isReadonlyDispatchActionType(actionType) || isPrivilegedDispatchActionType(actionType);
}

// ── Dispatch lifecycle (the execution axis, distinct from approvalState) ──────
export const REMOTE_ACTION_DISPATCH_STATES = [
  "queued", // approved + waiting to be claimed by an in-scope node
  "claimed", // a node has taken it (single-claim)
  "running", // the node reported it started
  "succeeded",
  "failed",
  "timed-out", // claimed/running but never reached a terminal report in time
] as const;
export type RemoteActionDispatchState = (typeof REMOTE_ACTION_DISPATCH_STATES)[number];

const ALLOWED_DISPATCH_TRANSITIONS: Record<RemoteActionDispatchState, readonly RemoteActionDispatchState[]> = {
  queued: ["claimed", "timed-out"],
  // A node may report the outcome straight from `claimed` (claim → run → report)
  // — `running` is an optional heartbeat, not a required step for a quick
  // read-only collect.
  claimed: ["running", "succeeded", "failed", "timed-out"],
  running: ["succeeded", "failed", "timed-out"],
  succeeded: [],
  failed: [],
  "timed-out": [],
};

/** Guard the dispatch state machine — refuses an illegal transition (e.g.
 *  queued→succeeded, or any move out of a terminal state). */
export function canTransitionDispatch(
  from: RemoteActionDispatchState,
  to: RemoteActionDispatchState,
): boolean {
  return ALLOWED_DISPATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * How long a claimed/running action may sit without a terminal report before it
 * is timed out (so a node that claims-then-dies cannot wedge the queue). A
 * read-only diagnostics collect should finish in seconds; 10 min is generous.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

// ── Claim eligibility ─────────────────────────────────────────────────────────

export interface DispatchableActionView {
  actionKey: string;
  actionType: string;
  /** read-only | low | medium | high | destructive. */
  riskClass: string;
  /** proposed | approved | rejected | cancelled. */
  approvalState: string;
  /** queued | claimed | running | … (the dispatch state). */
  status: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  /** When pre-bound to a specific node; null = any in-scope node may claim. */
  edgeNodeId: string | null;
  /** Privileged actions are re-authorized against the current CR at claim time. */
  changeRequestApproved?: boolean;
}

export interface ClaimingNodeView {
  edgeNodeId: string;
  /** Stable external node id embedded in the signed machine-bound envelope. */
  nodeId: string;
  /** Must be "trusted" to claim. */
  trustState: string;
  /** The node's estate scope. null = the org's own (internal) estate. */
  customerAccountId: string | null;
  customerSiteId: string | null;
  /** Whether the action.execute capability is enabled for this node (default off). */
  actionExecuteEnabled: boolean;
  /** Explicit per-node action allowlist from the approved scope policy. */
  allowedActionTypes: readonly string[];
  /** Host-local authority/member posture reported by the native Edge capability. */
  organizationTrustRole: "authority" | "member" | null;
}

export interface ClaimDecision {
  claimable: boolean;
  reason?: string;
}

/**
 * Scope match — a node acts ONLY within its own estate. This is the single line
 * that keeps the IT-MSP scenario tenant-safe: an internal node (null scope) claims
 * only internal actions; a customer-scoped node claims only that customer's (and,
 * when the action names a site, only that site). A pre-bound action is claimable
 * only by its bound node.
 */
export function nodeScopeMatchesAction(node: ClaimingNodeView, action: DispatchableActionView): boolean {
  if (action.edgeNodeId && action.edgeNodeId !== node.edgeNodeId) return false;
  if ((action.customerAccountId ?? null) !== (node.customerAccountId ?? null)) return false;
  // A site-scoped action requires the claiming node to be that same site.
  if (action.customerSiteId && action.customerSiteId !== node.customerSiteId) return false;
  return true;
}

/**
 * The one gate every claim funnels through. Order matters only for the reason
 * string; all conditions must hold. Read-only is checked two ways (riskClass AND
 * the actionType allow-list) so a mislabeled row cannot slip a mutation through.
 */
export function isClaimableByNode(action: DispatchableActionView, node: ClaimingNodeView): ClaimDecision {
  if (node.trustState !== "trusted") return { claimable: false, reason: "node-not-trusted" };
  if (!node.actionExecuteEnabled) return { claimable: false, reason: "action-execute-capability-disabled" };
  if (action.status !== "queued") return { claimable: false, reason: `action-not-queued (${action.status})` };
  if (action.approvalState !== "approved") return { claimable: false, reason: `action-not-approved (${action.approvalState})` };
  if (isReadonlyDispatchActionType(action.actionType)) {
    if (action.riskClass !== "read-only") return { claimable: false, reason: "mutating-action-gated-to-P3" };
  } else if (isPrivilegedDispatchActionType(action.actionType)) {
    if (action.riskClass !== "high") return { claimable: false, reason: "privileged-action-risk-class-invalid" };
    if (!action.edgeNodeId) return { claimable: false, reason: "privileged-action-must-be-machine-bound" };
    if (!action.changeRequestApproved) return { claimable: false, reason: "approved-change-request-required" };
    const requiredRole = action.actionType === "organization.join.issue" ? "authority" : "member";
    if (node.organizationTrustRole !== requiredRole) {
      return { claimable: false, reason: "wrong-organization-trust-role" };
    }
  } else {
    return { claimable: false, reason: `actionType-not-in-dispatch-allowlist (${action.actionType})` };
  }
  if (!node.allowedActionTypes.includes(action.actionType)) {
    return { claimable: false, reason: `actionType-not-allowed-for-node (${action.actionType})` };
  }
  if (!nodeScopeMatchesAction(node, action)) return { claimable: false, reason: "out-of-estate-scope" };
  return { claimable: true };
}

/** The pull answer: the subset of queued actions this node may claim now. */
export function claimableActionsForNode(
  node: ClaimingNodeView,
  actions: DispatchableActionView[],
): DispatchableActionView[] {
  return actions.filter((a) => isClaimableByNode(a, node).claimable);
}
