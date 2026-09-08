import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { isWorkCapsuleEvidenceKind, type WorkCapsuleEvidenceKind, type WorkCapsuleActivityKind } from "@/lib/work-capsules";

import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

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

  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  return recordWorkCapsuleActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "evidence-recorded",
    summary: args.evidence.summary,
    payload: args.evidence,
    actor: args.actor,
  }, { deferPublication: args.deferPublication });
}
