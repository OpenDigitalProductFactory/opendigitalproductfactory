import { describe, expect, it } from "vitest";

import {
  WORK_CASE_STAGED_TRANSITION_STATUSES,
  projectWorkCaseStagedTransition,
} from "./staged-transition";

describe("Work Case staged transition projection", () => {
  it("defines staged-before-commit statuses from the spec", () => {
    expect(WORK_CASE_STAGED_TRANSITION_STATUSES).toEqual([
      "proposed",
      "awaiting-approval",
      "edited",
      "approved",
      "rejected",
      "responded",
      "cancelled",
    ]);
  });

  it("projects open proposals as awaiting decision and not committable", () => {
    expect(
      projectWorkCaseStagedTransition({
        transitionId: "WCT-1",
        action: "handoff",
        status: "proposed",
        decisionInteractionId: "DI-1",
      }),
    ).toEqual({
      transitionId: "WCT-1",
      action: "handoff",
      status: "proposed",
      caseState: "awaiting-decision",
      a2aStatus: "input-required",
      terminal: false,
      committable: false,
      sourceRef: {
        kind: "decision-interaction",
        id: "DI-1",
        status: "proposed",
      },
      reason: "Transition handoff is proposed and waiting for approve/edit/reject/respond.",
      nextAction: "Resolve staged transition",
    });
  });

  it("marks approved staged transitions as committable", () => {
    expect(
      projectWorkCaseStagedTransition({
        transitionId: "WCT-2",
        action: "complete",
        status: "approved",
        decisionInteractionId: "DI-2",
      }),
    ).toMatchObject({
      caseState: "active",
      a2aStatus: "working",
      terminal: true,
      committable: true,
      nextAction: "Commit approved transition",
    });
  });

  it("keeps rejected/responded/cancelled proposals terminal but not committable", () => {
    for (const status of ["rejected", "responded", "cancelled"] as const) {
      expect(
        projectWorkCaseStagedTransition({
          transitionId: `WCT-${status}`,
          action: "delegate",
          status,
        }),
      ).toMatchObject({
        terminal: true,
        committable: false,
        sourceRef: {
          kind: "source",
          id: `WCT-${status}`,
          status,
          sourceType: "work-case-staged-transition",
        },
      });
    }
  });
});
