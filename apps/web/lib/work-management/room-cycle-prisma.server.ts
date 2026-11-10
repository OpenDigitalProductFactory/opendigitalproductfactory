import { Prisma, prisma } from "@dpf/db";
import { cycleHistoryAfter, readCycleHistory } from "./room-cycle-pagination";
import { workroomCycleSourceKey, workroomOutcomeMessageId } from "./room-cycle-store";
import { parseStoredWorkroomCycle, parseStoredWorkroomOutcome, WORKROOM_OUTCOME_MESSAGE_TYPE } from "./room-cycle-adapter";

import type {
  WorkroomCycleParentRecord,
  WorkroomCycleStoreDb,
  WorkroomCycleStoreTx,
} from "./room-cycle-store";

function txAdapter(tx: Prisma.TransactionClient): WorkroomCycleStoreTx {
  return {
    findOutcome: async (workItemId, cycleKey, carrierId) => {
      const where = { workItemId, messageType: WORKROOM_OUTCOME_MESSAGE_TYPE };
      const exact = await tx.workItemMessage.findFirst({ where: {
        ...where, messageId: workroomOutcomeMessageId(workItemId, cycleKey, carrierId),
      } });
      const matches = (row: { structuredPayload: unknown }) => {
        const stored = parseStoredWorkroomOutcome(row.structuredPayload);
        return stored?.cycleKey === cycleKey && stored.carrierId === carrierId;
      };
      if (exact) {
        if (!matches(exact)) throw new Error("Outcome identity does not match its stored boundary");
        return exact;
      }
      const legacy = await readCycleHistory(({ after, take }) => tx.workItemMessage.findMany({
        where: { ...where, ...cycleHistoryAfter(after) }, take,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }));
      return legacy.find(matches) ?? null;
    },
    findCycle: async (workItemId, lookup) => {
      if ("carrierId" in lookup) return tx.workItem.findFirst({
        where: { parentItemId: workItemId, itemId: lookup.carrierId },
      });
      if ("cycleKey" in lookup) {
        const exact = await tx.workItem.findFirst({ where: {
          parentItemId: workItemId, sourceKey: workroomCycleSourceKey(workItemId, lookup.cycleKey),
        } });
        if (exact) {
          if (parseStoredWorkroomCycle(exact.evidence)?.cycleKey !== lookup.cycleKey) {
            throw new Error("Cycle identity does not match its stored boundary");
          }
          return exact;
        }
      }
      // New cycle keys use the existing indexed adapter identity. Legacy rows
      // retain their evidence; a bounded fallback cannot silently miss a cycle.
      const candidates = await readCycleHistory(({ after, take }) => tx.workItem.findMany({
        where: { parentItemId: workItemId, ...cycleHistoryAfter(after),
          ...("active" in lookup ? { status: { notIn: ["completed", "cancelled"] } } : { sourceKey: null }),
        }, take, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }));
      return candidates.find(row => {
        const boundary = parseStoredWorkroomCycle(row.evidence);
        return boundary && ("active" in lookup || boundary.cycleKey === lookup.cycleKey);
      }) ?? null;
    },
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
    }) as Promise<WorkroomCycleParentRecord | null>,
    listCycles: (workItemId) => readCycleHistory(({ after, take }) => tx.workItem.findMany({
      where: { parentItemId: workItemId, ...cycleHistoryAfter(after) },
      take,
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })),
    listMessages: (workItemId) => readCycleHistory(({ after, take }) => tx.workItemMessage.findMany({
      where: { workItemId, ...cycleHistoryAfter(after) },
      take,
      select: { id: true, createdAt: true, messageId: true, messageType: true, structuredPayload: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })),
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

export const prismaWorkroomCycleDb: WorkroomCycleStoreDb = {
  withinRoomLock: (workItemId, callback) => prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WorkItem" WHERE "id" = ${workItemId} FOR UPDATE`,
    );
    return callback(txAdapter(tx));
  }),
};
