import {
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
  // Do not consume the one start merely because a historical signed token is
  // structurally valid. No current executor emits an independently observed
  // receipt bound to this source/test/platform identity.
  throw new Error("Qualification execution is unavailable until exact executor provenance is bound.");
}
