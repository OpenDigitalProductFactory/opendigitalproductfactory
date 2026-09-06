import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkroomView } from "@/lib/work-management/room-types";

import { WorkroomProcessOverseer } from "./WorkroomProcessOverseer";

function room(processOverseer: WorkroomView["processOverseer"]): WorkroomView {
  return {
    processOverseer,
    participants: [{
      principalRef: "PRN-COORD",
      displayName: "Morgan Lee",
      kind: "person",
      roles: ["coordinator"],
      workState: "working",
      presence: "active",
      currentWorkSummary: null,
      enteredReason: null,
      sponsorPrincipalRef: null,
      authoritySummary: "Coordinates process",
      sourceRefs: [],
      assignmentSource: "explicit",
      coordinatorSource: "explicit",
    }],
  } as unknown as WorkroomView;
}

describe("WorkroomProcessOverseer", () => {
  it("explains the explicit coordinator, stage, disposition, and check time", () => {
    const html = renderToStaticMarkup(<WorkroomProcessOverseer room={room({
      shapeKey: "obligation-assurance-watch",
      shapeVersion: "1.0.0",
      collaborationShape: "approval-sign-off",
      processOverseerPrincipalRef: "PRN-COORD",
      processOverseerSource: "explicit",
      currentStageKey: "sweep",
      nextPermittedStageKey: "raise",
      observed: {
        participantCount: 1,
        receiptKinds: [],
        proposedGrantCount: 0,
        budgetUsage: [],
        stopConditionHits: [],
        reviewDue: false,
      },
      deviations: [],
      disposition: "continue",
      interventionReason: null,
      checkedAt: "2026-09-01T12:00:00.000Z",
      reconciliationKey: "work-room-conformance:abc123",
    })} />);

    expect(html).toContain("Process Overseer");
    expect(html).toContain("Morgan Lee");
    expect(html).toContain("Explicit assignment");
    expect(html).toContain("Sweep");
    expect(html).toContain("Raise");
    expect(html).toContain("Continue");
    expect(html).toContain("<time");
  });

  it("labels derived coordination as compatibility-only and explains intervention", () => {
    const html = renderToStaticMarkup(<WorkroomProcessOverseer room={room({
      shapeKey: null,
      shapeVersion: null,
      collaborationShape: null,
      processOverseerPrincipalRef: "PRN-COORD",
      processOverseerSource: "derived",
      currentStageKey: null,
      nextPermittedStageKey: null,
      observed: {
        participantCount: 1,
        receiptKinds: [],
        proposedGrantCount: 0,
        budgetUsage: [],
        stopConditionHits: [],
        reviewDue: false,
      },
      deviations: [],
      disposition: "not-applicable",
      interventionReason: "No executable work shape is declared.",
      checkedAt: "2026-09-01T12:00:00.000Z",
      reconciliationKey: "work-room-conformance:def456",
    })} />);

    expect(html).toContain("Compatibility-only derived assignment");
    expect(html).toContain("No executable work shape is declared.");
  });

  it("uses theme tokens rather than hardcoded colours", () => {
    const html = renderToStaticMarkup(<WorkroomProcessOverseer room={room({
      shapeKey: null,
      shapeVersion: null,
      collaborationShape: null,
      processOverseerPrincipalRef: null,
      processOverseerSource: "none",
      currentStageKey: null,
      nextPermittedStageKey: null,
      observed: { participantCount: 0, receiptKinds: [], proposedGrantCount: 0, budgetUsage: [], stopConditionHits: [], reviewDue: false },
      deviations: [],
      disposition: "not-applicable",
      interventionReason: "No executable work shape is declared.",
      checkedAt: "2026-09-01T12:00:00.000Z",
      reconciliationKey: "work-room-conformance:none",
    })} />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("text-white");
    expect(html).not.toMatch(/\btext-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});
