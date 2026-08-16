/**
 * Outcome-scoped Work Room access for AI agents.
 *
 * EP-WORKROOM-COMMS (BI-AD057F18). A room's membership may be all-people,
 * all-agent, or mixed; an agent joins/posts/reads only for THAT room's outcome,
 * scoped by exposure + rights. This reuses the human `authorizeWorkroomAccess`
 * decision (none < discover < content < action) — the ref space is the canonical
 * `Principal.principalId`, and presence never grants authority.
 *
 * Pure module: the server resolver (room-agent-access.server.ts) assembles the ref
 * sets from the room policy + the capsules working the room and calls this.
 *
 * Design of record: docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §1
 */
import {
  authorizeWorkroomAccess,
  type WorkroomAccessDecision,
  type WorkroomAccessLevel,
} from "./room-participation";

export interface AuthorizeAgentRoomAccessInput {
  requested: Exclude<WorkroomAccessLevel, "none">;
  agentPrincipalRef: string | null;
  agentSensitivityClearance: readonly string[];
  /** Principals allowed to READ the room (content): policy-admitted + everyone who can act. */
  admittedPrincipalRefs: readonly string[];
  /** Principals allowed to ACT in the room (post): policy-action + capsule holders + assigned agent. */
  actionPrincipalRefs: readonly string[];
  discoverablePrincipalRefs?: readonly string[];
  sensitivityCeiling: string | null;
  isSuperuser?: boolean;
}

/**
 * Resolve an agent's Work Room access level. `action` is gated by the action set,
 * every lower level by the admitted set — mirroring the human action/content split.
 */
export function authorizeAgentRoomAccess(
  input: AuthorizeAgentRoomAccessInput,
): WorkroomAccessDecision {
  const assignedPrincipalRefs =
    input.requested === "action" ? input.actionPrincipalRefs : input.admittedPrincipalRefs;
  return authorizeWorkroomAccess({
    requested: input.requested,
    principalRef: input.agentPrincipalRef,
    assignedPrincipalRefs,
    discoverablePrincipalRefs: input.discoverablePrincipalRefs ?? [],
    sensitivityCeiling: input.sensitivityCeiling,
    sensitivityClearance: input.agentSensitivityClearance,
    isSuperuser: input.isSuperuser ?? false,
  });
}

/** True when the decision grants at least the requested level (not degraded to discover/none). */
export function grantsRequested(
  decision: WorkroomAccessDecision,
  requested: Exclude<WorkroomAccessLevel, "none">,
): boolean {
  return decision.level === requested;
}
