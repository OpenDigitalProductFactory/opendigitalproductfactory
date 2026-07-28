import { describe, expect, it } from "vitest";

import {
  decodeWorkCaseKey,
  encodeWorkCaseKey,
  loadWorkspaceWorkCaseDetail,
  loadWorkspaceWorkCaseLens,
  type WorkspaceCasePrismaClient,
} from "./workspace-case-loader";

type WorkItemFixture = Awaited<ReturnType<WorkspaceCasePrismaClient["workItem"]["findMany"]>>[number];

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
  dueAt: new Date("2026-06-29T15:00:00.000Z"),
  evidence: [{ kind: "operator-note", summary: "Customer called twice." }],
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
  updatedAt: new Date("2026-06-28T10:30:00.000Z"),
};

function prismaFor(items: WorkItemFixture[], detail: WorkItemFixture | null = items[0]): WorkspaceCasePrismaClient {
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
  };
}

describe("workspace Work Case loader", () => {
  it("projects queued work as attention-first Work Cases", async () => {
    const dashboard = await loadWorkspaceWorkCaseLens({
      prismaClient: prismaFor([
        baseItem,
        {
          ...baseItem,
          id: "row-2",
          itemId: "WI-2",
          sourceId: null,
          title: "Routine filing",
          urgency: "routine",
          status: "queued",
          assignedToUserId: null,
          dueAt: null,
          createdAt: new Date("2026-06-28T11:00:00.000Z"),
        },
      ]),
      userId: "user-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(dashboard.cases).toHaveLength(2);
    expect(dashboard.cases[0]).toMatchObject({
      title: "Confirm condenser appointment",
      state: "waiting-on-person",
      attentionRequired: true,
      href: "/workspace/cases/booking%3ABK-1",
      urgencyLabel: "Urgent",
      assignmentLabel: "Assigned to you",
    });
    expect(dashboard.stats.needsAttention).toBe(1);
    expect(dashboard.stats.unassigned).toBe(1);
    expect(dashboard.stats.dueSoon).toBe(1);
  });

  it("round-trips stable case keys", () => {
    const key = encodeWorkCaseKey({ sourceType: "manual-task", sourceId: "WI:42" });

    expect(key).toBe("manual-task%3AWI%3A42");
    expect(decodeWorkCaseKey(key)).toEqual({ sourceType: "manual-task", sourceId: "WI:42" });
  });

  it("loads evidence-first detail from the same projected source", async () => {
    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient: prismaFor([baseItem]),
      caseKey: "booking%3ABK-1",
      userId: "user-1",
    });

    expect(detail?.summary.title).toBe("Confirm condenser appointment");
    expect(detail?.evidenceTimeline.map((event) => event.label)).toEqual([
      "Customer called twice.",
      "Need a human confirmation before booking.",
    ]);
    expect(detail?.sourceRefs.map((ref) => ref.kind)).toContain("work-item");
    expect(detail?.room).toMatchObject({
      roomKey: "booking%3ABK-1",
      caseRef: {
        caseId: "booking:BK-1",
        sourceType: "booking",
        sourceId: "BK-1",
      },
      mode: "finite",
      title: "Confirm condenser appointment",
      purpose: "Customer needs a scheduling confirmation.",
      state: "waiting-on-person",
      work: {
        nextAction: "Collect required input",
        attentionRequired: true,
      },
    });
    expect(detail?.room?.boundary.gaps).toEqual(expect.arrayContaining([
      "outcome",
      "scope",
      "participants",
      "accountable",
      "authority",
      "sensitivity",
      "measures",
      "closure-rule",
    ]));
    expect(detail?.room?.activity).toContainEqual(expect.objectContaining({
      eventId: "work-item:WIM-1",
      kind: "message",
      occurredAt: "2026-06-28T10:10:00.000Z",
      emphasis: "quiet",
    }));
  });

  it("returns no room metadata when the scoped work item is not visible to the user", async () => {
    let query: unknown;
    const prismaClient: WorkspaceCasePrismaClient = {
      workItem: {
        findMany: async () => [],
        findFirst: async (args) => {
          query = args;
          return null;
        },
      },
      workItemMessage: {
        findMany: async () => {
          throw new Error("Messages must not load for an inaccessible room.");
        },
      },
    };

    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: "booking%3ABK-PRIVATE",
      userId: "user-without-access",
    });

    expect(detail).toBeNull();
    expect(JSON.stringify(query)).toContain('"assignedToUserId":"user-without-access"');
    expect(JSON.stringify(query)).toContain('"assignedToUserId":null');
  });
});
