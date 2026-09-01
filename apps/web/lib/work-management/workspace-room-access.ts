import { authorizeWorkroomAccess, type WorkroomAccessDecision } from "./room-participation";
import { WORKROOM_PARTICIPANT_ROLES, type WorkroomParticipantRole } from "./room-types";

export type WorkspaceRoomPolicyMetadata = {
  admittedPrincipalRefs: string[];
  discoverablePrincipalRefs: string[];
  actionPrincipalRefs: string[];
  sensitivityCeiling: string;
  participants: WorkspaceRoomPolicyParticipant[];
};

export type WorkspaceRoomPolicyParticipant = {
  principalRef: string;
  roles: WorkroomParticipantRole[];
  enteredReason: string | null;
  currentWorkSummary: string | null;
};

export function readWorkspaceRoomPolicy(evidence: unknown): Partial<WorkspaceRoomPolicyMetadata> {
  const values = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  // Evidence is append-oriented. The latest explicit policy supersedes an
  // earlier snapshot; reading the first would preserve stale authority.
  for (const value of [...values].reverse()) {
    if (!value || typeof value !== "object") continue;
    const policy = (value as Record<string, unknown>).workroomPolicy;
    if (!policy || typeof policy !== "object") continue;
    const record = policy as Record<string, unknown>;
    const strings = (key: string) => Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    const participants = Array.isArray(record.participants)
      ? record.participants.flatMap((entry): WorkspaceRoomPolicyParticipant[] => {
          if (!entry || typeof entry !== "object") return [];
          const participant = entry as Record<string, unknown>;
          const principalRef = typeof participant.principalRef === "string"
            ? participant.principalRef.trim()
            : "";
          if (!principalRef) return [];
          const roles = Array.isArray(participant.roles)
            ? participant.roles.filter(
                (role): role is WorkroomParticipantRole =>
                  typeof role === "string" && (WORKROOM_PARTICIPANT_ROLES as readonly string[]).includes(role),
              )
            : [];
          return [{
            principalRef,
            roles: roles.length > 0 ? roles : ["observer"],
            enteredReason: typeof participant.enteredReason === "string"
              ? participant.enteredReason.trim() || null
              : null,
            currentWorkSummary: typeof participant.currentWorkSummary === "string"
              ? participant.currentWorkSummary.trim() || null
              : null,
          }];
        })
      : [];
    return {
      admittedPrincipalRefs: strings("admittedPrincipalRefs"),
      discoverablePrincipalRefs: strings("discoverablePrincipalRefs"),
      actionPrincipalRefs: strings("actionPrincipalRefs"),
      sensitivityCeiling: typeof record.sensitivityCeiling === "string"
        ? record.sensitivityCeiling
        : "internal",
      participants,
    };
  }
  return {};
}

export function authorizeWorkspaceRoomItem(input: {
  requested: "discover" | "content" | "action";
  item: { assignedToUserId: string | null; evidence?: unknown };
  userId: string;
  authContext?: {
    principalId: string | null;
    sensitivityClearance: readonly string[];
    isSuperuser: boolean;
  };
}): WorkroomAccessDecision {
  const policy = readWorkspaceRoomPolicy(input.item.evidence);
  const principalId = input.authContext?.principalId ?? `user:${input.userId}`;
  const assignedToCurrentUser = input.item.assignedToUserId === input.userId;
  const legacyUnassignedContent = input.item.assignedToUserId === null && input.requested !== "action";
  const policyRefs = input.requested === "action"
    ? policy.actionPrincipalRefs ?? []
    : policy.admittedPrincipalRefs ?? [];

  return authorizeWorkroomAccess({
    requested: input.requested,
    principalRef: principalId,
    assignedPrincipalRefs: [
      ...(assignedToCurrentUser || legacyUnassignedContent ? [principalId] : []),
      ...policyRefs,
    ],
    discoverablePrincipalRefs: policy.discoverablePrincipalRefs ?? [],
    sensitivityCeiling: policy.sensitivityCeiling ?? "internal",
    sensitivityClearance: input.authContext?.sensitivityClearance ?? ["public", "internal"],
    isSuperuser: input.authContext?.isSuperuser ?? false,
  });
}
