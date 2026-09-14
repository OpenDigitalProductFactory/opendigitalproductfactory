import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleTerminalGateLease } from "./environment-lease-terminal-evidence";

const now = new Date("2026-09-14T20:00:00Z");
const gateKey = "a".repeat(64);
const sha = "b".repeat(40);
const lease = { id: "lease-row", leaseId: "NPEL-TEST", ownerSessionId: "task-1",
  evidenceRecordId: "evidence-1", claimKey: `gate:${gateKey}` };
const evidence = { id: "evidence-1", operationType: "local_integration_ci",
  target: "fix/reviewer", workCapsuleId: null as string | null,
  details: { gateKey, leaseId: "NPEL-TEST", externalSessionId: "task-1", status: "passed",
    evidenceValidity: { issuedAt: now.toISOString(), expiresAt: "2026-09-15T20:00:00Z" },
    evidence: { branch: "fix/reviewer", sha, headTreeHash: "c".repeat(40), gatePassed: true } } };
const tx = { externalEvidenceRecord: { findUnique: vi.fn(), updateMany: vi.fn() },
  workroom: { findMany: vi.fn() }, nonProductionEnvironmentLease: { update: vi.fn() } };
const settle = () => settleTerminalGateLease({ tx: tx as never, lease: lease as never,
  claimKey: lease.claimKey, now, ttlMs: 60_000 });

describe("canonical CI reuse Workroom reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence });
    tx.externalEvidenceRecord.updateMany.mockResolvedValue({ count: 1 });
    tx.workroom.findMany.mockResolvedValue([{ id: "room-1" }]);
  });

  it("attaches only a null link to the unique canonical branch/SHA/session room", async () => {
    expect(await settle()).toMatchObject({ kind: "settled", projection: { status: "reused", evidenceRecordId: "evidence-1" } });
    expect(tx.workroom.findMany).toHaveBeenCalledWith({ where: {
      headBranch: "fix/reviewer", headSha: sha, executorRef: "task-1", archivedAt: null,
    }, select: { id: true }, take: 2 });
    expect(tx.externalEvidenceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "evidence-1", workCapsuleId: null }, data: { workCapsuleId: "room-1" },
    });
    expect(tx.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("does not rewrite an existing matching link", async () => {
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence, workCapsuleId: "room-1" });
    await settle();
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("refuses ambiguous room ownership", async () => {
    tx.workroom.findMany.mockResolvedValue([{ id: "room-1" }, { id: "room-2" }]);
    await expect(settle()).rejects.toThrow("local-ci-evidence-workroom-ambiguous");
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an existing foreign link", async () => {
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence, workCapsuleId: "other-room" });
    await expect(settle()).rejects.toThrow("local-ci-evidence-workroom-conflict");
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a concurrent link change rather than claiming reconciliation", async () => {
    tx.externalEvidenceRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(settle()).rejects.toThrow("local-ci-evidence-workroom-conflict");
  });

  it("leaves evidence unlinked when no exact live room exists", async () => {
    tx.workroom.findMany.mockResolvedValue([]);
    await settle();
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("does not infer missing legacy identity from the claimant", async () => {
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence,
      details: { ...evidence.details, evidence: {} } });
    await settle();
    expect(tx.workroom.findMany).not.toHaveBeenCalled();
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { externalSessionId: "another-task" }, { leaseId: "NPEL-OTHER" },
  ])("refuses evidence with mismatched canonical lease identity %j", async (overrides) => {
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence,
      details: { ...evidence.details, ...overrides } });
    await expect(settle()).rejects.toThrow("local-ci-evidence-owner-mismatch");
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("does not reconcile expired evidence into an apparent fresh verdict", async () => {
    tx.externalEvidenceRecord.findUnique.mockResolvedValue({ ...evidence,
      details: { ...evidence.details, evidenceValidity: { expiresAt: "2026-09-13T20:00:00Z" } } });
    expect(await settle()).toMatchObject({ kind: "settled", projection: { status: "blocked" } });
    expect(tx.externalEvidenceRecord.updateMany).not.toHaveBeenCalled();
  });
});
