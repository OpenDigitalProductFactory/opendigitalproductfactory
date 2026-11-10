import { expect, it } from "vitest";
import { loadWorkspaceWorkCaseDetail, type WorkspaceCasePrismaClient } from "./workspace-case-loader";

const baseItem = {
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
  dueAt: null,
  evidence: [{ kind: "operator-note", summary: "Customer called twice." }],
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
  updatedAt: new Date("2026-06-28T10:30:00.000Z"),
};

function prismaFor(items: [typeof baseItem]): WorkspaceCasePrismaClient {
  return {
    workItem: { findMany: async () => items, findFirst: async () => items[0] },
    workItemMessage: { findMany: async () => [] },
    workroom: { findMany: async () => [] },
    workroomActivity: { findMany: async () => [] },
  };
}

  it("returns source review requirements only inside an authorized room read", async () => {
    const allowed = await loadWorkspaceWorkCaseDetail({ prismaClient: prismaFor([baseItem]),
      caseKey: "booking%3ABK-1", userId: "user-1" });
    expect(allowed?.room?.reviewProfile).toMatchObject({
      applicability: "unknown", source: { status: "resolved", identity: { sourceKey: "booking" } },
    });
    const denied = await loadWorkspaceWorkCaseDetail({ prismaClient: prismaFor([baseItem]),
      caseKey: "booking%3ABK-1", userId: "another-user" });
    expect(denied).toBeNull();
  });

