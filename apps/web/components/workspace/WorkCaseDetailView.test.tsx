import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkCaseDetailView } from "./WorkCaseDetailView";
import { WorkroomBodyContent } from "./workroom/WorkroomBody";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";
import type { WorkroomView } from "@/lib/work-management/room-types";

const room: WorkroomView = {
  roomKey: "booking%3ABK-1",
  caseRef: { caseId: "booking:BK-1", sourceType: "booking", sourceId: "BK-1" },
  title: "Confirm condenser appointment",
  purpose: "Coordinate the customer appointment.",
  mode: "finite",
  state: "waiting-on-person",
  identity: {
    definition: {
      definitionId: "workroom-definition:booking",
      version: 1,
      sourceKey: "booking",
      label: "Storefront booking",
      mode: "finite",
      decisionScope: "wwwd",
    },
    instance: {
      instanceId: "workroom-instance:booking:BK-1",
      occurrenceTrace: {
        caseRef: { caseId: "booking:BK-1", sourceType: "booking", sourceId: "BK-1" },
        sourceRef: { kind: "source", id: "BK-1", sourceType: "booking" },
        cycleRef: null,
        executionRefs: [{ kind: "work-item", id: "WI-1", status: "awaiting-input" }],
      },
    },
  },
  outcome: {
    statement: "Customer has a confirmed appointment and arrival window.",
    packet: null,
    health: "at-risk",
    sourceRefs: [{ kind: "source", id: "BK-1", sourceType: "booking" }],
  },
  boundary: {
    purpose: "Coordinate the customer appointment.",
    outcome: "Customer has a confirmed appointment and arrival window.",
    scopeIncluded: ["Confirm the appointment"],
    scopeExcluded: [],
    accountablePrincipalRef: "person:dispatcher-1",
    admittedRoleSummary: ["Dispatcher", "Scheduling coworker"],
    authoritySummary: ["May confirm an available service window"],
    sensitivityCeiling: "customer-confidential",
    measures: ["Appointment confirmed"],
    timeBoundary: {
      dueAt: "2026-06-29T15:00:00.000Z",
      reviewAt: null,
      stopConditionSummary: "Stop when the customer confirms.",
    },
    closureRuleSummary: "Close after confirmation is recorded.",
    gaps: [],
    sourceRefs: [{ kind: "source", id: "BK-1", sourceType: "booking" }],
  },
  currentCycle: null,
  completedCycles: [],
  participants: [
    {
      principalRef: "person:dispatcher-1",
      displayName: "Jamie Rivera",
      kind: "person",
      roles: ["accountable"],
      workState: "waiting",
      presence: "active",
      currentWorkSummary: "Waiting for the customer",
      enteredReason: "Owns scheduling",
      sponsorPrincipalRef: null,
      authoritySummary: "May confirm an available service window",
      sourceRefs: [],
      assignmentSource: "explicit",
      coordinatorSource: "none",
    },
    {
      principalRef: "agent:scheduling-1",
      displayName: "Scheduling Coworker",
      kind: "agent",
      roles: ["contributor"],
      workState: "working",
      presence: "active",
      currentWorkSummary: "Checking available windows",
      enteredReason: "Assigned to support scheduling",
      sponsorPrincipalRef: "person:dispatcher-1",
      sponsorDisplayName: "Jamie Rivera",
      authoritySummary: "May prepare options; may not confirm externally",
      sourceRefs: [],
      assignmentSource: "explicit",
      coordinatorSource: "none",
    },
  ],
  activity: [
    {
      eventId: "message:1",
      kind: "message",
      occurredAt: "2026-06-28T12:00:00.000Z",
      actorRef: { actorKind: "person", actorId: "dispatcher-1" },
      summary: "Asked the customer to choose a window.",
      emphasis: "normal",
      sourceRef: { kind: "work-item", id: "WI-1" },
    },
    {
      eventId: "decision:1",
      kind: "decision-resolved",
      occurredAt: "2026-06-28T12:30:00.000Z",
      actorRef: { actorKind: "person", actorId: "dispatcher-1" },
      summary: "Reserved the afternoon window.",
      emphasis: "salient",
      sourceRef: { kind: "decision-interaction", id: "DEC-1" },
    },
  ],
  work: {
    nextAction: "Collect the customer confirmation",
    attentionRequired: true,
    attentionReason: "The customer has not selected a window.",
    blockingActorKind: "person",
    activeCapsuleRefs: [],
    activeTaskRunSummary: null,
    terminal: false,
    sourceRefs: [{ kind: "work-item", id: "WI-1", status: "awaiting-input" }],
  },
  context: {
    refs: [{ kind: "source", id: "BK-1", sourceType: "booking" }],
    digest: "The customer prefers afternoon service.",
    sensitivityCeiling: "customer-confidential",
  },
  receipts: [],
  sourceRefs: [
    { kind: "source", id: "BK-1", sourceType: "booking" },
    { kind: "work-item", id: "WI-1", status: "awaiting-input" },
  ],
  structure: null,
  posture: null,
  processOverseer: {
    shapeKey: null,
    shapeVersion: null,
    collaborationShape: null,
    processOverseerPrincipalRef: "person:dispatcher-1",
    processOverseerSource: "derived",
    currentStageKey: null,
    nextPermittedStageKey: null,
    observed: {
      participantCount: 2,
      receiptKinds: [],
      proposedGrantCount: 0,
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
    },
    deviations: [],
    disposition: "not-applicable",
    interventionReason: "No executable work shape is declared.",
    checkedAt: "2026-06-28T12:00:00.000Z",
    reconciliationKey: "work-room-conformance:fixture",
  },
  projection: {
    confidence: "high",
    incompleteBoundary: false,
    sourceHealth: "ok",
  },
};

