import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";

const TRIAGE_QUEUE_ID = "triage-default";

/**
 * When a TaskNode transitions to awaiting_human, create a WorkItem
 * so it appears in the collaborative work queue for human action.
 */
export async function bridgeTaskNodeToWorkItem(taskNodeId: string): Promise<string> {
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

  return item.itemId;
}
