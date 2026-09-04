import type { ActiveViewer } from "./work-item-presence";
import { deriveRoomCoordinator } from "./room-coordinator";
import type {
  WorkroomParticipantAssignmentSource,
  WorkroomParticipantRole,
  WorkroomParticipantView,
} from "./room-types";

export const WORKROOM_ACCESS_LEVELS = ["none", "discover", "content", "action"] as const;
export type WorkroomAccessLevel = (typeof WORKROOM_ACCESS_LEVELS)[number];

const SENSITIVITY_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 3,
};

export type WorkroomAccessDecision = {
  level: WorkroomAccessLevel;
  reason: "authorized" | "discover-only" | "not-admitted" | "insufficient-clearance";
};

export type WorkroomDiscoveryField = "title" | "outcome" | "mode";

export function projectWorkroomDiscovery(input: {
  decision: WorkroomAccessDecision;
  allowedFields: readonly WorkroomDiscoveryField[];
  metadata: { title: string; outcome: string | null; mode: "finite" | "standing" };
}) {
  if (input.decision.level === "none") return null;
  const visible = new Set(input.allowedFields);
  return {
    accessLevel: input.decision.level,
    title: visible.has("title") ? input.metadata.title : null,
    outcome: visible.has("outcome") ? input.metadata.outcome : null,
    mode: visible.has("mode") ? input.metadata.mode : null,
  };
}

export function authorizeWorkroomAccess(input: {
  requested: Exclude<WorkroomAccessLevel, "none">;
  principalRef: string | null;
  assignedPrincipalRefs: readonly string[];
  discoverablePrincipalRefs?: readonly string[];
  presentPrincipalRefs?: readonly string[];
  sensitivityCeiling: string | null;
  sensitivityClearance: readonly string[];
  isSuperuser: boolean;
  /**
   * BI-154DAA7E: the superuser short-circuit is a HUMAN affordance — the
   * installation owner bypassing ceiling checks on their own install. An AI
   * principal must never ride it: a coworker provisioned as "superuser" would
   * void every room-side clearance guarantee in one flag. Callers on the agent
   * path pass "agent" and the short-circuit is refused regardless of
   * isSuperuser; omitting the field preserves the human behaviour unchanged.
   */
  principalKind?: "human" | "agent";
}): WorkroomAccessDecision {
  if (input.isSuperuser && input.principalKind !== "agent") {
    return { level: input.requested, reason: "authorized" };
  }
  if (!input.principalRef) return { level: "none", reason: "not-admitted" };

  const admitted = input.assignedPrincipalRefs.includes(input.principalRef);
  const discoverable = input.discoverablePrincipalRefs?.includes(input.principalRef) ?? false;
  // Presence is deliberately ignored here. Being visible in a room never grants
  // discovery, content, or action authority.
  void input.presentPrincipalRefs;

  if (!admitted) {
    return discoverable
      ? { level: "discover", reason: "discover-only" }
      : { level: "none", reason: "not-admitted" };
  }

  const required = SENSITIVITY_RANK[input.sensitivityCeiling ?? "public"] ?? Number.MAX_SAFE_INTEGER;
  const clearance = Math.max(
    -1,
    ...input.sensitivityClearance.map((value) => SENSITIVITY_RANK[value] ?? -1),
  );
  if (clearance < required) {
    return { level: "discover", reason: "insufficient-clearance" };
  }

  return { level: input.requested, reason: "authorized" };
}

export type WorkroomParticipantAssignment = {
  principalRef: string;
  displayName: string;
  kind: WorkroomParticipantView["kind"];
  roles: WorkroomParticipantRole[];
  currentWorkSummary: string | null;
  enteredReason: string | null;
  sponsorPrincipalRef: string | null;
  sponsorDisplayName?: string | null;
  authoritySummary: string;
  assignmentSource: Exclude<WorkroomParticipantAssignmentSource, "conversation">;
};

export type WorkroomConversationParticipant = Omit<
  WorkroomParticipantView,
  "kind" | "presence" | "sourceRefs" | "assignmentSource" | "coordinatorSource"
> & {
  sourceRef: WorkroomParticipantView["sourceRefs"][number];
};

export function projectWorkroomParticipants(input: {
  assignments: readonly WorkroomParticipantAssignment[];
  conversationParticipants: readonly WorkroomConversationParticipant[];
  presence: readonly ActiveViewer[];
}): WorkroomParticipantView[] {
  const active = new Set(input.presence.map((viewer) => viewer.principalId));
  const projected = new Map<string, WorkroomParticipantView>();

  for (const assignment of input.assignments) {
    const existing = projected.get(assignment.principalRef);
    const currentWorkSummary = assignment.currentWorkSummary ?? existing?.currentWorkSummary ?? null;
    const roles = existing
      ? [...new Set([...existing.roles, ...assignment.roles])]
      : assignment.roles;
    projected.set(assignment.principalRef, {
      ...assignment,
      roles,
      currentWorkSummary,
      enteredReason: assignment.enteredReason ?? existing?.enteredReason ?? null,
      sponsorPrincipalRef: assignment.sponsorPrincipalRef ?? existing?.sponsorPrincipalRef ?? null,
      sponsorDisplayName: assignment.sponsorDisplayName ?? existing?.sponsorDisplayName ?? null,
      workState: currentWorkSummary ? "working" : "unknown",
      presence: active.has(assignment.principalRef) ? "active" : "unknown",
      sourceRefs: [
        ...(existing?.sourceRefs ?? []),
        { kind: "evidence", id: assignment.principalRef, sourceType: "principal" },
      ],
      assignmentSource: assignment.assignmentSource,
      coordinatorSource: roles.includes("coordinator") ? "explicit" : "none",
    });
  }

  for (const participant of input.conversationParticipants) {
    const existing = projected.get(participant.principalRef);
    const roles = existing
      ? [...new Set([...existing.roles, ...participant.roles])]
      : participant.roles;
    projected.set(participant.principalRef, {
      principalRef: participant.principalRef,
      displayName: participant.displayName,
      kind: "agent",
      roles,
      workState: participant.workState,
      presence: active.has(participant.principalRef) ? "active" : "unknown",
      currentWorkSummary: participant.currentWorkSummary,
      enteredReason: participant.enteredReason,
      sponsorPrincipalRef: participant.sponsorPrincipalRef,
      sponsorDisplayName: participant.sponsorDisplayName,
      authoritySummary: participant.authoritySummary,
      sourceRefs: [
        ...(existing?.sourceRefs ?? []),
        participant.sourceRef,
      ],
      assignmentSource: existing?.assignmentSource ?? "conversation",
      coordinatorSource: existing?.coordinatorSource ?? "none",
    });
  }

  // EP-WORKROOM-COMMS (BI-5A7BC4B3): ensure the room has a single Coordinator —
  // kept if named by policy/lineage, otherwise the accountable principal by default.
  return deriveRoomCoordinator([...projected.values()]);
}
