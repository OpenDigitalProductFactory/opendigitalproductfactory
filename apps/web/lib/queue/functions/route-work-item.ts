import { inngest } from "../inngest-client";
import { emitQueueProgress } from "../inngest-bridge";

export const routeWorkItem = inngest.createFunction(
  {
    id: "cwq/route-work-item",
    retries: 3,
    triggers: [{ event: "cwq/item.created" }],
    cancelOn: [{ event: "cwq/item.cancelled", match: "data.workItemId" }],
  },
  async ({ event, step }) => {
    // Step 1: Read the work item
    const item = await step.run("read-item", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.workItem.findUnique({
        where: { itemId: event.data.workItemId },
        select: {
          id: true,
          itemId: true,
          workerConstraint: true,
          teamId: true,
          queueId: true,
        },
      });
    });

    if (!item) return;

    // Step 2: Route to a worker
    const result = await step.run("route-item", async () => {
      const { routeWorkItem: route } = await import("../queue-router");
      const constraint = item.workerConstraint as {
        workerType: "human" | "ai-agent" | "either" | "team";
        requiredCapabilities?: string[];
        requiredRole?: string;
        requiredAgentId?: string;
        excludeWorkers?: string[];
        preferredWorkerIds?: string[];
      };
      return route(item.itemId, constraint, item.teamId ?? undefined);
    });

    // Step 3: Emit real-time progress event
    if (result.assigned) {
      await step.run("emit-assigned", async () => {
        emitQueueProgress(item.itemId, {
          type: "queue:item_assigned",
          workItemId: item.itemId,
          workerType: result.workerType!,
          workerId: result.workerId!,
        });
      });
    }

    // Step 4: Wait for completion with SLA timeout
    const sla = await step.run("get-sla", async () => {
      const { prisma } = await import("@dpf/db");
      const queue = await prisma.workQueue.findUnique({
        where: { id: item.queueId },
        select: { slaMinutes: true },
      });
      const slaConfig = queue?.slaMinutes as Record<string, number> | null;
      return slaConfig?.[event.data.urgency] ?? 480; // default: 8 hours
    });

    const completion = await step.waitForEvent("wait-for-completion", {
      event: "cwq/item.completed",
      if: `async.data.workItemId == "${event.data.workItemId}"`,
      timeout: `${sla}m`,
    });

    if (!completion) {
      // SLA expired — mark escalated
      await step.run("escalate", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.workItem.update({
          where: { itemId: event.data.workItemId },
          data: { status: "escalated" },
        });
        emitQueueProgress(item.itemId, {
          type: "queue:escalation",
          workItemId: item.itemId,
          fromWorker: result.workerId ?? "unassigned",
          toWorker: "platform-admin",
          reason: "sla-timeout",
        });
      });
    }
  },
);
