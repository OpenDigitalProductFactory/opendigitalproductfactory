import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { isWorkCapsuleEvidenceKind, type WorkCapsuleEvidenceKind, type WorkCapsuleActivityKind } from "@/lib/work-capsules";

import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { buildStageEvidenceBinding } from "@/lib/work-management/workroom-stage-evidence-binding";

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
    return recordWorkCapsuleActivity(tx, {
      workCapsuleId: capsule.id, kind: "evidence-recorded", summary: evidence.summary,
      payload: { ...evidence, sourceBinding }, actor: args.actor,
    }, { deferPublication: true });
  };
  const activity = args.db.$transaction ? await args.db.$transaction(write) : await write(args.db);
  if (!args.deferPublication) {
    publishRecordedWorkCapsuleActivity(activity.workCapsuleId, activity.id);
    revalidatePortalContext();
  }
  return activity;
}