const detail: WorkspaceWorkCaseDetailView = {
  summary: {
    caseId: "booking:BK-1",
    href: "/workspace/cases/booking%3ABK-1",
    title: "Confirm condenser appointment",
    sourceLabel: "Storefront booking",
    state: "waiting-on-person",
    stateReason: "Work item is waiting on human input.",
    a2aStatus: "input-required",
    terminal: false,
    nextAction: "Collect required input",
    urgency: "urgent",
    urgencyLabel: "Urgent",
    effortLabel: "Short",
    dueAt: "2026-06-29T15:00:00.000Z",
    assignmentLabel: "Assigned to you",
    attentionRequired: true,
    attentionReason: "Work item is waiting on human input.",
    description: "Customer needs a scheduling confirmation.",
    sourceRefs: [
      { kind: "source", id: "BK-1", sourceType: "booking" },
      { kind: "work-item", id: "WI-1", status: "awaiting-input" },
    ],
  },
  evidenceTimeline: [
    {
      eventId: "evidence:EV-1",
      label: "Customer called twice.",
      sourceRef: { kind: "evidence", id: "EV-1", status: "operator-note" },
    },
  ],
  sourceRefs: [
    { kind: "source", id: "BK-1", sourceType: "booking" },
    { kind: "work-item", id: "WI-1", status: "awaiting-input" },
  ],
  workItemId: "wi-cuid-1",
  workItemTitle: "Confirm condenser appointment",
  room,
};

