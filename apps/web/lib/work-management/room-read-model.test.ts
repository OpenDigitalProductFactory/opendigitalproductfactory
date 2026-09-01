import { describe, expect, it } from "vitest";

import type { WorkCaseDetail, WorkCaseSourceRef } from "./case-types";
import {
  buildWorkroomView,
  type BuildWorkroomViewInput,
} from "./room-read-model";

const sourceRef: WorkCaseSourceRef = {
  kind: "source",
  id: "BK-100",
  sourceType: "booking",
};

function caseDetail(overrides: Partial<WorkCaseDetail["summary"]> = {}): WorkCaseDetail {
  return {
    summary: {
      caseId: "booking:BK-100",
      title: "Restore cooling",
      sourceLabel: "Storefront booking",
      state: "active",
      stateReason: "Work is in progress.",
      a2aStatus: "working",
      terminal: false,
      nextAction: "Continue work",
      dueAt: "2026-07-30T17:00:00.000Z",
      assignedToUserId: "user-1",
      attention: {
        required: false,
        reason: null,
      },
      sourceRefs: [sourceRef],
      ...overrides,
    },
    capsules: [],
    decisions: [],
    evidence: [],
    timeline: [],
  };
}

function completeBoundary(): BuildWorkroomViewInput["boundary"] {
  return {
    purpose: "Coordinate the repair without losing customer context.",
    outcome: "Cooling is restored and verified.",
    scopeIncluded: ["Diagnosis", "Repair", "Verification"],
    scopeExcluded: ["Unrelated electrical work"],
    accountablePrincipalRef: "prn-user-1",
    admittedRoleSummary: ["Accountable technician", "AI diagnostic contributor"],
    authoritySummary: ["Technician may act within the approved booking scope"],
    sensitivityCeiling: "medium",
    measures: ["Cooling reaches the configured set point"],
    timeBoundary: {
      dueAt: "2026-07-30T17:00:00.000Z",
      reviewAt: null,
      stopConditionSummary: "Stop and escalate if electrical damage is found.",
    },
    closureRuleSummary: "Close after customer confirmation and verification evidence.",
    sourceRefs: [sourceRef],
  };
}

