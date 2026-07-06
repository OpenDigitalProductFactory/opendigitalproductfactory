import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";

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
 * When a TaskNode transitions to awaiting_human, create a WorkItem so it appears
 * in the collaborative work queue for human action, and record its arrival into
 * the shared flow telemetry (EP-3516E23D). Idempotent: a live WorkItem already
 * bridged for this TaskNode is returned rather than duplicated.
 */
export async function bridgeTaskNodeToWorkItem(taskNodeId: string): Promise<string> {
  const existing = await prisma.workItem.findFirst({
    where: {
      sourceType: "task-node",
      sourceId: taskNodeId,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { itemId: true },
  });
  if (existing) return existing.itemId;

  const node = await prisma.taskNode.findUniqueOrThrow({
    where: { taskNodeId },
    include: { taskRun: true },
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

  const item = await prisma.workItem.create({
    data: {
      sourceType: "task-node",
      sourceId: taskNodeId,
      title: node.title,
      description: node.objective,
      urgency: "routine",
      effortClass: "short",
      workerConstraint: { workerType: "human" },
      queueId: triageQueue.id,
      status: "queued",
    },
  });

  await inngest.send({
    name: "cwq/item.created",
    data: { workItemId: item.itemId, sourceType: "task-node", urgency: "routine" },
  });

  void recordQueueTransition({
    queueKey: `cwq:${triageQueue.id}`,
    itemKind: "work-item",
    itemId: item.itemId,
    transition: "enqueued",
    occurredAt: item.createdAt,
  });

  return item.itemId;
}
