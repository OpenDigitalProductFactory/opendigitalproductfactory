import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
const mocks = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn(), tree: vi.fn(), activity: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  workroom: { findUnique: mocks.room }, externalEvidenceRecord: { findMany: mocks.rows },
  workroomActivity: { findMany: mocks.activity },
} }));
vi.mock("./review-artifact-source", () => ({ readCommitTree: mocks.tree }));
import { RISK_ACCEPTANCE_ACTIVITY_KIND, resolveFailureAnalysisEvidence } from "./failure-analysis-evidence";
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

// BI-09FB398D: an accepted risk's authority is the platform-written Workroom
// record the escalation gate produced, read from this room's own log.
describe("risk-acceptance authority adapter", () => {
  const accepted = () => {
    const fa = structuredClone(fixture.failureAnalysis) as { scenarios: Array<{ key: string; residualRisk: Record<string, unknown> }> };
    fa.scenarios[0]!.residualRisk = { owner: "platform", disposition: "accepted", rationale: "Outside this change; owned by PIR-OWNER",
      authorityEvidenceId: "act-1", followUpReference: "PIR-OWNER" };
    return fa;
  };
  beforeEach(() => {
    mocks.activity.mockReset().mockResolvedValue([{ id: "act-1", recordedAt: new Date("2026-11-14T10:00:00Z"), payload: {
      scenarioKey: "stale-review", headTreeHash: identity.headTreeHash, diffDigest: identity.diffDigest,
      followUpReference: "PIR-OWNER", consult: "WWMD route-to-agent (high)", decision: "accepted under DI-1",
    } }]);
  });
  it("resolves only the platform-written kind, in this Workroom", async () => {
    const out = await resolveFailureAnalysisEvidence(accepted(), "room-row");
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["act-1"] }, workCapsuleId: "room-row", kind: RISK_ACCEPTANCE_ACTIVITY_KIND },
    }));
    expect(out).toContainEqual(expect.objectContaining({
      id: "act-1", kind: "risk-acceptance", capsuleId: "room", status: "accepted",
      scenarioKey: "stale-review", followUpReference: "PIR-OWNER", headTreeHash: identity.headTreeHash,
    }));
  });
  it("drops a record that names no owning item", async () => {
    mocks.activity.mockResolvedValue([{ id: "act-1", recordedAt: new Date(), payload: { scenarioKey: "stale-review", headTreeHash: identity.headTreeHash, diffDigest: identity.diffDigest } }]);
    expect((await resolveFailureAnalysisEvidence(accepted(), "room-row")).some((e) => e.id === "act-1")).toBe(false);
  });
  it("never reads the log when no scenario cites an authority", async () => {
    await resolveFailureAnalysisEvidence(fixture.failureAnalysis, "room-row");
    expect(mocks.activity).not.toHaveBeenCalled();
  });
});
