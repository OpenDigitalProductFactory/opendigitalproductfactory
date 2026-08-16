import {
  parseWorkIntentDeclared,
  type WorkIntent,
  type WorkIntentDeclared,
} from "@/lib/work-capsules";

import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

export async function declareWorkCapsuleIntent(args: {
  db: CapsuleDb;
  capsuleId: string;
  intent: WorkIntent;
  policyVersion: string;
  subject: WorkIntentDeclared["subject"];
  actor: WorkCapsuleActor;
}) {
  const payload = parseWorkIntentDeclared({
    schemaVersion: 1,
    intent: args.intent,
    policyVersion: args.policyVersion,
    subject: args.subject,
  });
  if (!payload.ok) throw new Error(payload.error);
  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
    select: { id: true, backlogItemId: true, epicId: true, featureBuildId: true, taskRunId: true },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  const binding = args.subject.kind === "backlog-item"
    ? capsule.backlogItemId
    : args.subject.kind === "epic"
      ? capsule.epicId
      : args.subject.kind === "feature-build"
        ? capsule.featureBuildId
        : capsule.taskRunId;
  if (binding !== args.subject.id) {
    throw new Error(`Work intent subject does not match Work Capsule ${args.capsuleId}.`);
  }
  return recordWorkCapsuleActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "work-intent-declared",
    summary: `Work intent declared: ${payload.intent}`,
    payload,
    actor: args.actor,
  });
}
