import { prisma } from "@dpf/db";

import { resolveOperatorRecipient } from "@/lib/attention/notify-live";
import { agentEventBus } from "@/lib/tak/agent-event-bus";
import {
  notifyDeliveryTransition,
  reconcileDeliveryTaskNotifications,
  type DeliveryNotificationSource,
  type DeliveryNotificationCandidate,
} from "./delivery-task-notifications";

export async function notifyDeliveryCandidateLive(
  candidate: DeliveryNotificationCandidate & { userId: string },
): Promise<{ created: boolean }> {
  return notifyDeliveryTransition({
    hasAny: async (userId, type) => Boolean(await prisma.notification.findFirst({
      where: { userId, type },
      select: { id: true },
    })),
    create: async (data) => (await prisma.notification.createMany({ data: [data], skipDuplicates: true })).count === 1,
    emit: (event) => agentEventBus.broadcastSystem({ type: "attention:created", ...event }),
  }, candidate);
}

export async function reconcileDeliveryTaskNotificationsLive(now: Date = new Date()): Promise<void> {
  await reconcileDeliveryTaskNotifications({
    listRecent: async ({ since, take }) => prisma.workroom.findMany({
      where: {
        archivedAt: null,
        OR: [
          { updatedAt: { gte: since } },
          { leaseExpiresAt: { gte: since, lte: now } },
          { taskRun: { updatedAt: { gte: since } } },
          { taskRun: { actionEnvelopes: { some: {
            status: { in: ["proposed", "approved"] },
            expiresAt: { gte: since, lte: now },
          } } } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      select: {
        capsuleId: true,
        title: true,
        status: true,
        updatedAt: true,
        leaseExpiresAt: true,
        taskRun: {
          select: {
            taskRunId: true,
            userId: true,
            status: true,
            updatedAt: true,
            actionEnvelopes: {
              where: { status: { in: ["proposed", "approved"] } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 2,
              select: { id: true, status: true, expiresAt: true },
            },
          },
        },
      },
    }) as unknown as Promise<DeliveryNotificationSource[]>,
    resolveOperatorUserId: resolveOperatorRecipient,
    notify: notifyDeliveryCandidateLive,
  }, now);
}
