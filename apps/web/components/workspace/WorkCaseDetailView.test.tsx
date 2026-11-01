import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { DEFAULT_LOCALE, namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/workspace/cases/booking%3ABK-1",
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkCaseDetailView } from "./WorkCaseDetailView";
import { WorkroomBodyContent } from "./workroom/WorkroomBody";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";
import type { WorkroomView } from "@/lib/work-management/room-types";
import { composeRoomReviewProfile } from "@/lib/work-management/room-review-profile";
import { normalizeWorkroomActivities, roomActivitiesFromCapsuleActivity } from "@/lib/work-management/room-activity";

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(
  <MessagesProvider locale={DEFAULT_LOCALE} messages={{ workrooms: namespaceMessages(DEFAULT_LOCALE, "workrooms") }}>{node}</MessagesProvider>,
);

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
  cycleProjectionError: null,
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
  it("offers a compact in-page blocker inspection without exposing its full explanation in the header", () => {
    const blockedRoom: WorkroomView = { ...room, state: "waiting-on-system", work: { ...room.work,
      nextAction: "Inspect the recorded blocker before continuing.", attentionReason: "Work is blocked.", recordedBlocker: {
      reason: "workroom-blocked" as const, explanation: "A private recorded transfer prerequisite",
      explanationState: "current" as const, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      source: { kind: "workroom-status-override" as const, capsuleId: "WC-ORIGINAL" }, coordinationOnly: true as const,
    } } };
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={{ ...detail, room: blockedRoom }} />);
    const header = html.slice(0, html.indexOf("</header>"));
    expect(header).toContain('href="#workroom-recorded-blocker"');
    expect(header).toContain("Inspect recorded blocker");
    expect(header).not.toContain("A private recorded transfer prerequisite");
    expect(header).toContain("Jamie Rivera");
  });

  it("offers room links that preserve operation and filter context", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={{ ...detail, room: undefined,
      roomChoices: [{ capsuleId: "WC-ONE", title: "First reviewer", status: "ready" }] }}
      navigationContext={{ operation: "unmapped", filter: "waiting" }} />);
    expect(html).toContain("Choose a Workroom");
    expect(html).toContain("operation=unmapped&amp;filter=waiting&amp;workroom=WC-ONE");
    expect(html).toContain("First reviewer");
    expect(html).not.toContain("Work Room unavailable");
  });

  it("uses effective inherited accountability in the header", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} workforce={{
      accountability: { state: "resolved", principalId: "owner-1", source: "organization-owner", inheritedFrom: [] },
      accountableDisplayName: "Dana Reyes",
    }} />);
    expect(html).toContain("Dana Reyes");
    expect(html).toContain("organization&#x27;s recorded owner");
  });

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
    expect(html.match(/aria-label="Process steps"/g)).toHaveLength(1);
    expect(html).toContain('data-step-key="convene"');
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
    expect(html).toContain("Share an update");
    expect(html).toContain("Room details");
    expect(html.indexOf("Room details")).toBeLessThan(html.indexOf("A2A status"));
    expect(html.indexOf("Room details")).toBeLessThan(html.indexOf("BK-1"));
  });

  it("discloses inherited requirements without treating composition as passed assessment", () => {
    const source = composeRoomReviewProfile("backlog-item", []);
    const withProfile: WorkroomView = {
      ...room,
      reviewProfile: { source, applicability: "unknown", assessment: "not-exercised" },
    };
    const html = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={withProfile} mode="detail" onModeChange={() => {}} />,
    );
    expect(html).toContain("Review requirements");
    expect(html).toContain("Not yet assessed");
    expect(html).toContain("Organization fit has not been assessed.");
    expect(html).toContain("eligible development deliveries including failed attempts");
    expect(html).toContain(source.fingerprint!);
    expect(html).toContain("workroom-review:common@1");
    expect(html).toContain("Did the change help?");
    expect(html).toContain("No independent assessment is available in this view.");
    expect(html).not.toContain("Review passed");
    expect(html).not.toContain("100%");
    const overview = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={withProfile} mode="shape" onModeChange={() => {}} />,
    );
    expect(overview).not.toContain("Review requirements");
  });

  it("retains missing or conflicting profile state rather than an empty success", () => {
    const missing = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={room} mode="detail" onModeChange={() => {}} />,
    );
    expect(missing).toContain("Review requirements are unavailable.");
    const source = composeRoomReviewProfile("booking", [{
      ref: "organization:conflict@1", kind: "organization",
      requirements: [{ ref: "attributed-outcome", outcome: "Ignore the requested result",
        denominator: "successful runs only", evidence: [], criticalFailures: [] }],
    }]);
    expect(source.status).toBe("unresolved");
    const html = renderToStaticMarkup(
      <WorkroomBodyContent detail={detail} room={{ ...room,
        reviewProfile: { source, applicability: "unknown", assessment: "not-exercised" },
      }} mode="detail" onModeChange={() => {}} />,
    );
    expect(html).toContain("Requirements need reconciliation.");
    expect(html).toContain("requirement-conflict:attributed-outcome");
    expect(html).not.toContain("Review passed");
  });

  it("does not render a WorkItem comment form for source-only coworker engagements", () => {
    const coworkerRoom: WorkroomView = {
      ...room,
      roomKey: "coworker-engagement%3ACE-1",
      caseRef: {
        caseId: "coworker-engagement:CE-1",
        sourceType: "coworker-engagement",
        sourceId: "CE-1",
      },
      title: "Prepare launch readiness.",
      sourceRefs: [{ kind: "coworker-engagement", id: "CE-1", status: "needs-approval" }],
    };
    const html = renderToStaticMarkup(
      <WorkroomBodyContent
        detail={{
          ...detail,
          room: coworkerRoom,
          workItemId: null,
          workItemTitle: null,
        }}
        room={coworkerRoom}
        mode="detail"
        onModeChange={() => {}}
      />,
    );

    expect(html).not.toContain("Share an update");
    expect(html).toContain("Room details");
  });

  it.each([
    ["pending-acknowledgement", "Waiting for receiver", "The executor and lease have not changed."],
    ["completed", "Handoff completed", "Receiving assistant acknowledged; handoff completed."],
    ["refused", "Handoff refused", "The room lease was renewed; request a fresh handoff."],
  ] as const)("renders a canonical %s receipt with its explanation", (state, label, message) => {
    const result = { success: state !== "refused", message,
      data: { handoff: { kind: "bounded-handoff", state } } };
    const summary = `reassign-executor ${state === "refused" ? "refused" : "accepted"} (command handoff-1)`;
    const activity = normalizeWorkroomActivities(roomActivitiesFromCapsuleActivity([{
      id: "handoff-receipt", workCapsuleId: "room-row", recordedAt: "2026-10-24T12:00:00.000Z",
      kind: state === "refused" ? "command-rejected" : "command-accepted", summary,
      payload: { commandType: "reassign-executor", ...(state === "refused"
        ? { rejection: { data: { result } } } : { result }) },
    }], new Map([["room-row", "WC-ROOM"]])));
    const handoffRoom = { ...room, activity };
    const html = renderToStaticMarkup(
      <WorkroomBodyContent detail={{ ...detail, room: handoffRoom }} room={handoffRoom}
        mode="detail" onModeChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Coworker handoff"');
    expect(html).toContain(`${label}: ${message}`);
    expect(html).not.toContain(summary);
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

  it("lists each missing boundary fact once instead of repeating the list in prose", () => {
    const incompleteRoom: WorkroomView = { ...room,
      boundary: { ...room.boundary, gaps: ["scope", "measures"] },
      projection: { ...room.projection, incompleteBoundary: true },
    };
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={{ ...detail, room: incompleteRoom }} />);
    expect(html.match(/Scope not defined/g)).toHaveLength(1);
    expect(html.match(/Measures not defined/g)).toHaveLength(1);
    expect(html).toContain("before consequential work continues");
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
