import { describe, expect, it } from "vitest";

import { readStoredWorkroomDriveState, projectStoredWorkroomDriveObservation } from "./workroom-drive-state";

describe("readStoredWorkroomDriveState", () => {
  it("retains a recorded role wait in the shared process observation", () => {
    expect(projectStoredWorkroomDriveObservation({ workroomDrive: {
      action: "attention", stageKey: "design-note",
      pendingAttention: { reason: "role_stage", stageKey: "design-note", principalRef: "role:author" },
    } })).toMatchObject({ currentStageKey: "design-note", proposedStageKey: "design-note",
      attentionReason: "Stage design-note is waiting on role:author." });
  });
  it.each([
    { action: "noop", stageKey: "design-note", pendingAttention: { stageKey: "design-note", principalRef: "role:author" } },
    { action: "attention", stageKey: "implement", pendingAttention: { stageKey: "design-note", principalRef: "role:author" } },
    { action: "attention", stageKey: "design-note", pendingAttention: { stageKey: "design-note", principalRef: 123 } },
  ])("does not turn stale or malformed attention into an active wait", (workroomDrive) => {
    expect(projectStoredWorkroomDriveObservation({ workroomDrive }).attentionReason).toBeNull();
  });
  it("projects only typed verifier observations from the runner snapshot", () => {
    expect(readStoredWorkroomDriveState({
      workroomDrive: {
        stageKey: "raise",
        receipts: [{ stageKey: "sweep", kind: "assurance-run" }, { stageKey: 2, kind: "bad" }],
        budgetUsage: [{ kind: "findings-per-run", used: 4 }, { kind: "bad", used: "4" }],
        stopConditionHits: ["substrate-failed", 2],
        reviewDue: true,
      },
    })).toEqual({
      currentStageKey: "raise",
      receipts: [{ stageKey: "sweep", kind: "assurance-run" }],
      budgetUsage: [{ kind: "findings-per-run", used: 4 }],
      stopConditionHits: ["substrate-failed"],
      reviewDue: true,
      lastAction: null,
      lastReason: null,
      lastCycleKey: null,
    });
  });

  it("fails closed to an empty observation for malformed state", () => {
    expect(readStoredWorkroomDriveState({ workroomDrive: "bad" })).toEqual({
      currentStageKey: null,
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      lastAction: null,
      lastReason: null,
      lastCycleKey: null,
    });
  });

  it("projects the last drive action so the next tick can fail closed", () => {
    expect(readStoredWorkroomDriveState({
      workroomDrive: {
        action: "dispatch_agent",
        reason: "agent_stage",
        stageKey: "scan",
        receipts: [],
      },
    })).toMatchObject({
      currentStageKey: "scan",
      lastAction: "dispatch_agent",
      lastReason: "agent_stage",
      lastCycleKey: null,
    });
  });
});
