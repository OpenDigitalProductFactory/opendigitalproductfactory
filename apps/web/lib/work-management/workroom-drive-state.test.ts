import { describe, expect, it } from "vitest";

import { readStoredWorkroomDriveState, projectStoredWorkroomDriveObservation } from "./workroom-drive-state";

// GPP Phase 3c PR-3c-2: a graph room's marking reaches the room view as currentStageKeys.
describe("projectStoredWorkroomDriveObservation: several current stages", () => {
  const marking = {
    format: "drive-marking/1", cycleKey: "c",
    tokens: [
      { node: "node:j", from: "stage:b", enteredAt: "2026-03-02T09:00:00.000Z" },
      { node: "stage:c", enteredAt: "2026-03-02T09:00:00.000Z", taskId: "t-c" },
      { node: "stage:d", enteredAt: "2026-03-02T09:00:00.000Z" },
    ],
    iterations: { c: 1, bad: -1 }, reworkTaken: {}, deadlines: {}, children: {},
  };

  it("lists every marked stage (never a join arrival) with its iteration", () => {
    expect(projectStoredWorkroomDriveObservation({ workroomDrive: { stageKey: "c", marking } }))
      .toMatchObject({ currentStageKey: "c", currentStageKeys: ["c", "d"], stageIterations: { c: 1 } });
  });

  it("adds no key for a room with no marking, so a sequential room's observation is unchanged", () => {
    const observed = projectStoredWorkroomDriveObservation({ workroomDrive: { stageKey: "c" } });
    expect(Object.hasOwn(observed, "currentStageKeys")).toBe(false);
    expect(Object.hasOwn(observed, "stageIterations")).toBe(false);
    expect(Object.hasOwn(projectStoredWorkroomDriveObservation({ workroomDrive: { stageKey: "c", marking: { tokens: "x" } } }), "currentStageKeys")).toBe(false);
  });
});

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

// AC-3C-STATE-COMPAT (GPP Phase 3c PR-3c-1, BI-8875C9DF): the reader is
// byte-identical for every pre-3c snapshot, and copies a receipt's iteration
// only when it is a finite non-negative integer.
describe("readStoredWorkroomDriveState: AC-3C-STATE-COMPAT", () => {
  const legacyEmpty = {
    currentStageKey: null, receipts: [], budgetUsage: [], stopConditionHits: [], reviewDue: false,
    lastAction: null, lastReason: null, lastCycleKey: null,
  };

  it("no drive key reads as the empty state", () => {
    expect(readStoredWorkroomDriveState({})).toEqual(legacyEmpty);
    expect(readStoredWorkroomDriveState(null)).toEqual(legacyEmpty);
  });

  it("a v1 snapshot without iterations reads exactly as before, with no iteration key on any receipt", () => {
    const state = readStoredWorkroomDriveState({ workroomDrive: {
      kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "raise",
      lastCycleKey: "c@1:2026-01-01", receipts: [{ stageKey: "sweep", kind: "stage-evidence-recorded" }, { stageKey: "raise", kind: "blocked" }],
      budgetUsage: [{ kind: "spend", used: 2 }], stopConditionHits: [], reviewDue: false,
    } });
    expect(state).toEqual({
      currentStageKey: "raise",
      receipts: [{ stageKey: "sweep", kind: "stage-evidence-recorded" }, { stageKey: "raise", kind: "blocked" }],
      budgetUsage: [{ kind: "spend", used: 2 }],
      stopConditionHits: [], reviewDue: false,
      lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: "c@1:2026-01-01",
    });
    expect(JSON.stringify(state.receipts)).toBe('[{"stageKey":"sweep","kind":"stage-evidence-recorded"},{"stageKey":"raise","kind":"blocked"}]');
  });

  it("copies a valid iteration, and drops a malformed one so the receipt reads as iteration 0", () => {
    const state = readStoredWorkroomDriveState({ workroomDrive: { receipts: [
      { stageKey: "a", kind: "k", iteration: 2 },
      { stageKey: "a", kind: "k", iteration: 0 },
      { stageKey: "b", kind: "k", iteration: -1 },
      { stageKey: "c", kind: "k", iteration: 1.5 },
      { stageKey: "d", kind: "k", iteration: "1" },
      { stageKey: "e", kind: "k", iteration: Number.POSITIVE_INFINITY },
    ] } });
    expect(state.receipts).toEqual([
      { stageKey: "a", kind: "k", iteration: 2 },
      { stageKey: "a", kind: "k", iteration: 0 },
      { stageKey: "b", kind: "k" },
      { stageKey: "c", kind: "k" },
      { stageKey: "d", kind: "k" },
      { stageKey: "e", kind: "k" },
    ]);
  });

  it("does not surface a marking: the marking is read through readStoredDriveMarking only", () => {
    const state = readStoredWorkroomDriveState({ workroomDrive: { stageKey: "a", marking: { format: "drive-marking/1" } } });
    expect(Object.hasOwn(state, "marking")).toBe(false);
  });
});
