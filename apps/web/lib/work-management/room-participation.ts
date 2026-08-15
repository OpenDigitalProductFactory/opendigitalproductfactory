import type { ActiveViewer } from "./work-item-presence";
import { deriveRoomCoordinator } from "./room-coordinator";
import type {
  WorkRoomParticipantRole,
  WorkRoomParticipantView,
} from "./room-types";

export const WORK_ROOM_ACCESS_LEVELS = ["none", "discover", "content", "action"] as const;
export type WorkRoomAccessLevel = (typeof WORK_ROOM_ACCESS_LEVELS)[number];

const SENSITIVITY_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 3,
};

export type WorkRoomAccessDecision = {
  level: WorkRoomAccessLevel;
  reason: "authorized" | "discover-only" | "not-admitted" | "insufficient-clearance";
};

export type WorkRoomDiscoveryField = "title" | "outcome" | "mode";

export function projectWorkRoomDiscovery(input: {
  decision: WorkRoomAccessDecision;
  allowedFields: readonly WorkRoomDiscoveryField[];
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

export function authorizeWorkRoomAccess(input: {
  requested: Exclude<WorkRoomAccessLevel, "none">;
  principalRef: string | null;
  assignedPrincipalRefs: readonly string[];
  discoverablePrincipalRefs?: readonly string[];
  presentPrincipalRefs?: readonly string[];
  sensitivityCeiling: string | null;
  sensitivityClearance: readonly string[];
  isSuperuser: boolean;
}): WorkRoomAccessDecision {
  if (input.isSuperuser) return { level: input.requested, reason: "authorized" };
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

export type WorkRoomParticipantAssignment = {
  principalRef: string;
  displayName: string;
  kind: WorkRoomParticipantView["kind"];
  roles: WorkRoomParticipantRole[];
  currentWorkSummary: string | null;
  enteredReason: string | null;
  sponsorPrincipalRef: string | null;
  sponsorDisplayName?: string | null;
  authoritySummary: string;
};

export type WorkRoomConversationParticipant = Omit<
  WorkRoomParticipantView,
  "kind" | "presence" | "sourceRefs"
> & {
  sourceRef: WorkRoomParticipantView["sourceRefs"][number];
};

export function projectWorkRoomParticipants(input: {
  assignments: readonly WorkRoomParticipantAssignment[];
  conversationParticipants: readonly WorkRoomConversationParticipant[];
  presence: readonly ActiveViewer[];
}): WorkRoomParticipantView[] {
  const active = new Set(input.presence.map((viewer) => viewer.principalId));
  const projected = new Map<string, WorkRoomParticipantView>();

  for (const assignment of input.assignments) {
    const existing = projected.get(assignment.principalRef);
    const currentWorkSummary = assignment.currentWorkSummary ?? existing?.currentWorkSummary ?? null;
    projected.set(assignment.principalRef, {
      ...assignment,
      roles: existing
        ? [...new Set([...existing.roles, ...assignment.roles])]
        : assignment.roles,
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
    });
  }

  for (const participant of input.conversationParticipants) {
    const existing = projected.get(participant.principalRef);
    projected.set(participant.principalRef, {
      principalRef: participant.principalRef,
      displayName: participant.displayName,
      kind: "agent",
      roles: existing
        ? [...new Set([...existing.roles, ...participant.roles])]
        : participant.roles,
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
    });
  }

  // EP-WORKROOM-COMMS (BI-5A7BC4B3): ensure the room has a single Coordinator —
  // kept if named by policy/lineage, otherwise the accountable principal by default.
  return deriveRoomCoordinator([...projected.values()]);
}
