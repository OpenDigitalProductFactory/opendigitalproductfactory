/**
 * The standing ecosystem-participation room (BI-8FBF58AB).
 *
 * One STANDING room per installation for its part in the ecosystem —
 * `sourceType = "ecosystem-participation"`, `sourceId = "weekly-digest"` —
 * created on first use and reused, exactly as the mailroom queue rooms and the
 * bookkeeping-period room are. The weekly digest is a message ON this room,
 * never a room of its own.
 *
 * This replaces a PlatformConfig binding that nothing ever wrote, so the digest
 * could never post. The spec always required the room to be DERIVED, never
 * authored per install.
 */

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";

export const ECOSYSTEM_ROOM_SOURCE_TYPE = "ecosystem-participation";
export const ECOSYSTEM_ROOM_SOURCE_ID = "weekly-digest";
export const ECOSYSTEM_WORK_QUEUE_ID = "ecosystem";

const LIVE_WORK_ITEM_STATUSES = ["queued", "assigned", "in-progress", "awaiting-input", "awaiting-approval", "escalated", "deferred"];

export type ParticipationRoomDb = {
  workQueue: { upsert(args: unknown): Promise<{ id: string }> };
  workItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string; assignedToUserId: string | null } | null>;
    create(args: unknown): Promise<{ id: string; itemId: string; assignedToUserId: string | null }>;
  };
};

export type ParticipationRoomRef = {
  id: string;
  itemId: string;
  caseKey: string;
  assignedToUserId: string | null;
};

export const ECOSYSTEM_ROOM_CASE_KEY = encodeWorkCaseKey({
  sourceType: ECOSYSTEM_ROOM_SOURCE_TYPE,
  sourceId: ECOSYSTEM_ROOM_SOURCE_ID,
});

/**
 * Idempotent: the live standing room, created when absent.
 *
 * `ownerUserId` is the organization's RECORDED accountable human, resolved by
 * the caller with no fallback. When it is null the room is created unassigned
 * and sits in the reportable unowned set — a plausible-looking owner would be
 * worse than none.
 */
export async function ensureEcosystemParticipationRoom(
  db: ParticipationRoomDb,
  input: { ownerUserId: string | null },
): Promise<ParticipationRoomRef> {
  const existing = await db.workItem.findFirst({
    where: {
      sourceType: ECOSYSTEM_ROOM_SOURCE_TYPE,
      sourceId: ECOSYSTEM_ROOM_SOURCE_ID,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { id: true, itemId: true, assignedToUserId: true },
  });
  if (existing) return { ...existing, caseKey: ECOSYSTEM_ROOM_CASE_KEY };

  const workQueue = await db.workQueue.upsert({
    where: { queueId: ECOSYSTEM_WORK_QUEUE_ID },
    create: {
      queueId: ECOSYSTEM_WORK_QUEUE_ID,
      name: "Ecosystem",
      queueType: "team",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false },
    },
    update: {},
    select: { id: true },
  });

  const room = await db.workItem.create({
    data: {
      sourceType: ECOSYSTEM_ROOM_SOURCE_TYPE,
      sourceId: ECOSYSTEM_ROOM_SOURCE_ID,
      title: "Ecosystem participation",
      description:
        "The standing room for this installation's part in the ecosystem. Each week it receives "
        + "what the ecosystem is asking for that applies here, what happened to what this "
        + "installation raised, and which shipped fixes apply to it.",
      urgency: "routine",
      effortClass: "medium",
      workerConstraint: { workerType: "human", role: "owner" },
      queueId: workQueue.id,
      status: "in-progress",
      ...(input.ownerUserId ? { assignedToUserId: input.ownerUserId } : {}),
    },
    select: { id: true, itemId: true, assignedToUserId: true },
  });
  return { ...room, caseKey: ECOSYSTEM_ROOM_CASE_KEY };
}
