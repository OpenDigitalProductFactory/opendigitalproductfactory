import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import type { WorkItemUrgency } from "@/lib/queue/queue-types";

const TRIAGE_QUEUE_ID = "triage-default";

/**
 * Create a WorkItem from a BacklogItem so it can be tracked
 * through the collaborative work queue.
 */
export async function bridgeBacklogItemToWorkItem(
  backlogItemId: string,
  urgency: WorkItemUrgency = "routine",
): Promise<string> {
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

  return workItem.itemId;
}
