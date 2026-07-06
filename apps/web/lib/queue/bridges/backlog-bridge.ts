import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";
import type { WorkItemUrgency } from "@/lib/queue/queue-types";

const TRIAGE_QUEUE_ID = "triage-default";

/** Statuses that mean a WorkItem is still live (not a candidate for a fresh bridge). */
const LIVE_WORK_ITEM_STATUSES = [
  "queued",
  "assigned",
  "in-progress",
  "awaiting-input",
  "awaiting-approval",
  "escalated",
  "deferred",
];

/**
 * Create a WorkItem from a BacklogItem so it can be tracked through the
 * collaborative work queue, and record its arrival into the shared flow
 * telemetry (EP-3516E23D). Idempotent: if a live WorkItem already exists for
 * this BacklogItem, it returns that item rather than creating a duplicate — so
 * a claim → release → re-claim cycle does not spawn multiple queue entries.
 */
export async function bridgeBacklogItemToWorkItem(
  backlogItemId: string,
  urgency: WorkItemUrgency = "routine",
): Promise<string> {
  const existing = await prisma.workItem.findFirst({
    where: {
      sourceType: "backlog-item",
      sourceId: backlogItemId,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { itemId: true },
  });
  if (existing) return existing.itemId;

  const item = await prisma.backlogItem.findUniqueOrThrow({
    where: { itemId: backlogItemId },
  });

  const triageQueue = await prisma.workQueue.upsert({
    where: { queueId: TRIAGE_QUEUE_ID },
    create: {
      queueId: TRIAGE_QUEUE_ID,
      name: "Triage",
      queueType: "triage",
      routingPolicy: {
        mode: "manual",
        considerAvailability: false,
        considerPerformance: false,
        maxConcurrentPerWorker: 10,
      },
    },
    update: {},
  });

  const workItem = await prisma.workItem.create({
    data: {
      sourceType: "backlog-item",
      sourceId: backlogItemId,
      title: item.title,
      description: item.body ?? item.title,
      urgency,
      effortClass: "medium",
      workerConstraint: { workerType: "either" },
      queueId: triageQueue.id,
      status: "queued",
    },
  });

  await inngest.send({
    name: "cwq/item.created",
    data: { workItemId: workItem.itemId, sourceType: "backlog-item", urgency },
  });

  void recordQueueTransition({
    queueKey: `cwq:${triageQueue.id}`,
    itemKind: "work-item",
    itemId: workItem.itemId,
    transition: "enqueued",
    occurredAt: workItem.createdAt,
  });

  return workItem.itemId;
}
