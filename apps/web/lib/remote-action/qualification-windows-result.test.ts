import { describe, expect, it, vi } from "vitest";

import { qualificationOutcome, settleQualificationWindowsResult } from "./qualification-windows-result";

describe("qualification Windows result settlement", () => {
  it("classifies the controlled first refusal without turning it into research PASS", () => {
    expect(qualificationOutcome("succeeded", { observations: {
      firstReplacement: "refused:*PathError", secondReplacement: "replaced", cleanup: "removed",
    } })).toBe("positive");
  });

  it("persists one auditable Workroom evidence row and settles the same admission", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const state = { schemaVersion: 1, status: "started", token: "token", bindingDigest: digest,
      startCount: 1, issuedAt: "2026-10-30T01:00:00.000Z", startedAt: "2026-10-30T01:01:00.000Z", taskId: "ra_qw_1" };
    const update = vi.fn();
    const db = { remoteAction: { findUnique: vi.fn(async () => ({ actionKey: "ra_qw_1", edgeNodeId: "node-1",
      actionType: "qualification.windows.verify-v1", status: "succeeded", parameters: { workroomId: "WC-1",
        qualificationBindingDigest: digest, headSha: "b".repeat(40), testBlobs: [{ blobSha: "c".repeat(40) }] },
      evidence: { boundedOutputDigest: "d".repeat(64), startedAt: "2026-10-30T01:02:00Z", finishedAt: "2026-10-30T01:03:00Z",
        observations: { firstReplacement: "refused:*PathError", secondReplacement: "replaced", cleanup: "removed" } } })) },
      workroom: { findUnique: vi.fn(async () => ({ id: "room-row", workspaceState: { qualificationExperimentAdmission: state } })), update },
      workroomActivity: { create: vi.fn(async () => ({ id: "evidence-1" })) } };
    expect(await settleQualificationWindowsResult({ db, actionKey: "ra_qw_1", edgeNodeRowId: "node-1", outcome: "succeeded" })).toBe(true);
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: "evidence-recorded", payload: expect.objectContaining({ result: expect.objectContaining({
        qualificationOutcome: "positive", researchSatisfied: false,
      }) }),
    }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { workspaceState: expect.objectContaining({
      qualificationExperimentAdmission: expect.objectContaining({ status: "settled", evidenceId: "evidence-1" }),
    }) } }));
  });
});
