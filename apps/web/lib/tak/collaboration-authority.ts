// apps/web/lib/tak/collaboration-authority.ts
//
// EP-A2A Slice 2 — agent-to-agent delegation authority for coworker-initiated
// handoffs. The existing delegation-authority.ts enforces capability
// propagation, loop detection, and depth, but does NOT consult an agent's
// declared delegatesTo / escalatesTo lists — this module adds exactly that
// gate. Pure decision (no IO) so it is unit-testable; the DelegationChain hop
// write lives in coworker-collaboration.ts.

/**
 * Whether `caller` is permitted to hand off / escalate to a target.
 *
 * @param delegatesTo  Agent.delegatesTo (canonical agentIds or slugs).
 * @param escalatesTo  Agent.escalatesTo (a single agentId/slug/HR role, or null).
 * @param targetIds    The target agent's identifiers to test (agentId + slugId).
 * @param standingCoordinatorIds  BI-80ADD3A8: identifiers of the platform's ONE
 *   standing coordinator role (the COO). A target in this set is always a
 *   permitted ESCALATION TARGET — the registry is a management tree and only 7
 *   of 71 agents escalate directly to the COO, so without this rule the
 *   founder-directed "COO handles coordination" is structurally unreachable
 *   from most surfaces. Target-only by design: this widens who may be handed
 *   TO, never what the caller may otherwise do, and the hop is still recorded
 *   on the DelegationChain and still subject to the convene clearance clamp.
 *
 * An empty delegatesTo with no escalatesTo means the agent has declared no
 * delegation authority, so any handoff is denied (fail-closed) — the caller
 * must be explicitly permitted, with the single standing-coordinator exception
 * above: coordination must be reachable precisely when an agent's own chain
 * has no answer.
 */
export function isHandoffPermitted(opts: {
  delegatesTo: readonly string[];
  escalatesTo: string | null;
  targetIds: readonly string[];
  standingCoordinatorIds?: readonly string[];
}): boolean {
  if (opts.standingCoordinatorIds?.some((id) => opts.targetIds.includes(id))) {
    return true;
  }
  const allowed = new Set<string>([
    ...opts.delegatesTo,
    ...(opts.escalatesTo ? [opts.escalatesTo] : []),
  ]);
  return opts.targetIds.some((id) => allowed.has(id));
}
