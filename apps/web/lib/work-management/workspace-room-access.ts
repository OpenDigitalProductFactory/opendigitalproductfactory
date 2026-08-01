import { authorizeWorkRoomAccess, type WorkRoomAccessDecision } from "./room-participation";

export type WorkspaceRoomPolicyMetadata = {
  admittedPrincipalRefs: string[];
  discoverablePrincipalRefs: string[];
  actionPrincipalRefs: string[];
  sensitivityCeiling: string;
};

export function readWorkspaceRoomPolicy(evidence: unknown): Partial<WorkspaceRoomPolicyMetadata> {
  const values = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const policy = (value as Record<string, unknown>).workRoomPolicy;
    if (!policy || typeof policy !== "object") continue;
    const record = policy as Record<string, unknown>;
    const strings = (key: string) => Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      admittedPrincipalRefs: strings("admittedPrincipalRefs"),
      discoverablePrincipalRefs: strings("discoverablePrincipalRefs"),
      actionPrincipalRefs: strings("actionPrincipalRefs"),
      sensitivityCeiling: typeof record.sensitivityCeiling === "string"
        ? record.sensitivityCeiling
        : "internal",
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
}): WorkRoomAccessDecision {
  const policy = readWorkspaceRoomPolicy(input.item.evidence);
  const principalId = input.authContext?.principalId ?? `user:${input.userId}`;
  const assignedToCurrentUser = input.item.assignedToUserId === input.userId;
  const legacyUnassignedContent = input.item.assignedToUserId === null && input.requested !== "action";
  const policyRefs = input.requested === "action"
    ? policy.actionPrincipalRefs ?? []
    : policy.admittedPrincipalRefs ?? [];

  return authorizeWorkRoomAccess({
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
