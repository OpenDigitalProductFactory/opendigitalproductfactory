import { loadSemanticReviewRoomProjection, type ReviewerRoomClient } from "./semantic-review-room-projection";
import { roomActivitiesFromCapsuleActivity } from "./room-activity";
import { fromWorkCapsuleActivity, type WorkCapsuleActivityRow } from "./receipt-envelope";

export type WorkroomExecutionClient = ReviewerRoomClient & {
  workroomActivity?: { findMany(args: unknown): Promise<WorkCapsuleActivityRow[]> };
};

/** One bounded evidence lane for anchored and standalone rooms. No state is promoted to a verdict. */
export async function loadWorkroomExecutionEvidence(
  db: WorkroomExecutionClient,
  rooms: readonly { id?: string; capsuleId: string }[],
  now: Date,
) {
  const identities = new Map(rooms.filter(room => room.id).map(room => [room.id!, room.capsuleId]));
  const [journal, reviewers] = await Promise.all([
    identities.size && db.workroomActivity
      ? db.workroomActivity.findMany({
          where: { workCapsuleId: { in: [...identities.keys()] } },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 21,
        }).catch(() => null)
      : Promise.resolve(rooms.length ? null : []),
    loadSemanticReviewRoomProjection(db, rooms.map(room => room.capsuleId), now),
  ]);
  const rows = (journal ?? []).slice(0, 20);
  return {
    reviewerRuns: reviewers.runs,
    activities: roomActivitiesFromCapsuleActivity(rows, identities),
    receipts: [
      ...reviewers.receipts,
      ...rows.filter(row => ["evidence-recorded", "verification", "receipt"].includes(row.kind))
        .map(row => fromWorkCapsuleActivity(row, { capsuleId: identities.get(row.workCapsuleId) })),
    ],
    sourceRefs: reviewers.sourceRefs,
    attentionReason: reviewers.attentionReason,
    partial: rooms.some(room => !room.id) || journal === null || journal.length > 20 || reviewers.partial,
  };
}
