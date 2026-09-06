import { describe, expect, it } from "vitest";

import {
  decodeWorkCaseKey,
  encodeWorkCaseKey,
  loadWorkspaceWorkCaseDetail,
  loadWorkspaceWorkCaseLens,
  type WorkspaceCasePrismaClient,
} from "./workspace-case-loader";

type WorkItemFixture = Awaited<ReturnType<WorkspaceCasePrismaClient["workItem"]["findMany"]>>[number];
type CoworkerEngagementFixture =
  Awaited<ReturnType<NonNullable<WorkspaceCasePrismaClient["coworkerEngagement"]>["findMany"]>>[number];

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
    workroom: {
      findMany: async () => [],
    },
    workroomActivity: { findMany: async () => [] },
  };
}

const baseEngagement: CoworkerEngagementFixture = {
  id: "eng-row-1",
  engagementId: "CE-1",
  offerId: "OFFER-1",
  serviceId: "SVC-1",
  providerAgentId: "agent-launch",
  requestedByUserId: "user-1",
  requestedByAgentId: null,
  requestedOutcome: "Prepare the municipal launch readiness packet.",
  priority: "high",
  status: "needs-approval",
  approvalContext: { required: true, reasons: ["paid-provider:funding-context-missing"] },
  auditRefs: { source: "town-informed-exercise" },
  metadata: { exercise: "municipal-launch-readiness" },
  workCapsuleId: null,
  toolExecutionId: null,
  createdAt: new Date("2026-09-06T01:00:00.000Z"),
  updatedAt: new Date("2026-09-06T01:05:00.000Z"),
  completedAt: null,
  provider: { displayName: "Launch Readiness Coworker", name: "launch-readiness" },
  offer: { offerId: "OFFER-1", name: "Launch readiness" },
  service: { serviceId: "SVC-1", name: "Municipal portal readiness" },
};

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

  it("merges coworker service engagements into the attention-first Work Case lens", async () => {
    const prismaClient: WorkspaceCasePrismaClient = {
      ...prismaFor([{ ...baseItem, status: "in-progress", urgency: "routine" }]),
      coworkerEngagement: {
        findMany: async () => [baseEngagement],
        findFirst: async () => baseEngagement,
      },
    };

    const dashboard = await loadWorkspaceWorkCaseLens({
      prismaClient,
      userId: "user-1",
      now: new Date("2026-09-06T01:10:00.000Z"),
    });

    expect(dashboard.cases.map((item) => item.caseId)).toEqual([
      "coworker-engagement:CE-1",
      "booking:BK-1",
    ]);
    expect(dashboard.cases[0]).toMatchObject({
      title: "Prepare the municipal launch readiness packet.",
      sourceLabel: "Coworker engagement",
      state: "awaiting-decision",
      href: "/workspace/cases/coworker-engagement%3ACE-1",
      assignmentLabel: "Requested by you",
      attentionRequired: true,
    });
  });

  it("loads coworker engagement details without a WorkItem comment target", async () => {
    const prismaClient: WorkspaceCasePrismaClient = {
      ...prismaFor([], null),
      coworkerEngagement: {
        findMany: async () => [baseEngagement],
        findFirst: async () => baseEngagement,
      },
    };

    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: encodeWorkCaseKey({ sourceType: "coworker-engagement", sourceId: "CE-1" }),
      userId: "user-1",
      now: new Date("2026-09-06T01:10:00.000Z"),
    });

    expect(detail?.summary).toMatchObject({
      caseId: "coworker-engagement:CE-1",
      sourceLabel: "Coworker engagement",
      state: "awaiting-decision",
      attentionRequired: true,
    });
    expect(detail?.workItemId).toBeNull();
    expect(detail?.sourceRefs).toContainEqual({
      kind: "coworker-engagement",
      id: "CE-1",
      status: "needs-approval",
    });
    expect(detail?.room).toMatchObject({
      roomKey: "coworker-engagement%3ACE-1",
      title: "Prepare the municipal launch readiness packet.",
      purpose: "Prepare the municipal launch readiness packet.",
      state: "awaiting-decision",
      work: {
        nextAction: "Resolve pending decision",
        attentionRequired: true,
      },
    });
    expect(detail?.room?.participants).toContainEqual(expect.objectContaining({
      displayName: "Launch Readiness Coworker",
      kind: "agent",
      roles: ["contributor"],
    }));
  });

  // BI-2310EEE1 — the list and the room must derive one state. A queued WorkItem
  // projects "intake"; a completed capsule anchored to it projects "resolved". Before
  // the fix the list (WorkItem only) showed "intake" while the room (with the capsule)
  // showed "resolved" — the exact dogfood symptom "list says Intake, room says Resolved".
  it("list and room agree on state when a capsule out-projects the WorkItem", async () => {
    const item = {
      ...baseItem,
      id: "row-cap",
      itemId: "WI-CAP",
      sourceType: "work-capsule",
      sourceId: "WC-9",
      title: "Coding carrier",
      status: "queued",
      assignedToUserId: "user-1",
    };
    const prismaClient: WorkspaceCasePrismaClient = {
      workItem: { findMany: async () => [item], findFirst: async () => item },
      workItemMessage: { findMany: async () => [] },
      workroom: {
        findMany: async () => [{ workItemId: "row-cap", capsuleId: "WC-9", status: "complete", title: "Coding carrier" }],
      },
      workroomActivity: { findMany: async () => [] },
    };
    const now = new Date("2026-06-28T12:00:00.000Z");
    const list = await loadWorkspaceWorkCaseLens({ prismaClient, userId: "user-1", now });
    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: "WC-9" }),
      userId: "user-1",
      now,
    });

    expect(list.cases[0]?.state).toBe("resolved");
    expect(list.cases[0]?.state).toBe(detail?.summary.state);
  });

  // The "Active" tile counts state === active | verifying. A verifying capsule the list
  // could not previously see read as 0 beside a listed room; now the list sees it.
  it("the Active tile counts a verifying capsule the list can now see", async () => {
    const item = {
      ...baseItem,
      id: "row-v",
      itemId: "WI-V",
      sourceType: "work-capsule",
      sourceId: "WC-V",
      title: "Coding carrier",
      status: "queued",
      assignedToUserId: "user-1",
    };
    const prismaClient: WorkspaceCasePrismaClient = {
      workItem: { findMany: async () => [item], findFirst: async () => item },
      workItemMessage: { findMany: async () => [] },
      workroom: {
        findMany: async () => [{ workItemId: "row-v", capsuleId: "WC-V", status: "verifying", title: "Coding carrier" }],
      },
      workroomActivity: { findMany: async () => [] },
    };
    const list = await loadWorkspaceWorkCaseLens({
      prismaClient,
      userId: "user-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(list.cases[0]?.state).toBe("verifying");
    expect(list.stats.active).toBe(1);
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

  it("loads the current cycle, completed packets, and governed receipts from canonical child records", async () => {
    const boundary = (cycleKey: string) => ({
      workroomCycle: {
        kind: "work-room-cycle",
        version: 1,
        cycleKey,
        trigger: "Weekly schedule fired.",
        objective: "Review cash position and assign exceptions.",
        accountablePrincipalRef: "prn-finance-owner",
        expectedReviewAt: "2026-08-08T16:00:00.000Z",
        stopConditions: ["Stop if the ledger is unreconciled."],
        measureSummary: "All material variances have an owner.",
        contextRefs: [{ kind: "evidence", id: `cash:${cycleKey}` }],
      },
    });
    const current = {
      ...baseItem,
      id: "cycle-row-32",
      itemId: "WI-CYCLE-32",
      sourceType: "scheduled",
      sourceId: "WEEKLY-CASH",
      title: "Weekly cash review — 2026-W32",
      status: "in-progress",
      evidence: boundary("2026-W32"),
      createdAt: new Date("2026-08-02T09:00:00.000Z"),
    };
    const completed = {
      ...current,
      id: "cycle-row-31",
      itemId: "WI-CYCLE-31",
      title: "Weekly cash review — 2026-W31",
      status: "completed",
      evidence: boundary("2026-W31"),
      createdAt: new Date("2026-07-27T09:00:00.000Z"),
      completedAt: new Date("2026-08-01T16:00:00.000Z"),
    };
    const scheduled = {
      ...baseItem,
      id: "room-row",
      itemId: "ROOM-WEEKLY-CASH",
      sourceType: "scheduled",
      sourceId: "WEEKLY-CASH",
      title: "Weekly cash review",
      status: "in-progress",
      childItems: [completed, current],
    };
    const packet = {
      outcomeState: "achieved" as const,
      summary: "Weekly cash review completed.",
      decisionRefs: [],
      artifactRefs: [],
      actionRefs: [],
      receiptRefs: [{ kind: "receipt" as const, id: "R-31" }],
      evidenceRefs: [{ kind: "runtime-verification" as const, id: "RV-31" }],
      unresolvedWork: [],
      accountablePrincipalRef: "prn-finance-owner",
      verifiedByRef: "prn-controller",
      completedAt: "2026-08-01T16:00:00.000Z",
      nextReviewAt: "2026-08-08T16:00:00.000Z",
      sourceRefs: [{ kind: "receipt" as const, id: "R-31" }],
    };
    const prismaClient: WorkspaceCasePrismaClient = {
      workItem: {
        findMany: async () => [scheduled],
        findFirst: async () => scheduled,
      },
      workItemMessage: {
        findMany: async () => [{
          id: "message-row-outcome",
          messageId: "MSG-OUTCOME-31",
          workItemId: "room-row",
          senderType: "user",
          senderUserId: "user-1",
          messageType: "work-room-outcome-packet",
          body: packet.summary,
          structuredPayload: {
            kind: "work-room-outcome-packet",
            version: 1,
            cycleKey: "2026-W31",
            carrierId: "WI-CYCLE-31",
            packet,
            receipt: {
              kind: "work-room-lifecycle-receipt",
              operation: "complete-cycle",
              receiptKind: "governed-action",
              enforcementMode: "governed-action",
              status: "valid",
              idempotencyKey: "complete:2026-W31",
              policyRefs: ["work-case-policy-envelope"],
            },
          },
          createdAt: new Date("2026-08-01T16:00:00.000Z"),
        }],
      },
      workroom: {
        findMany: async () => [],
      },
      workroomActivity: { findMany: async () => [] },
    };

    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: "scheduled%3AWEEKLY-CASH",
      userId: "user-1",
    });

    expect(detail?.room?.currentCycle).toMatchObject({ cycleKey: "2026-W32", carrierId: "WI-CYCLE-32" });
    expect(detail?.room?.completedCycles).toHaveLength(1);
    expect(detail?.room?.completedCycles[0]).toMatchObject({ cycleKey: "2026-W31", outcomePacket: packet });
    expect(detail?.room?.outcome.packet).toEqual(packet);
    expect(detail?.room?.activity).toContainEqual(expect.objectContaining({ kind: "cycle-closed" }));
    expect(detail?.room?.receipts).toContainEqual(expect.objectContaining({
      enforcementMode: "governed-action",
      actionType: "complete-cycle",
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
      workroom: {
        findMany: async () => [],
      },
      workroomActivity: { findMany: async () => [] },
    };

    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: "booking%3ABK-PRIVATE",
      userId: "user-without-access",
    });

    expect(detail).toBeNull();
    expect(JSON.stringify(query)).toContain('"sourceType":"booking"');
  });

  it("checks sensitivity before loading room messages", async () => {
    let messagesLoaded = false;
    const protectedItem = {
      ...baseItem,
      evidence: [{
        kind: "work-room-policy",
        workroomPolicy: {
          admittedPrincipalRefs: ["PRN-USER-1"],
          sensitivityCeiling: "confidential",
        },
      }],
    };
    const client = prismaFor([protectedItem], protectedItem);
    client.workItemMessage.findMany = async () => {
      messagesLoaded = true;
      return [];
    };

    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient: client,
      caseKey: "booking%3ABK-1",
      userId: "user-1",
      authContext: {
        principalId: "PRN-USER-1",
        sensitivityClearance: ["public", "internal"],
        isSuperuser: false,
      },
    });

    expect(detail).toBeNull();
    expect(messagesLoaded).toBe(false);
  });

  it("projects governed participants through the room adapter", async () => {
    let policyParticipants: unknown;
    const itemWithParticipantPolicy = {
      ...baseItem,
      evidence: [{
        workroomPolicy: {
          participants: [{
            principalRef: "PRN-REVIEWER",
            roles: ["reviewer"],
            enteredReason: "Reviews completion evidence",
          }],
        },
      }],
    };
    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient: prismaFor([itemWithParticipantPolicy]),
      caseKey: "booking%3ABK-1",
      userId: "user-1",
      participantLoader: async (input) => {
        policyParticipants = input.policyParticipants;
        return [{
        principalRef: "PRN-AGENT",
        displayName: "Scheduling Coworker",
        kind: "agent",
        roles: ["contributor"],
        workState: "working",
        presence: "active",
        currentWorkSummary: "Checking available windows",
        enteredReason: "Joined through active room lineage",
        sponsorPrincipalRef: "PRN-USER-1",
        authoritySummary: "May prepare options; approval remains human",
        sourceRefs: [{ kind: "evidence", id: "TR-1", sourceType: "task-run" }],
        assignmentSource: "conversation",
        coordinatorSource: "none",
        }];
      },
    });

    expect(detail?.room?.participants).toEqual([
      expect.objectContaining({
        principalRef: "PRN-AGENT",
        sponsorPrincipalRef: "PRN-USER-1",
      }),
    ]);
    expect(policyParticipants).toEqual([{
      principalRef: "PRN-REVIEWER",
      roles: ["reviewer"],
      enteredReason: "Reviews completion evidence",
      currentWorkSummary: null,
    }]);
  });

  it("does not reveal a room assigned to another person", async () => {
    let messagesLoaded = false;
    const assignedElsewhere = { ...baseItem, assignedToUserId: "user-2" };
    const client = prismaFor([assignedElsewhere], assignedElsewhere);
    client.workItemMessage.findMany = async () => {
      messagesLoaded = true;
      return [];
    };

    expect(await loadWorkspaceWorkCaseDetail({
      prismaClient: client,
      caseKey: "booking%3ABK-1",
      userId: "user-1",
    })).toBeNull();
    expect(messagesLoaded).toBe(false);
  });

  // BI-1CF7B600 — a capsule-sourced room showed "No activity yet" while its execution
  // journal (WorkroomActivity rows) had entries; those rows never reached the feed.
  it("surfaces the capsule's activity journal in the room feed", async () => {
    const item = {
      ...baseItem,
      id: "row-act",
      itemId: "WI-ACT",
      sourceType: "work-capsule",
      sourceId: "WC-7",
      title: "Coding carrier",
      status: "in-progress",
      assignedToUserId: "user-1",
      evidence: [],
    };
    const prismaClient: WorkspaceCasePrismaClient = {
      workItem: { findMany: async () => [item], findFirst: async () => item },
      workItemMessage: { findMany: async () => [] },
      workroom: {
        findMany: async () => [{ id: "cap-row", capsuleId: "WC-7", status: "working", title: "Coding carrier" }],
      },
      workroomActivity: {
        findMany: async () => [
          {
            id: "ACT-1",
            workCapsuleId: "cap-row",
            kind: "work-started",
            summary: "Build started on the coding carrier",
            recordedAt: new Date("2026-06-28T10:20:00.000Z"),
            recordedByAgentId: "AGT-BUILD",
          },
        ],
      },
    };
    const detail = await loadWorkspaceWorkCaseDetail({
      prismaClient,
      caseKey: encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: "WC-7" }),
      userId: "user-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    const summaries = detail?.room?.activity.map((entry) => entry.summary) ?? [];
    expect(summaries).toContain("Build started on the coding carrier");
    const entry = detail?.room?.activity.find((a) => a.summary === "Build started on the coding carrier");
    expect(entry?.sourceRef).toMatchObject({ kind: "work-capsule", id: "WC-7" });
    expect(entry?.actorRef?.actorKind).toBe("agent");
  });
});
