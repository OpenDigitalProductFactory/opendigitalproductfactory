import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkroomView } from "@/lib/work-management/room-types";

import { WorkroomCycles } from "./WorkroomCycles";

function room(): WorkroomView {
  const packet = {
    outcomeState: "partially-achieved" as const,
    summary: "Last week closed with one follow-up.",
    decisionRefs: [],
    artifactRefs: [],
    actionRefs: [],
    receiptRefs: [{ kind: "receipt" as const, id: "R-31" }],
    evidenceRefs: [{ kind: "runtime-verification" as const, id: "RV-31" }],
    unresolvedWork: [{ summary: "Recheck late payment", ownerRef: null, disposition: "carry-over" as const }],
    accountablePrincipalRef: "prn-finance-owner",
    verifiedByRef: "prn-controller",
    completedAt: "2026-08-01T16:00:00.000Z",
    nextReviewAt: "2026-08-08T16:00:00.000Z",
    sourceRefs: [{ kind: "receipt" as const, id: "R-31" }],
  };
  const cycle = {
    cycleKey: "2026-W32",
    carrierKind: "work-item" as const,
    carrierId: "WI-CYCLE-32",
    trigger: "Weekly schedule fired.",
    objective: "Review cash position and assign exceptions.",
    accountablePrincipalRef: "prn-finance-owner",
    openedAt: "2026-08-02T09:00:00.000Z",
    expectedReviewAt: "2026-08-08T16:00:00.000Z",
    stopConditions: ["Stop if the ledger is unreconciled."],
    measureSummary: "All material variances have an owner.",
    status: "open" as const,
    outcomePacket: null,
    sourceRefs: [{ kind: "work-item" as const, id: "WI-CYCLE-32" }],
  };
  return {
    roomKey: "scheduled%3AWEEKLY-CASH",
    caseRef: { caseId: "scheduled:WEEKLY-CASH", sourceType: "scheduled", sourceId: "WEEKLY-CASH" },
    identity: {
      definition: {
        definitionId: "workroom-definition:scheduled",
        version: 1,
        sourceKey: "scheduled",
        label: "Scheduled work",
        mode: "standing",
        decisionScope: "wwwd",
      },
      instance: {
        instanceId: "workroom-instance:scheduled:WEEKLY-CASH",
        occurrenceTrace: {
          caseRef: { caseId: "scheduled:WEEKLY-CASH", sourceType: "scheduled", sourceId: "WEEKLY-CASH" },
          sourceRef: { kind: "source", id: "WEEKLY-CASH", sourceType: "scheduled" },
          cycleRef: { kind: "work-item", id: "WI-CYCLE-32", status: "open" },
          executionRefs: [{ kind: "work-item", id: "WI-CYCLE-32" }],
        },
      },
    },
    title: "Weekly cash review",
    purpose: "Keep the weekly cash position current.",
    mode: "standing",
    state: "active",
    outcome: { statement: null, packet, health: "on-track", sourceRefs: [] },
    boundary: {
      purpose: "Keep the weekly cash position current.", outcome: null, scopeIncluded: [], scopeExcluded: [],
      accountablePrincipalRef: "prn-finance-owner", admittedRoleSummary: [], authoritySummary: [],
      sensitivityCeiling: "high", measures: [], timeBoundary: { dueAt: null, reviewAt: null, stopConditionSummary: null },
      closureRuleSummary: null, gaps: [], sourceRefs: [],
    },
    currentCycle: cycle,
    completedCycles: [{ ...cycle, cycleKey: "2026-W31", carrierId: "WI-CYCLE-31", status: "closed", outcomePacket: packet }],
    participants: [], activity: [],
    work: { nextAction: "Continue work", attentionRequired: false, attentionReason: null, blockingActorKind: null, activeCapsuleRefs: [], activeTaskRunSummary: null, terminal: false, sourceRefs: [] },
    context: { refs: [], digest: null, sensitivityCeiling: "high" }, receipts: [], sourceRefs: [],
    structure: null,
    posture: null,
    processOverseer: {
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
      checkedAt: "2026-08-02T09:00:00.000Z",
      reconciliationKey: "work-room-conformance:fixture",
    },
    projection: { confidence: "high", incompleteBoundary: false, sourceHealth: "ok" },
  };
}

describe("WorkroomCycles", () => {
  it("puts the current boundary before completed Outcome Packets", () => {
    const html = renderToStaticMarkup(<WorkroomCycles room={room()} />);

    expect(html).toContain("Current cycle");
    expect(html).toContain("Review cash position and assign exceptions.");
    expect(html).toContain("Measure of done");
    expect(html).toContain("Completed cycles");
    expect(html).toContain("Last week closed with one follow-up.");
    expect(html.indexOf("Current cycle")).toBeLessThan(html.indexOf("Completed cycles"));
  });

  it("shows healthy-idle guidance for a standing room without a current cycle", () => {
    const value = room();
    value.currentCycle = null;
    const html = renderToStaticMarkup(<WorkroomCycles room={value} />);

    expect(html).toContain("Ready for the next cycle");
    expect(html).toContain("healthy and idle");
  });

  it("does not add cycle chrome to finite rooms", () => {
    const value = room();
    value.mode = "finite";
    expect(renderToStaticMarkup(<WorkroomCycles room={value} />)).toBe("");
  });
});
