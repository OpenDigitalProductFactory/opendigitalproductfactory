import { Prisma } from "@dpf/db";
import { loadSemanticReviewRoomProjection, type ReviewerRoomClient } from "./semantic-review-room-projection";
import { roomActivitiesFromCapsuleActivity } from "./room-activity";
import { fromWorkCapsuleActivity, type WorkCapsuleActivityRow } from "./receipt-envelope";
import { loadWorkroomInitiativeEvidence, type InitiativeEvidenceClient, type InitiativeEvidenceRoom } from "./workroom-initiative-evidence";
import { buildStageEvidenceBinding } from "./workroom-stage-evidence-binding";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";

export type WorkroomExecutionClient = ReviewerRoomClient & InitiativeEvidenceClient & {
  workroomActivity?: { findMany(args: unknown): Promise<WorkCapsuleActivityRow[]> };
};

/** Latest evidence per declared requirement, independent of the activity-feed window. */
async function loadRequirementEvidence(db: WorkroomExecutionClient, rooms: readonly InitiativeEvidenceRoom[]) {
  const requirements = rooms.flatMap(room => {
    const definition = resolveWorkShapeClaim(room.scopeClaims);
    return room.id && definition ? definition.stages.flatMap(stage => stage.evidence.flatMap(kind => {
      const binding = buildStageEvidenceBinding(room, { kind, stageKey: stage.key });
      return binding ? [Prisma.sql`(${room.id}::text, ${JSON.stringify(binding)}::jsonb)`] : [];
    })) : [];
  });
  if (!requirements.length) return { rows: [], partial: false };
  if (!db.$queryRaw) return { rows: [], partial: true };
  try {
    // One indexed, limited journal lookup per requirement. Never return the room's full history.
    const rows = await db.$queryRaw<WorkCapsuleActivityRow[]>(Prisma.sql`
      SELECT receipt.* FROM (VALUES ${Prisma.join(requirements)}) AS required("roomId", binding)
      CROSS JOIN LATERAL (
        SELECT activity.* FROM "WorkCapsuleActivity" activity
        WHERE activity."workCapsuleId" = required."roomId"
          AND activity.kind = 'evidence-recorded'
          AND activity.payload->>'kind' = required.binding->>'evidenceKind'
          AND activity.payload->>'stageKey' = required.binding->>'stageKey'
          AND activity.payload->'sourceBinding' @> (required.binding - 'repositoryFullName' - 'headSha')
          AND lower(activity.payload#>>'{sourceBinding,repositoryFullName}') = lower(required.binding->>'repositoryFullName')
          AND lower(activity.payload#>>'{sourceBinding,headSha}') = lower(required.binding->>'headSha')
        ORDER BY activity."recordedAt" DESC, activity.id DESC LIMIT 1
      ) receipt
    `);
    return { rows, partial: false };
  } catch {
    return { rows: [], partial: true };
  }
}

/** One bounded evidence lane for anchored and standalone rooms. No state is promoted to a verdict. */
export async function loadWorkroomExecutionEvidence(
  db: WorkroomExecutionClient,
  rooms: readonly InitiativeEvidenceRoom[],
  now: Date,
) {
  const identities = new Map(rooms.filter(room => room.id).map(room => [room.id!, room.capsuleId]));
  const roomsById = new Map(rooms.filter(room => room.id).map(room => [room.id!, room]));
  const [journal, reviewers, initiative, required] = await Promise.all([
    identities.size && db.workroomActivity
      ? db.workroomActivity.findMany({
          where: { workCapsuleId: { in: [...identities.keys()] } },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 21,
        }).catch(() => null)
      : Promise.resolve(rooms.length ? null : []),
    loadSemanticReviewRoomProjection(db, rooms.map(room => room.capsuleId), now),
    loadWorkroomInitiativeEvidence(db, rooms),
    loadRequirementEvidence(db, rooms),
  ]);
  const rows = (journal ?? []).slice(0, 20);
  const journalReceipts = rows.filter(row => ["evidence-recorded", "verification", "receipt"].includes(row.kind))
    .map(row => fromWorkCapsuleActivity(row, { capsuleId: identities.get(row.workCapsuleId), room: roomsById.get(row.workCapsuleId) }));
  const requirementReceipts = required.rows
    .map(row => fromWorkCapsuleActivity(row, { capsuleId: identities.get(row.workCapsuleId), room: roomsById.get(row.workCapsuleId) }))
    .filter(receipt => receipt.processEvidence);
  return {
    reviewerRuns: reviewers.runs,
    activities: roomActivitiesFromCapsuleActivity(rows, identities),
    receipts: [
      ...reviewers.receipts,
      ...initiative.receipts,
      ...new Map([...journalReceipts, ...requirementReceipts].map(receipt => [receipt.receiptId, receipt])).values(),
    ],
    sourceRefs: reviewers.sourceRefs,
    attentionReason: reviewers.attentionReason,
    partial: rooms.some(room => !room.id) || journal === null || journal.length > 20 || reviewers.partial || initiative.partial || required.partial,
  };
}
