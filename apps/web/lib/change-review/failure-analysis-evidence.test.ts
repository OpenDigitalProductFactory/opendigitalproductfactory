import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
const mocks = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn(), tree: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, externalEvidenceRecord: { findMany: mocks.rows } } }));
vi.mock("./review-artifact-source", () => ({ readCommitTree: mocks.tree }));
import { resolveFailureAnalysisEvidence } from "./failure-analysis-evidence";
const identity = { capsuleId: "room", headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const fixture = failureAnalysisFixture(identity);
let row: { id: string; operationType: string; details: Record<string, unknown> };
beforeEach(() => {
  mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "commit" });
  row = { id: "executed-test", operationType: "local_integration_ci", details: {
    status: "passed", gateKey: "gate", leaseId: "lease",
    evidenceValidity: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    evidence: { ...identity, sha: "commit", gatePassed: true, commands: ["vitest regression"], output: "Stale evidence was rejected", completedAt: new Date().toISOString() },
  } };
  mocks.rows.mockImplementation(async () => [row]);
  mocks.tree.mockReset().mockResolvedValue(null);
});
describe("existing executed evidence adapter", () => {
  it("resolves the existing report in the same Workroom", async () => {
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
    expect(mocks.rows).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["executed-test"] }, workCapsuleId: "room-row" } }));
  });
  it.each(["failed", "skipped", "blocked_control_plane_starvation"])("rejects %s reports", async status => {
    row.details.status = status;
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  it("rejects expired evidence", async () => {
    row.details.evidenceValidity = { expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  it("rejects a prior commit's report", async () => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "new-commit" });
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  // BI-7430A9CC: local-CI reuses a PASS by tree, so a head rebuilt with the same
  // tree (a clean rebase, a DCO re-sign) carries a record minted for the old
  // commit. The bytes are what was verified; the commit id is only a name.
  it("resolves a reused report when the Workroom head was rebuilt with the same tree", async () => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "rebuilt-commit" });
    mocks.tree.mockResolvedValue(identity.headTreeHash);
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
    expect(mocks.tree).toHaveBeenCalledWith("rebuilt-commit");
  });
  it("rejects a prior commit's report when the head's tree differs", async () => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "new-commit" });
    mocks.tree.mockResolvedValue("c".repeat(40));
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  it("rejects a prior commit's report when the head's tree cannot be read", async () => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "new-commit" });
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
    expect(mocks.tree).toHaveBeenCalledOnce();
  });
  it("does not read the head's tree for a report bound to the head", async () => {
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
    expect(mocks.tree).not.toHaveBeenCalled();
  });
  it("rejects an arbitrary externally recorded assurance", async () => {
    row.operationType = "manual-check";
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  // BI-E4E9BD73: a Build Studio sandbox cannot run the full gate (no Docker, by
  // design), so its executed in-platform guard and scoped-test runs are the
  // evidence it has. They count only for a Build Studio Workroom, only when
  // passed, current, bound to this head, and carrying commands and output.
  it.each(["in-platform-preflight", "in-platform-scoped-tests"])("resolves an executed %s record for a Build Studio Workroom", async tier => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "commit", executorKind: "build-studio" });
    delete row.details.gateKey; delete row.details.leaseId; delete row.details.evidenceValidity;
    Object.assign(row.details.evidence as Record<string, unknown>, {
      tier, evidenceValidity: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
  });
  it("refuses in-platform evidence for a Workroom that is not Build Studio's", async () => {
    mocks.room.mockResolvedValue({ capsuleId: "room", headSha: "commit", executorKind: "codex-desktop" });
    delete row.details.gateKey; delete row.details.leaseId;
    (row.details.evidence as Record<string, unknown>).tier = "in-platform-preflight";
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  it("allows the existing lightweight documentation lane without a runtime lease", async () => {
    delete row.details.gateKey; delete row.details.leaseId;
    (row.details.evidence as Record<string, unknown>).phase = "pre-admission-documentation";
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
  });
});
