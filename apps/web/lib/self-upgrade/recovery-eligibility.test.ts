import { describe, expect, it } from "vitest";
import { getSelfUpgradeRecoveryState, isEligibleRecoveryPredecessor } from "./recovery-eligibility";

const point = {
  schemaVersion: 1, trigger: "pre-upgrade-recovery", status: "ok",
  selfUpgradeRunId: "SUR-RECOVERY", createdAt: "2026-10-22T00:00:00.000Z",
  members: [{ target: "postgres", runId: "BR-PG", status: "ok" }],
};
const run = { status: "succeeded", completionEvidence: { recoveryPoint: point } };
const paired = {
  ...point,
  schemaVersion: 2,
  members: [...point.members, { target: "uploads", runId: "BR-UP", status: "ok" }],
  pairedReceipt: {
    schemaVersion: 2,
    postgres: { runId: "BR-PG", storagePath: "postgres/saved", sha256: "a".repeat(64) },
    uploads: {
      runId: "BR-UP", storagePath: "uploads/saved", sha256: "b".repeat(64), manifestSha256: "c".repeat(64),
      pairedPostgresRunId: "BR-PG", pairedPostgresSha256: "a".repeat(64),
    },
  },
};

describe("self-upgrade recovery availability", () => {
  it("recognizes the saved backup without authorizing restoration", () => {
    expect(getSelfUpgradeRecoveryState(run)).toMatchObject({
      point, backupRunIds: { postgres: "BR-PG" }, available: false,
      membership: "legacy-postgres",
      reason: "reassessment-rollback-retention-unproven",
      detail: "Database restoration is unavailable until review history can be preserved safely.",
    });
  });

  it("identifies the complete paired point without removing the review retention interlock", () => {
    expect(getSelfUpgradeRecoveryState({ ...run, completionEvidence: { recoveryPoint: paired } })).toMatchObject({
      point: paired, membership: "paired", backupRunIds: { postgres: "BR-PG", uploads: "BR-UP" },
      available: false, reason: "reassessment-rollback-retention-unproven",
    });
  });

  it.each([
    { ...paired, pairedReceipt: null },
    { ...paired, members: point.members },
    { ...paired, members: [...paired.members, paired.members[1]] },
    { ...paired, pairedReceipt: { ...paired.pairedReceipt, uploads: { ...paired.pairedReceipt.uploads, runId: "BR-OTHER" } } },
    { ...paired, schemaVersion: 1 },
  ])("does not downgrade incomplete or ambiguous paired evidence to legacy", (candidate) => {
    expect(getSelfUpgradeRecoveryState({ ...run, completionEvidence: { recoveryPoint: candidate } })).toMatchObject({
      membership: "incomplete", backupRunIds: null, available: false, reason: "recovery-point-incomplete",
    });
  });

  it.each([null, {}, { recoveryPoint: null }, { recoveryPoint: [] },
    { recoveryPoint: { ...point, schemaVersion: 2 } },
    { recoveryPoint: { ...point, status: ["ok"] } },
    { recoveryPoint: { ...point, members: [null] } },
    { recoveryPoint: { ...point, members: [{ target: "postgres", status: ["ok"], runId: "BR-PG" }] } },
    { recoveryPoint: { ...point, members: [{ target: "postgres", status: "ok", runId: 42 }] } },
  ])("fails closed on missing or malformed evidence: %j", completionEvidence => {
    const state = getSelfUpgradeRecoveryState({ status: "succeeded", completionEvidence });
    expect(state.available).toBe(false);
    expect(state.point).toBeNull();
    expect(state.backupRunIds).toBeNull();
  });

  it.each(["failed", "skipped", "degraded"])("preserves a %s backup record without permitting restore", status => {
    const state = getSelfUpgradeRecoveryState({ ...run, completionEvidence: {
      recoveryPoint: { ...point, status },
    } });
    expect(state.point?.status).toBe(status);
    expect(state).toMatchObject({ available: false, reason: "recovery-point-incomplete", backupRunIds: null });
  });

  it("requires the successful postgres member, not derived-store backups", () => {
    const state = getSelfUpgradeRecoveryState({ ...run, completionEvidence: {
      recoveryPoint: { ...point, members: [{ target: "redis", runId: "BR-CACHE", status: "ok" }] },
    } });
    expect(state).toMatchObject({ available: false, reason: "recovery-point-incomplete" });
    expect(state.detail).toContain("missing successful backup members: postgres");
  });

  it.each(["queued", "pending", "running", "completing"])("holds restore during a %s upgrade", status => {
    expect(getSelfUpgradeRecoveryState({ ...run, status })).toMatchObject({
      point, available: false, reason: "upgrade-running",
    });
  });

  it("keeps historical rollback evidence without offering it again", () => {
    expect(getSelfUpgradeRecoveryState({ ...run, completionEvidence: {
      recoveryPoint: point, rollback: { status: "ok" },
    } })).toMatchObject({ point, rollbackStatus: "ok", available: false, reason: "already-restored" });
  });

  it("ignores forged retention, permission and availability fields without mutating evidence", () => {
    const completionEvidence = { recoveryPoint: point, available: true, canRestore: true,
      reassessmentRetention: { allocationsRetained: true, capabilitiesRetired: true, activeTaskIds: [] } };
    const original = JSON.stringify(completionEvidence);
    expect(getSelfUpgradeRecoveryState({ ...run, completionEvidence })).toMatchObject({
      available: false, reason: "reassessment-rollback-retention-unproven",
    });
    expect(JSON.stringify(completionEvidence)).toBe(original);
  });

  it("keeps never-dispatched predecessor eligibility separate from database restoration", () => {
    const predecessor = { status: "failed", completedAt: new Date(), admissionFingerprint: "admission",
      dispatchStatus: "dispatch_failed", targetSha: "sha", targetTag: "tag", dispatchAttemptCount: 0,
      dispatchAcknowledgedAt: null, dispatchEventIds: [] };
    expect(isEligibleRecoveryPredecessor(predecessor)).toBe(true);
    expect(isEligibleRecoveryPredecessor({ ...predecessor, dispatchAttemptCount: 1 })).toBe(false);
    expect(getSelfUpgradeRecoveryState({ ...predecessor, completionEvidence: run.completionEvidence }).available).toBe(false);
  });
});
