import type { WorkspaceCasePrismaClient } from "./workspace-case-loader";

export type WorkItemFixture = Awaited<ReturnType<WorkspaceCasePrismaClient["workItem"]["findMany"]>>[number];

export const baseItem = {
  id: "row-1",
  itemId: "WI-1",
  sourceType: "booking",
  sourceId: "BK-1",
  title: "Confirm condenser appointment",
  description: "Customer needs a scheduling confirmation.",
  urgency: "urgent",
  effortClass: "short",
  status: "awaiting-input",
  assignedToUserId: "user-1",
  assignedToAgentId: null,
  dueAt: new Date("2026-06-29T15:00:00.000Z"),
  evidence: [{ kind: "operator-note", summary: "Customer called twice." }],
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
  updatedAt: new Date("2026-06-28T10:30:00.000Z"),
};

export function prismaFor(items: WorkItemFixture[], detail: WorkItemFixture | null = items[0]): WorkspaceCasePrismaClient {
  return {
    workItem: {
      findMany: async () => items,
      findFirst: async () => detail,
    },
    workItemMessage: {
      findMany: async () => [
        {
          messageId: "WIM-1",
          senderType: "agent",
          messageType: "handoff",
          body: "Need a human confirmation before booking.",
          createdAt: new Date("2026-06-28T10:10:00.000Z"),
        },
      ],
    },
    workroom: {
      findMany: async () => [],
    },
    workroomActivity: { findMany: async () => [] },
  };
}
