import {
  advanceQualificationExperimentState,
  issueQualificationExperimentState,
  parseQualificationExperimentState,
  verifyQualificationExperimentAdmission,
  type QualificationExperimentState,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";

type QualificationRoom = {
  capsuleId: string; backlogItemId: string | null; repositoryFullName: string | null;
  baseSha: string | null; headSha: string | null; workspaceState: unknown;
};

export function qualificationStateForScopeClaim(args: {
  room: QualificationRoom; token: string; accountablePrincipalRef: string | null; now?: Date;
}): { state: QualificationExperimentState; workspaceState: Record<string, unknown> } {
  const workspaceState = args.room.workspaceState && typeof args.room.workspaceState === "object"
    && !Array.isArray(args.room.workspaceState) ? args.room.workspaceState as Record<string, unknown> : {};
  const verified = verifyQualificationExperimentAdmission(args.token, { now: args.now });
  if (!verified.ok) throw new Error(verified.error);
  const binding = verified.data.binding;
  if (binding.workroomId !== args.room.capsuleId || binding.itemId !== args.room.backlogItemId
    || binding.repositoryFullName !== args.room.repositoryFullName
    || binding.baseSha.toLowerCase() !== args.room.baseSha?.toLowerCase()
    || binding.headSha.toLowerCase() !== args.room.headSha?.toLowerCase()
    || binding.accountablePrincipalRef !== args.accountablePrincipalRef) {
    throw new Error("Qualification admission does not match the live Workroom identity.");
  }
  const existingRaw = workspaceState.qualificationExperimentAdmission;
  const existing = parseQualificationExperimentState(existingRaw);
  if (existingRaw !== undefined && !existing) {
    throw new Error("Existing qualification admission state is unreadable and cannot be replaced.");
  }
  let issued = issueQualificationExperimentState({ existing, token: args.token, binding });
  if (!issued.ok && existing?.status === "settled" && binding.phase === "verify") {
    const prior = verifyQualificationExperimentAdmission(existing.token, { now: args.now, allowExpired: true });
    if (!prior.ok) throw new Error(prior.error);
    issued = advanceQualificationExperimentState({ existing, existingBinding: prior.data.binding,
      token: args.token, binding });
  }
  if (!issued.ok) throw new Error(issued.error);
  const state = binding.executorMode === "workroom-host"
    ? { ...issued.data, status: "started" as const, startCount: 1 as const,
      startedAt: (args.now ?? new Date()).toISOString(), taskId: `workroom-host:${args.room.capsuleId}` }
    : issued.data;
  return { state, workspaceState };
}
