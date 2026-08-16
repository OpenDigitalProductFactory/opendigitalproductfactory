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
 * BI-AC815F1E: project a BacklogItem's lifecycle status onto a WorkItem status so
 * the unified WorkCase view reflects the real state instead of always showing
 * "intake". BacklogStatuses (triaging|open|in-progress|done|deferred|retired) map onto the
 * WorkItem statuses that projectWorkItem already collapses into WorkCase states.
 */
const BACKLOG_STATUS_TO_WORK_ITEM_STATUS: Record<string, string> = {
  triaging: "queued",
  open: "queued",
  "in-progress": "in-progress",
  done: "completed",
  deferred: "deferred",
  retired: "cancelled",
};

function mapBacklogStatusToWorkItemStatus(status: string): string {
  return BACKLOG_STATUS_TO_WORK_ITEM_STATUS[status] ?? "queued";
}

/**
 * Create or sync a WorkItem from a BacklogItem so it can be tracked through the
 * collaborative work queue, and record its arrival into the shared flow
 * telemetry (EP-3516E23D). Idempotent: if a live WorkItem already exists for
 * this BacklogItem, it SYNCS that item's status/title to the backlog item's
 * current state and returns it rather than creating a duplicate — so a claim →
 * release → re-claim cycle does not spawn multiple queue entries, and a
 * triaging → in-progress → done transition is reflected on the case
 * (BI-AC815F1E). A re-opened backlog item (its prior WorkItem now completed/
 * cancelled) still gets a fresh live case, by design.
 */
export async function bridgeBacklogItemToWorkItem(
  backlogItemId: string,
  urgency: WorkItemUrgency = "routine",
): Promise<string | null> {
  const item = await prisma.backlogItem.findUniqueOrThrow({
    where: { itemId: backlogItemId },
  });
  const mappedStatus = mapBacklogStatusToWorkItemStatus(item.status);

  const existing = await prisma.workItem.findFirst({
    where: {
      sourceType: "backlog-item",
      sourceId: backlogItemId,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { itemId: true, status: true, title: true },
  });
  if (existing) {
    if (existing.status !== mappedStatus || existing.title !== item.title) {
      await prisma.workItem.update({
        where: { itemId: existing.itemId },
        data: { status: mappedStatus, title: item.title, description: item.body ?? item.title },
      });
    }
    return existing.itemId;
  }

  // Only materialize a fresh case when work actually starts (in-progress). This
  // lets the invocation fire on every backlog transition — so an existing case
  // stays synced (above) and closes on done — without flooding the queue with a
  // case for every triaging/open/deferred item that no one has started
  // (BI-AC815F1E).
  if (mappedStatus !== "in-progress") {
    return null;
  }

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
      status: mappedStatus,
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
