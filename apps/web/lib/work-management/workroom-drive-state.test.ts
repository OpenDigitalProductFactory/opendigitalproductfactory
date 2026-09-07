import { describe, expect, it } from "vitest";

import { readStoredWorkroomDriveState } from "./workroom-drive-state";

describe("readStoredWorkroomDriveState", () => {
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
    });
  });
});
