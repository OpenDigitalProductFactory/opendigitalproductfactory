import { QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";

import { parseQualificationExperimentState } from "@/lib/backlog/initiative-readiness/qualification-research-admission";
import { isRecord } from "@/lib/shared/coerce";

export type QualificationResultDb = {
  remoteAction: { findUnique(args: unknown): Promise<any> };
  workroom: { findUnique(args: unknown): Promise<any>; update(args: unknown): Promise<any> };
  workroomActivity: { create(args: unknown): Promise<any> };
};

export function qualificationOutcome(outcome: "succeeded" | "failed", evidence: unknown):
  "positive" | "negative" | "inconclusive" | "blocked" {
  if (outcome === "failed") return "blocked";
  const report = isRecord(evidence) ? evidence : {};
  const observations = isRecord(report.observations) ? report.observations : {};
  const first = typeof observations.firstReplacement === "string" ? observations.firstReplacement : "";
  const second = typeof observations.secondReplacement === "string" ? observations.secondReplacement : "";
  if (first.startsWith("refused:") && second === "replaced") return "positive";
  if (first === "replaced" && second === "replaced") return "negative";
  return "inconclusive";
}

export async function settleQualificationWindowsResult(input: {
  db: QualificationResultDb;
  actionKey: string;
  edgeNodeRowId: string;
  outcome: "running" | "succeeded" | "failed";
}): Promise<boolean> {
  if (input.outcome === "running") return true;
  const action = await input.db.remoteAction.findUnique({ where: { actionKey: input.actionKey } });
  if (!action) return false;
  if (action.actionType !== QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE) return true;
  if (action.edgeNodeId !== input.edgeNodeRowId || action.status !== input.outcome
    || !isRecord(action.parameters) || !isRecord(action.evidence)) return false;
  const workroomId = typeof action.parameters.workroomId === "string" ? action.parameters.workroomId : null;
  const digest = typeof action.parameters.qualificationBindingDigest === "string"
    ? action.parameters.qualificationBindingDigest : null;
  if (!workroomId || !digest) return false;
  const room = await input.db.workroom.findUnique({ where: { capsuleId: workroomId } });
  if (!room) return false;
  const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
  const state = parseQualificationExperimentState(workspace.qualificationExperimentAdmission);
  if (!state || state.bindingDigest !== digest || state.taskId !== input.actionKey) return false;
  if (state.status === "settled") return Boolean(state.evidenceId);
  if (state.status !== "started") return false;
  const disposition = qualificationOutcome(input.outcome, action.evidence);
  const evidence = await input.db.workroomActivity.create({ data: { workCapsuleId: room.id,
    kind: "evidence-recorded", summary: `Native Windows qualification completed with ${disposition} evidence.`,
    recordedByAgentId: action.edgeNodeId, payload: { kind: "manual_check", stageKey: "reproduce",
      outcome: disposition === "blocked" ? "blocked" : "completed", targetId: input.actionKey,
      result: { qualificationOutcome: disposition, qualificationBindingDigest: digest,
        executorMode: "native-edge", requiredPlatform: "win32", headSha: action.parameters.headSha,
        testBlobIds: Array.isArray(action.parameters.testBlobs)
          ? action.parameters.testBlobs.map((entry: unknown) => isRecord(entry) ? entry.blobSha : null).filter(Boolean) : [],
        actionKey: input.actionKey, outputDigest: `sha256:${String(action.evidence.boundedOutputDigest ?? "")}`,
        startedAt: action.evidence.startedAt, completedAt: action.evidence.finishedAt,
        observations: action.evidence.observations, researchSatisfied: false } } } });
  await input.db.workroom.update({ where: { id: room.id }, data: { workspaceState: { ...workspace,
    qualificationExperimentAdmission: { ...state, status: "settled", evidenceId: evidence.id } } } });
  return true;
}

