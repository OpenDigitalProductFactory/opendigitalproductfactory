// Coordination authority, derived from the work shapes and materialized as
// explicit bindings (BI-E0728215).
//
// The kernel's verdict (DI-F8C8042FBB5D, margin 9.318) was that coordination
// authority must come from an EXPLICIT binding — not from an agent's route
// access, and not from the work shape asserting its own authority. The
// distinction that matters is not where the *proposal* comes from but what the
// grant IS: a row an operator can see, suspend and revoke.
//
// So the shape PROPOSES and the binding GRANTS. This mirrors the platform's own
// precedent exactly: bootstrapAuthorityBindings derives route bindings from
// ROUTE_AGENT_MAP_ENTRIES and materializes them as explicit rows. Same shape of
// solution, different scope.
//
// Pure planning; the caller writes.

import {
  COORDINATION_RESOURCE_TYPE,
  COORDINATION_SCOPE_TYPE,
} from "@/lib/work-management/coordinator-eligibility";
import { resolveRoomOwner } from "@/lib/work-management/room-owner-ladder";
import { STANDING_SHAPES } from "@/lib/work-management/standing-operations-shapes";

export type CoordinationBindingPlan = {
  bindingId: string;
  name: string;
  scopeType: string;
  resourceType: string;
  resourceRef: string;
  status: string;
  approvalMode: string;
  /** The agent slug this binding grants coordination to. */
  agentId: string;
  subjects: Array<{ subjectType: string; subjectRef: string; relation: string }>;
};

export function coordinationBindingId(shapeKey: string, agentId: string): string {
  return `AB-WORKROOM-${shapeKey.toUpperCase()}-${agentId.toUpperCase()}`;
}

/**
 * One coordination binding per standing shape that names a single driver.
 *
 * The driver comes from the ownership ladder's shape rung, which already
 * excludes the stage holding the governed decision — so a binding never grants
 * coordination to the room's own approver, and `coordinator_approver_overlap`
 * cannot be introduced by seeding.
 *
 * A shape whose executing stages disagree resolves no driver and gets no
 * binding. That room reports its overseer as `absent` and waits for a human,
 * which is the correct outcome for a shape that has not said who drives.
 *
 * Seeded `active`: this grants PROCESS coordination — sequencing a room's own
 * stages toward its outcome. It authorizes no outbound or irreversible act; a
 * stage advancing by governed-decision still requires its separate approver, and
 * conformance still refuses coordinator/approver overlap. Revoking is one status
 * change on a visible row.
 */
export function planCoordinationBindings(
  shapes: Record<string, { key: string; stages: readonly unknown[] }> = STANDING_SHAPES as never,
): CoordinationBindingPlan[] {
  const plans: CoordinationBindingPlan[] = [];
  for (const shape of Object.values(shapes)) {
    const owner = resolveRoomOwner({
      explicitPrincipalRef: null,
      shape: shape as never,
      archetypePrincipalRef: null,
    });
    if (!owner || owner.source !== "shape") continue;
    // The ladder yields "agent:<slug>"; a role: or person: driver is not an AI
    // overseer and needs no AI authority binding.
    if (!owner.principalRef.startsWith("agent:")) continue;
    const agentId = owner.principalRef.slice("agent:".length);
    plans.push({
      bindingId: coordinationBindingId(shape.key, agentId),
      name: `${agentId} coordinates ${shape.key}`,
      scopeType: COORDINATION_SCOPE_TYPE,
      resourceType: COORDINATION_RESOURCE_TYPE,
      resourceRef: shape.key,
      status: "active",
      approvalMode: "none",
      agentId,
      subjects: [{ subjectType: "agent", subjectRef: agentId, relation: "coordinates" }],
    });
  }
  return plans.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}
