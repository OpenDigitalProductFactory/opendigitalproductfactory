// Mailroom queue rooms (design 2026-09-09 §4.3/§4.6, BI-9BD223B1).
//
// One STANDING room per queue key — `sourceType = "mailroom-queue"`,
// `sourceId = <queueKey>` — created on first use and reused, exactly as the
// bookkeeping-period room is. An inbound item is a message ON the room, never a
// room of its own; a room per email is the scope fence the plan names.

import type { MailroomProfile, MailroomQueue } from "@dpf/storefront-templates";

export const MAILROOM_QUEUE_SOURCE_TYPE = "mailroom-queue";
export const MAILROOM_WORK_QUEUE_ID = "mailroom";

const LIVE_WORK_ITEM_STATUSES = ["queued", "assigned", "in-progress", "awaiting-input", "awaiting-approval", "escalated", "deferred"];

export type QueueRoomDb = {
  workQueue: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  workItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string; assignedToUserId: string | null } | null>;
    create(args: unknown): Promise<{ id: string; itemId: string; assignedToUserId: string | null }>;
  };
};

export type QueueRoomRef = { id: string; itemId: string; queueKey: string; assignedToUserId: string | null };

export function queueDefinition(profile: MailroomProfile, queueKey: string): MailroomQueue | null {
  return profile.queues.find((q) => q.key === queueKey) ?? null;
}

/** Idempotent: the live standing room for a queue, created when absent. */
export async function ensureMailroomQueueRoom(db: QueueRoomDb, profile: MailroomProfile, queueKey: string): Promise<QueueRoomRef> {
  const queue = queueDefinition(profile, queueKey);
  if (!queue) throw new Error(`mailroom queue ${queueKey} is not in the profile`);

  const existing = await db.workItem.findFirst({
    where: { sourceType: MAILROOM_QUEUE_SOURCE_TYPE, sourceId: queueKey, status: { in: LIVE_WORK_ITEM_STATUSES } },
    select: { id: true, itemId: true, assignedToUserId: true },
  });
  if (existing) return { ...existing, queueKey };

  const workQueue = await db.workQueue.upsert({
    where: { queueId: MAILROOM_WORK_QUEUE_ID },
    create: {
      queueId: MAILROOM_WORK_QUEUE_ID,
      name: "Mailroom",
      queueType: "team",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false },
    },
    update: {},
    select: { id: true },
  });

  const room = await db.workItem.create({
    data: {
      sourceType: MAILROOM_QUEUE_SOURCE_TYPE,
      sourceId: queueKey,
      title: queue.roomTitle,
      description:
        `The standing ${queue.label} correspondence room. Every message the Mailroom assigns to ` +
        `"${queue.label}" lands here for the ${queue.responsibleRole} to acknowledge and answer.`,
      urgency: "routine",
      effortClass: "medium",
      workerConstraint: { workerType: "human", role: queue.responsibleRole },
      queueId: workQueue.id,
      status: "in-progress",
    },
    select: { id: true, itemId: true, assignedToUserId: true },
  });
  return { ...room, queueKey };
}
