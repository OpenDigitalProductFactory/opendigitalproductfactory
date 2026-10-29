import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { isWorkCapsuleEvidenceKind, type WorkCapsuleEvidenceKind, type WorkCapsuleActivityKind } from "@/lib/work-capsules";

import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { buildStageEvidenceBinding } from "@/lib/work-management/workroom-stage-evidence-binding";
import { isRecord } from "@/lib/shared/coerce";
import {
  parseQualificationExperimentState,
  parseQualificationVerificationEvidence,
  qualificationExecutionActivitiesMatch,
  qualificationToolEffectAllowed,
  verifyQualificationExperimentAdmission,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";

export async function recordWorkCapsuleActivity(
  db: CapsuleDb,
  input: {
    workCapsuleId: string;
    kind: WorkCapsuleActivityKind;
    summary: string;
    payload?: Record<string, unknown>;
    actor: WorkCapsuleActor;
  },
  options: { deferPublication?: boolean } = {},
) {
  const activity = await db.workroomActivity.create({
    data: {
      workCapsuleId: input.workCapsuleId,
      kind: input.kind,
      summary: input.summary,
      payload: input.payload ?? {},
      recordedById: input.actor.userId,
      recordedByAgentId: input.actor.agentId,
    },
  });
  if (!options.deferPublication) {
    publishRecordedWorkCapsuleActivity(input.workCapsuleId, activity?.id);
    revalidatePortalContext();
  }
  return activity;
}

type CapsuleEvidenceInput = {
  kind: WorkCapsuleEvidenceKind;
  summary: string;
  /** The work-shape stage this evidence completes. The drive earns a completing
   *  receipt from stage-scoped evidence only (BI-76B35820). */
  stageKey?: string;
  /** Stage evidence only: `completed` advances the stage, `blocked` records
   *  why it could not be done and advances nothing. */
  outcome?: "completed" | "blocked";
  command?: string;
  url?: string;
  targetId?: string;
  runtimeTargetId?: string;
  verificationId?: string;
  result?: unknown;
};

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: CapsuleEvidenceInput;
  actor: WorkCapsuleActor;
  taskRunId?: string | null;
  deferPublication?: boolean;
}) {
  if (!isWorkCapsuleEvidenceKind(args.evidence.kind)) {
    throw new Error("Invalid evidence kind");
  }

  // Snapshot the caller's flat stage identity before the first await. Reserved
  // source context is always replaced, even for callers using an untyped input.
  const evidence = { ...args.evidence };
  const capsuleId = args.capsuleId;
  const write = async (tx: CapsuleDb) => {
    // Unscoped notes (including semantic-review transactions) need no new
    // parent lock. Only stage-scoped source snapshots require serialization.
    if (evidence.stageKey && tx.$queryRaw) {
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${capsuleId} FOR UPDATE`;
    }
    const capsule = await tx.workroom.findUnique({ where: { capsuleId } });
    if (!capsule) throw new Error(`Work Capsule ${capsuleId} not found`);
    const sourceBinding = buildStageEvidenceBinding({ ...capsule, capsuleId }, evidence);
    const qualificationResult = isRecord(evidence.result) ? evidence.result : null;
    const qualificationDigest = typeof qualificationResult?.qualificationBindingDigest === "string"
      ? qualificationResult.qualificationBindingDigest : null;
    const workspace = isRecord(capsule.workspaceState) ? capsule.workspaceState : {};
    const qualificationState = qualificationDigest
      ? parseQualificationExperimentState(workspace.qualificationExperimentAdmission) : null;
    if (qualificationDigest && (!qualificationState || qualificationState.status !== "started"
      || qualificationState.bindingDigest !== qualificationDigest)) {
      throw new Error("Qualification evidence is stale, duplicated, or bound to another experiment.");
    }
    if (qualificationState) {
      const admission = verifyQualificationExperimentAdmission(qualificationState.token, { allowExpired: true });
      if (!admission.ok || (admission.data.binding.executorMode === "workroom-host"
        && admission.data.binding.accountablePrincipalRef !== args.actor.principalId)
        || !qualificationToolEffectAllowed({ binding: admission.data.binding, state: qualificationState,
          toolName: "record_workroom_evidence", params: { ...evidence, capsuleId }, now: new Date() })) {
        throw new Error("Qualification evidence does not match the live binding, accountable principal, or execution window.");
      }
      if (admission.data.binding.executorMode === "sandbox-build" && !args.taskRunId) {
        throw new Error("Sandbox qualification evidence requires its exact scheduled TaskRun context.");
      }
      if (admission.data.binding.executorMode === "workroom-host" && args.taskRunId) {
        throw new Error("Host qualification evidence cannot borrow a scheduled TaskRun identity.");
      }
      if (admission.data.binding.executorMode === "workroom-host") {
        const proof = parseQualificationVerificationEvidence(qualificationResult);
        if (!proof?.executionEvidenceActivityIds || !tx.backlogItemActivity) {
          throw new Error("Host qualification evidence requires exact recorded execution activities.");
        }
        const rows = await tx.backlogItemActivity.findMany({
          where: { id: { in: proof.executionEvidenceActivityIds } },
          select: { id: true, backlogItem: { select: { itemId: true } }, payload: true, recordedAt: true },
        });
        if (!qualificationExecutionActivitiesMatch({ binding: admission.data.binding, state: qualificationState,
          itemId: admission.data.binding.itemId, activityIds: proof.executionEvidenceActivityIds, rows,
          accountablePrincipalRef: args.actor.principalId })) {
          throw new Error("Host qualification evidence activities do not match the signed execution binding.");
        }
      }
    }
    const activity = await recordWorkCapsuleActivity(tx, {
      workCapsuleId: capsule.id, kind: "evidence-recorded", summary: evidence.summary,
      payload: { ...evidence, sourceBinding }, actor: args.actor,
    }, { deferPublication: true });
    if (qualificationState) {
      await tx.workroom.update({ where: { id: capsule.id }, data: { workspaceState: {
        ...workspace,
        qualificationExperimentAdmission: { ...qualificationState, status: "settled", evidenceId: activity.id,
          ...(args.taskRunId ? { taskRunId: args.taskRunId } : {}) },
      } } });
    }
    return activity;
  };
  const activity = args.db.$transaction ? await args.db.$transaction(write) : await write(args.db);
  if (!args.deferPublication) {
    publishRecordedWorkCapsuleActivity(activity.workCapsuleId, activity.id);
    revalidatePortalContext();
  }
  return activity;
}
