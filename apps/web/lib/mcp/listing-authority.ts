// tools/list ⇄ tools/call authority parity for agent-bound MCP tokens
// (BI-HDLEMP-04, EP-HEADLESS-EMPLOYEE).
//
// The MCP route filters tools/list by TOKEN scope only (tokenCanUseTool), but
// tools/call additionally runs the coworker-authority gate whenever the token
// is agent-bound (governedExecuteTool → evaluateCoworkerAuthority). Two of that
// gate's checks are STATIC properties of the (human, agent) pair — not of the
// per-call arguments — so a faithful list must apply them or it advertises
// tools the call layer rejects:
//
//   1. Agent grant  — evaluateCoworkerAuthority denies `agent-grant-denied`
//      when the acting agent's grants don't cover the tool. The list must drop
//      those tools (the "list/call skew" hole).
//   2. Clearance    — it denies `sensitivity-clearance-denied` when the acting
//      human's Principal.sensitivityClearance does NOT include the agent's data
//      sensitivity. That comparison is UNIFORM across every tool (the data
//      sensitivity is the agent's, not the tool's), so when it fails EVERY
//      agent-bound tool is un-callable and the list must be empty.
//
// Per-invocation gate axes (route-scope, subject-scope, approval/HITL) are NOT
// applied here: they depend on the call's arguments/route, and an
// approval-required tool is still listable (it is callable *after* approval).
//
// Clearance stays DISTINCT from role (spec §7): role → User.groups→PlatformRole
// (the token-scope/capability layer); clearance → Principal.sensitivityClearance
// (this layer). This module never consults role, and the caller never folds
// clearance into role.
//
// Pure decision (isAgentToolListable) + a thin dependency-injected resolver
// (resolveListingAuthority); both are unit-tested. The route wires the real
// grant/sensitivity/clearance loaders in.

import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";

/** The static, per-(human,agent) authority facts a faithful tools/list needs. */
export type ListingAuthority =
  /** Token is NOT agent-bound: tools/call skips the coworker-authority gate, so
   *  the token-scope filter already IS the whole authority — no extra filter. */
  | { agentBound: false }
  /** Agent-bound but nothing is callable: the acting agent could not be resolved
   *  to an active identity (call path → authority_evidence_unavailable) OR the
   *  human's clearance does not cover the agent's data sensitivity (call path →
   *  sensitivity-clearance-denied). Either way EVERY agent-bound tool is denied. */
  | { agentBound: true; blanketDeny: true }
  /** Agent-bound and clearance-satisfied: filter each tool by the agent's grants. */
  | { agentBound: true; blanketDeny: false; agentGrants: string[] };

/**
 * Would the coworker-authority gate's STATIC axes admit `toolName` for listing?
 * Pure — mirrors the `agent-grant-denied` / `sensitivity-clearance-denied`
 * branches of evaluateCoworkerAuthority. `isAllowedByGrants` is the SAME
 * predicate the call path uses (tak/agent-grants → isToolAllowedByGrants), so
 * the list and the call never diverge on grant expansion.
 */
export function isAgentToolListable(
  toolName: string,
  authority: ListingAuthority,
  isAllowedByGrants: (name: string, grants: string[]) => boolean,
): boolean {
  if (!authority.agentBound) return true;
  if (authority.blanketDeny) return false;
  return isAllowedByGrants(toolName, authority.agentGrants);
}

export type ResolveListingAuthorityDeps = {
  /** The acting agent's raw tool grants (tak/agent-grants → getAgentToolGrantsAsync). */
  resolveAgentGrants: (agentId: string) => Promise<string[]>;
  /** The acting agent's stored `sensitivity`, or null when the agent cannot be
   *  resolved to an active, non-archived identity (parity with the call path,
   *  which throws → authority_evidence_unavailable in that case). */
  resolveAgentSensitivity: (agentId: string) => Promise<string | null>;
  /** The acting human's Principal.sensitivityClearance (already normalized). */
  resolveHumanClearance: () => Promise<readonly string[]>;
};

/**
 * Resolve the static authority facts for a token's tools/list. A non-agent-bound
 * token short-circuits to `{ agentBound: false }` with no DB work. An agent-bound
 * token resolves grants + agent sensitivity + human clearance concurrently and
 * collapses an unresolvable agent or an uncovered sensitivity to a blanket deny.
 */
export async function resolveListingAuthority(
  token: { agentId: string | null },
  deps: ResolveListingAuthorityDeps,
): Promise<ListingAuthority> {
  if (!token.agentId) return { agentBound: false };

  const [agentGrants, agentSensitivity, humanClearance] = await Promise.all([
    deps.resolveAgentGrants(token.agentId),
    deps.resolveAgentSensitivity(token.agentId),
    deps.resolveHumanClearance(),
  ]);

  if (agentSensitivity === null) {
    // Agent could not be verified → the call path denies every action.
    return { agentBound: true, blanketDeny: true };
  }
  const dataSensitivity = coerceDataSensitivity(agentSensitivity);
  if (!humanClearance.includes(dataSensitivity)) {
    return { agentBound: true, blanketDeny: true };
  }
  return { agentBound: true, blanketDeny: false, agentGrants };
}
