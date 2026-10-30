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
  const workspaceState = args.room.workspaceState && typeof args.room.workspaceState === "object"
    && !Array.isArray(args.room.workspaceState) ? args.room.workspaceState as Record<string, unknown> : {};
  const existing = parseQualificationExperimentState(workspaceState.qualificationExperimentAdmission);
  const state = existing
    ? (() => {
        const prior = verifyQualificationExperimentAdmission(existing.token, { now: args.now, allowExpired: true });
        if (!prior.ok) throw new Error("Existing qualification admission cannot be reconciled.");
        const advanced = advanceQualificationExperimentState({ existing, existingBinding: prior.data.binding,
          token: args.token, binding });
        if (!advanced.ok) throw new Error(advanced.error);
        return advanced.data;
      })()
    : (() => {
        const issued = issueQualificationExperimentState({ existing: null, token: args.token, binding });
        if (!issued.ok) throw new Error(issued.error);
        return issued.data;
      })();
  return { state, workspaceState };
}
