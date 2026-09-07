import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import type { WorkCapsuleActivityKind } from "@/lib/work-capsules";

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