describe("Work Room read model", () => {
  it("projects a finite Work Case without creating a second identity", () => {
    const room = buildWorkroomView({
      caseKey: "booking%3ABK-100",
      detail: caseDetail(),
      boundary: completeBoundary(),
      participants: [
        {
          principalRef: "prn-user-1",
          displayName: "Casey Morgan",
          kind: "person",
          roles: ["accountable"],
          workState: "working",
          presence: "unknown",
          currentWorkSummary: "Coordinating repair.",
          enteredReason: "Assigned accountable owner.",
          sponsorPrincipalRef: null,
          authoritySummary: "Can act within the approved booking scope",
          sourceRefs: [sourceRef],
          assignmentSource: "explicit",
          coordinatorSource: "none",
        },
      ],
      context: {
        refs: [sourceRef],
        digest: "Booking, repair scope, and current work status.",
        sensitivityCeiling: "medium",
      },
    });

    expect(room).toMatchObject({
      roomKey: "booking%3ABK-100",
      caseRef: {
        caseId: "booking:BK-100",
        sourceType: "booking",
        sourceId: "BK-100",
      },
      title: "Restore cooling",
      purpose: "Coordinate the repair without losing customer context.",
      mode: "finite",
      state: "active",
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
          instanceId: "workroom-instance:booking:BK-100",
          occurrenceTrace: {
            caseRef: {
              caseId: "booking:BK-100",
              sourceType: "booking",
              sourceId: "BK-100",
            },
            sourceRef,
            cycleRef: null,
            executionRefs: [],
          },
        },
      },
      outcome: {
        statement: "Cooling is restored and verified.",
        sourceRefs: [sourceRef],
      },
      projection: {
        confidence: "high",
        incompleteBoundary: false,
        sourceHealth: "ok",
      },
    });
    expect(room.roomKey).toBe("booking%3ABK-100");
    expect(room.work.sourceRefs).toEqual([sourceRef]);
  });

  it("derives standing mode only from typed source policy", () => {
    const scheduledRef: WorkCaseSourceRef = {
      kind: "source",
      id: "WEEKLY-CASH",
      sourceType: "scheduled",
    };
    const room = buildWorkroomView({
      caseKey: "scheduled%3AWEEKLY-CASH",
      detail: caseDetail({
        caseId: "scheduled:WEEKLY-CASH",
        title: "Weekly cash review",
        sourceLabel: "Scheduled work",
        sourceRefs: [scheduledRef],
      }),
      boundary: completeBoundary(),
      context: {
        refs: [sourceRef],
        digest: "Current cash position.",
        sensitivityCeiling: "high",
      },
    });

    expect(room.mode).toBe("standing");
  });

  it("traces the current cycle and execution carriers without requiring development evidence", () => {
    const detail = caseDetail();
    detail.timeline = [{
      eventId: "capsule:1",
      label: "Delivery room claimed.",
      sourceRef: { kind: "work-capsule", id: "WC-100", status: "working" },
    }];
    const room = buildWorkroomView({
      caseKey: "booking%3ABK-100",
      detail,
      currentCycle: {
        cycleKey: "visit-1",
        carrierKind: "work-item",
        carrierId: "WI-VISIT-1",
        trigger: "Customer confirmed the visit.",
        objective: "Complete the scheduled repair.",
        accountablePrincipalRef: "prn-user-1",
        openedAt: "2026-07-30T14:00:00.000Z",
        expectedReviewAt: null,
        stopConditions: [],
        measureSummary: null,
        status: "open",
        outcomePacket: null,
        sourceRefs: [{ kind: "work-item", id: "WI-VISIT-1" }],
      },
    });

    expect(room.identity.instance.occurrenceTrace).toMatchObject({
      cycleRef: { kind: "work-item", id: "WI-VISIT-1", status: "open" },
      executionRefs: [
        { kind: "work-capsule", id: "WC-100", status: "working" },
        { kind: "work-item", id: "WI-VISIT-1" },
      ],
    });
  });

  it("defaults unknown sources to finite with low confidence and complete gap reporting", () => {
    const unknownRef: WorkCaseSourceRef = {
      kind: "source",
      id: "EXT-1",
      sourceType: "external-ticket",
    };
    const room = buildWorkroomView({
      caseKey: "external-ticket%3AEXT-1",
      detail: caseDetail({
        caseId: "external-ticket:EXT-1",
        title: "Unregistered work",
        sourceLabel: "external-ticket",
        dueAt: null,
        assignedToUserId: null,
        sourceRefs: [unknownRef],
      }),
    });

    expect(room.mode).toBe("finite");
    expect(room.projection).toEqual({
      confidence: "low",
      incompleteBoundary: true,
      sourceHealth: "partial",
    });
    expect(room.identity).toMatchObject({
      definition: null,
      instance: {
        instanceId: "workroom-instance:external-ticket:EXT-1",
        occurrenceTrace: {
          sourceRef: unknownRef,
          cycleRef: null,
        },
      },
    });
    expect(room.boundary.gaps).toEqual([
      "purpose",
      "outcome",
      "scope",
      "participants",
      "accountable",
      "authority",
      "sensitivity",
      "context",
      "measures",
      "time-boundary",
      "closure-rule",
    ]);
  });

  it("keeps participant roles, work state, and presence as separate axes", () => {
    const room = buildWorkroomView({
      caseKey: "booking%3ABK-100",
      detail: caseDetail(),
      boundary: completeBoundary(),
      context: {
        refs: [sourceRef],
        digest: "Booking context.",
        sensitivityCeiling: "medium",
      },
      participants: [
        {
          principalRef: "prn-user-1",
          displayName: "Casey Morgan",
          kind: "person",
          roles: ["accountable", "reviewer"],
          workState: "waiting",
          presence: "active",
          currentWorkSummary: "Waiting for diagnostic evidence.",
          enteredReason: "Assigned accountable owner.",
          sponsorPrincipalRef: null,
          authoritySummary: "Can approve and complete",
          sourceRefs: [sourceRef],
          assignmentSource: "explicit",
          coordinatorSource: "none",
        },
      ],
    });

    expect(room.participants[0]).toMatchObject({
      roles: ["accountable", "reviewer"],
      workState: "waiting",
      presence: "active",
    });
    expect(room.participants[0]?.sourceRefs).toEqual([sourceRef]);
  });

  it("deduplicates duplicate source delivery with a stable activity event id", () => {
    const activity = {
      sourceEventId: "WIM-1",
      kind: "message" as const,
      occurredAt: "2026-07-27T10:00:00.000Z",
      actorRef: {
        actorKind: "agent" as const,
        actorId: "agent-1",
      },
      summary: "I am checking the diagnostic evidence.",
      sourceRef: {
        kind: "work-item" as const,
        id: "WI-100",
        status: "comment",
      },
    };
    const input: BuildWorkroomViewInput = {
      caseKey: "booking%3ABK-100",
      detail: caseDetail(),
      activities: [activity, activity],
    };

    const first = buildWorkroomView(input);
    const second = buildWorkroomView(input);

    expect(first.activity).toHaveLength(1);
    expect(first.activity[0]).toMatchObject({
      eventId: "work-item:WIM-1",
      kind: "message",
      emphasis: "quiet",
    });
    expect(second.activity[0]?.eventId).toBe(first.activity[0]?.eventId);
  });

  it("preserves terminal Work Case behavior without inferring completion facts", () => {
    const room = buildWorkroomView({
      caseKey: "booking%3ABK-100",
      detail: caseDetail({
        state: "closed",
        terminal: true,
        nextAction: "No action",
      }),
      activities: [
        {
          sourceEventId: "WIM-2",
          kind: "message",
          occurredAt: "2026-07-27T11:00:00.000Z",
          actorRef: null,
          summary: "Looks done to me.",
          sourceRef,
        },
      ],
    });

    expect(room.state).toBe("closed");
    expect(room.work).toMatchObject({
      nextAction: "No action",
      terminal: true,
    });
    expect(room.outcome.packet).toBeNull();
    expect(room.activity[0]?.kind).toBe("message");
  });
});
