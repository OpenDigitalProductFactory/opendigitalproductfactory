// apps/web/lib/tak/coordinator-authority.ts
//
// BI-80ADD3A8: the COO as standing coordinator on every coworker surface.
//
// Founder-directed (2026-08-15, reaffirmed 2026-08-16): the COO handles
// coordination; specialists do the work. The ratified persona contract
// (2026-07-18, BI-7D29937E) bounds the shape: the COO is a ROLE and a
// coordinator — presentation label and router — never the accountable byline,
// which stays with the authenticated (human × client × session) triple.
//
// The structural blocker this module removes: isHandoffPermitted honours only
// an agent's DIRECT delegatesTo/escalatesTo, and the registry is a management
// TREE — 71 agents, only 7 of which escalate directly to the COO. A finance
// specialist escalating a cross-cutting question to the coordinator would be
// DENIED by its own org chart. Editing 71 seed rows would flatten the
// management chain and not survive re-seed (registry values are seed
// snapshots); a standing-target rule is one governed, auditable decision.
//
// Deliberate asymmetry: the coordinator is always a permitted TARGET — any
// coworker may hand a thread UP to coordination — but never an implicit
// SOURCE. The COO delegating outward still uses its declared delegatesTo, and
// every hop still records a DelegationChain row. The convene clearance clamp
// (escalation-ladder spec §4a/§4b) is NOT bypassed: reaching the coordinator
// still requires the asking human's clearance to cover the COO's
// classification.

/**
 * The standing coordinator's identifiers (canonical agentId + slug alias).
 * One role by design — the ratified contract's role-only identity. If a
 * per-install coordinator override ever ships, it must remain ONE role, not a
 * list of privileged targets, or "coordinator" degrades into a bypass set.
 */
export const STANDING_COORDINATOR_IDS: readonly string[] = ["AGT-ORCH-000", "coo"];

/** True when any of the target's identifiers name the standing coordinator. */
export function isCoordinatorTarget(targetIds: readonly string[]): boolean {
  return targetIds.some((id) => STANDING_COORDINATOR_IDS.includes(id));
}