describe("WorkCaseDetailView", () => {
  it("uses My Work and Work Room language on the existing Workspace route", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain(">My Work<");
    expect(html).toContain(">Work Room<");
    expect(html).toContain('href="/workspace/my-queue"');
    expect(html).not.toContain("<main");
  });

  it("puts outcome, attention, accountability, participants, and next action in the first viewport", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);
    const header = html.slice(0, html.indexOf("</header>"));

    expect(header).toContain("Customer has a confirmed appointment and arrival window.");
    expect(header).toContain("The customer has not selected a window.");
    expect(header).toContain("Jamie Rivera");
    expect(header).toContain("2 participants");
    expect(header).toContain("Collect the customer confirmation");
    expect(header).not.toContain("A2A status");
    expect(header).not.toContain("BK-1");
    expect(header).not.toContain("WI-1");
  });

  it("keeps a long room purpose available without pushing the outcome out of view", () => {
    const longPurpose = "Coordinate this room across a deliberately long operating brief. ".repeat(8);
    const html = renderToStaticMarkup(
      <WorkCaseDetailView
        detail={{ ...detail, room: { ...room, purpose: longPurpose } }}
      />,
    );
    const header = html.slice(0, html.indexOf("</header>"));

    expect(header).toContain("<details");
    expect(header).toContain("Room purpose");
    expect(header).toContain(longPurpose);
    expect(header.indexOf("Room purpose")).toBeLessThan(header.indexOf("Outcome"));
    expect(header).not.toContain("<details open");
  });

  it("keeps the reusable definition visible while detailed work stays disclosed", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain("Overview");
    expect(html).toContain("Details");
    expect(html).toContain("Storefront booking");
    expect(html).toContain("Definition v1");
    expect(html.match(/aria-labelledby="workroom-shape-title"/g)).toHaveLength(2);
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('aria-labelledby="work-room-activity-title"');
    expect(html).not.toContain('aria-labelledby="work-room-participants-title"');
    expect(html).not.toContain("Room details");
    expect(html).not.toContain("Customer called twice.");
  });

  it("reveals activity, participants, evidence, and technical references in Details", () => {
    const html = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={room} mode="detail" onModeChange={() => {}} />,
    );

    expect(html).toContain("<details");
    expect(html).toContain("Room details");
    expect(html.indexOf("Room details")).toBeLessThan(html.indexOf("A2A status"));
    expect(html.indexOf("Room details")).toBeLessThan(html.indexOf("BK-1"));
  });

  it("renders detailed activity kinds with distinct accessible labels", () => {
    const html = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={room} mode="detail" onModeChange={() => {}} />,
    );

    expect(html).toContain('aria-label="Message"');
    expect(html).toContain('aria-label="Decision resolved"');
    expect(html).toContain("Asked the customer to choose a window.");
    expect(html).toContain("Reserved the afternoon window.");
  });

  it("explains an incomplete room boundary without inventing missing facts", () => {
    const incompleteRoom: WorkroomView = {
      ...room,
      outcome: { ...room.outcome, statement: null },
      boundary: {
        ...room.boundary,
        outcome: null,
        accountablePrincipalRef: null,
        gaps: ["outcome", "accountable"],
      },
      projection: { ...room.projection, incompleteBoundary: true, confidence: "medium" },
    };
    const incompleteDetail = {
      ...detail,
      room: incompleteRoom,
    };
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={incompleteDetail} />);

    expect(html).toContain("This room needs a clearer boundary");
    expect(html).toContain("Define the intended outcome and accountable owner");
    expect(html).toContain("Outcome not defined");
    expect(html).toContain("Accountable owner not assigned");
  });

  it("shows one recovery direction when the room source is unavailable", () => {
    const unavailableDetail = {
      ...detail,
      room: {
        ...room,
        projection: { ...room.projection, sourceHealth: "unavailable" as const, confidence: "low" as const },
      },
    };
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={unavailableDetail} />);

    expect(html).toContain("Room source unavailable");
    expect(html).toContain("Return to My Work and try opening the room again");
  });

  it("shows one safe next action when an AI coworker status is unavailable", () => {
    const unavailableCoworkerDetail = {
      ...detail,
      room: {
        ...room,
        participants: room.participants.map((participant) =>
          participant.kind === "agent"
            ? {
                ...participant,
                presence: "unknown" as const,
                workState: "unknown" as const,
                currentWorkSummary: null,
              }
            : participant,
        ),
      },
    };
    const html = renderToStaticMarkup(
      <WorkroomBodyContent
        detail={unavailableCoworkerDetail}
        room={unavailableCoworkerDetail.room}
        mode="detail"
        onModeChange={() => {}}
      />,
    );

    expect(html).toContain("Coworker status unavailable");
    const participantPanel = html.slice(
      html.indexOf('aria-labelledby="work-room-participants-title"'),
      html.indexOf('aria-label="Work"'),
    );
    expect(participantPanel).toContain("<details open=\"\"");
    expect(html.match(/Continue with the room’s next action:/g)).toHaveLength(1);
    expect(html).toContain("Collect the customer confirmation");
    expect(participantPanel).toContain("Why here");
    expect(participantPanel).toContain("Authority");
    expect(participantPanel).toContain("Sponsor");
    expect(participantPanel).toContain("Jamie Rivera");
  });

  it("handles the transitional missing projection honestly", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={{ ...detail, room: undefined }} />);

    expect(html).toContain("Work Room unavailable");
    expect(html).toContain("Return to My Work");
  });

  it("uses DPF theme tokens", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/bg-white|text-blue-|text-red-|text-orange-|text-yellow-|bg-red-|bg-orange-|bg-yellow-|#[0-9a-fA-F]{3,6}/);
  });
});
