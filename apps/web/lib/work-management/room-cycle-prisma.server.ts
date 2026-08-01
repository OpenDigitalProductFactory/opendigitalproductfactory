import { Prisma, prisma } from "@dpf/db";

import type {
  WorkRoomCycleParentRecord,
  WorkRoomCycleStoreDb,
  WorkRoomCycleStoreTx,
} from "./room-cycle-store";

function txAdapter(tx: Prisma.TransactionClient): WorkRoomCycleStoreTx {
  return {
    getRoom: async (workItemId) => tx.workItem.findUnique({
      where: { id: workItemId },
      select: {
        id: true,
        itemId: true,
        sourceType: true,
        sourceId: true,
        title: true,
        description: true,
        queueId: true,
        teamId: true,
        urgency: true,
        effortClass: true,
        workerConstraint: true,
        assignedToUserId: true,
        assignedToAgentId: true,
      },
    }) as Promise<WorkRoomCycleParentRecord | null>,
    listCycles: (workItemId) => tx.workItem.findMany({
      where: { parentItemId: workItemId },
      select: {
        id: true,
        itemId: true,
        sourceType: true,
        sourceId: true,
        title: true,
        description: true,
        status: true,
        assignedToUserId: true,
        assignedToAgentId: true,
        dueAt: true,
        evidence: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { itemId: "asc" }],
    }),
    listMessages: (workItemId) => tx.workItemMessage.findMany({
      where: { workItemId },
      select: { messageId: true, messageType: true, structuredPayload: true },
      orderBy: [{ createdAt: "asc" }, { messageId: "asc" }],
    }),
    findWorkItemBySource: (sourceType, sourceId) => tx.workItem.findFirst({
      where: { sourceType, sourceId },
      select: {
        id: true,
        itemId: true,
        sourceType: true,
        sourceId: true,
        title: true,
        description: true,
        status: true,
        assignedToUserId: true,
        assignedToAgentId: true,
        dueAt: true,
        evidence: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    createWorkItem: (data) => tx.workItem.create({ data: data as never }),
    completeCycle: async (id, completedAt) => {
      await tx.workItem.update({
        where: { id },
        data: { status: "completed", completedAt },
      });
    },
    appendMessage: (data) => tx.workItemMessage.create({
      data: data as never,
      select: { messageId: true },
    }),
  };
}

export const prismaWorkRoomCycleDb: WorkRoomCycleStoreDb = {
  withinRoomLock: (workItemId, callback) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WorkItem" WHERE "id" = ${workItemId} FOR UPDATE`,
    );
    return callback(txAdapter(tx));
  }),
};
