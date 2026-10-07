import { describe, expect, it } from "vitest";

import { describeStageEvidenceReach } from "./stage-evidence-reach";

const drive = (overrides: Record<string, unknown> = {}) => ({
  workroomDrive: {
    stageKey: "reproduce",
    pendingAttention: { reason: "role_stage", stageKey: "reproduce", principalRef: "role:author" },
    ...overrides,
  },
});

// BI-C9912C22 AC-3: stage evidence either advances the stage or the call says
// why it will not. The drive owns the advance, so the call reports what the
// drive's next tick will do with the evidence, never that the stage advanced.
describe("describeStageEvidenceReach", () => {
  it("says nothing about room-level notes", () => {
    expect(describeStageEvidenceReach(drive(), { stageKey: null, outcome: null })).toBeNull();
  });

  it("an author's completed evidence for the current author stage is read on the next drive tick", () => {
    expect(describeStageEvidenceReach(drive(), { stageKey: "reproduce", outcome: "completed" }))
      .toMatchObject({ willAdvance: true, message: expect.stringContaining("next drive tick") });
  });

  it("a blocker never advances", () => {
    expect(describeStageEvidenceReach(drive(), { stageKey: "reproduce", outcome: "blocked" }))
      .toMatchObject({ willAdvance: false, reason: "blocked_outcome" });
  });

  it("evidence for a stage that is not current is named as such", () => {
    expect(describeStageEvidenceReach(drive(), { stageKey: "repair", outcome: "completed" }))
      .toMatchObject({ willAdvance: false, reason: "not_current_stage", message: expect.stringContaining("reproduce") });
  });

  it("a stage accountable to another role says who must record it", () => {
    const state = drive({ stageKey: "approve", pendingAttention: { reason: "role_stage", stageKey: "approve", principalRef: "role:change-approver" } });
    expect(describeStageEvidenceReach(state, { stageKey: "approve", outcome: "completed" }))
      .toMatchObject({ willAdvance: false, reason: "accountable_elsewhere", message: expect.stringContaining("role:change-approver") });
  });

  it("a stage accountable to a person says who must record it", () => {
    const state = drive({ stageKey: "sign", pendingAttention: { reason: "person_stage", stageKey: "sign", principalRef: "person:PRN-1" } });
    expect(describeStageEvidenceReach(state, { stageKey: "sign", outcome: "completed" }))
      .toMatchObject({ willAdvance: false, reason: "accountable_elsewhere" });
  });

  it("a room the drive has not reached yet says so", () => {
    expect(describeStageEvidenceReach({}, { stageKey: "reproduce", outcome: "completed" }))
      .toMatchObject({ willAdvance: false, reason: "no_driven_stage" });
  });
});
