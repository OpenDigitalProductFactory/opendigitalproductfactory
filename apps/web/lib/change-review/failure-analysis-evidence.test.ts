import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
const mocks = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, externalEvidenceRecord: { findMany: mocks.rows } } }));
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
  it("rejects an arbitrary externally recorded assurance", async () => {
    row.operationType = "manual-check";
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toEqual([]);
  });
  it("allows the existing lightweight documentation lane without a runtime lease", async () => {
    delete row.details.gateKey; delete row.details.leaseId;
    (row.details.evidence as Record<string, unknown>).phase = "pre-admission-documentation";
    expect(await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row")).toHaveLength(1);
  });
});
