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
 *
 * An empty delegatesTo with no escalatesTo means the agent has declared no
 * delegation authority, so any handoff is denied (fail-closed) — the caller
 * must be explicitly permitted.
 */
export function isHandoffPermitted(opts: {
  delegatesTo: readonly string[];
  escalatesTo: string | null;
  targetIds: readonly string[];
}): boolean {
  const allowed = new Set<string>([
    ...opts.delegatesTo,
    ...(opts.escalatesTo ? [opts.escalatesTo] : []),
  ]);
  return opts.targetIds.some((id) => allowed.has(id));
}
