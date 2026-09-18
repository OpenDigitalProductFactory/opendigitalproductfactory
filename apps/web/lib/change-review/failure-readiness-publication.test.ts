import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
import { validateFailureAnalysis } from "./failure-analysis";
import { CHANGE_REVIEW_POLICY_VERSION, CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION } from "./semantic-change-review";
const mocks = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn(), evidence: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, externalEvidenceRecord: { findMany: mocks.rows } } }));
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: mocks.evidence }));
import { checkWorkroomFailureReadiness } from "./failure-readiness-publication";
const identity = { capsuleId: "room", headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const fixture = failureAnalysisFixture(identity);
const receipt = {
  schemaVersion: CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION, policyVersion: CHANGE_REVIEW_POLICY_VERSION,
  ...identity, sourceHeadSha: "c".repeat(40), disposition: "reviewed",
  failureAnalysis: fixture.failureAnalysis,
  failureAnalysisDigest: validateFailureAnalysis(fixture.failureAnalysis, identity, fixture.resolvedFailureEvidence).digest,
  result: { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Test evidence covers stale identities and recovery." } },
};
beforeEach(() => {
  mocks.room.mockResolvedValue({ id: "room-row", headSha: receipt.sourceHeadSha, repositoryFullName: "owner/repo" });
  mocks.rows.mockResolvedValue([{ id: "review", details: receipt }]);
  mocks.evidence.mockResolvedValue(fixture.resolvedFailureEvidence);
});
describe("server publication boundary", () => {
  it("permits the independently reviewed final change", async () => {
    expect(await checkWorkroomFailureReadiness("room")).toMatchObject({ mayPublish: true, evidenceId: "review" });
  });
  it("rejects a missing workroom or final source identity", async () => {
    mocks.room.mockResolvedValue(null);
    expect((await checkWorkroomFailureReadiness("room")).mayPublish).toBe(false);
  });
  it("names the missing identity fields and the repair tool so the executor can fix it (BI-023EF164)", async () => {
    mocks.room.mockResolvedValue({ id: "room-row", headSha: null, repositoryFullName: "owner/repo" });
    const result = await checkWorkroomFailureReadiness("room");
    expect(result).toMatchObject({ mayPublish: false, code: "workroom_identity_incomplete" });
    expect(result.reason).toContain("headSha not set");
    expect(result.reason).not.toContain("repositoryFullName not set");
    expect(result.reason).toContain("adopt_worktree");
  });
  it("classifies a missing review as failure_review_required, distinct from identity", async () => {
    mocks.rows.mockResolvedValue([]);
    expect(await checkWorkroomFailureReadiness("room")).toMatchObject({ mayPublish: false, code: "failure_review_required" });
  });
  it.each([null, { ...receipt, sourceHeadSha: "d".repeat(40) }, { ...receipt, policyVersion: "legacy" },
    { ...receipt, disposition: "auto-pass" }, { ...receipt, result: { decision: "inconclusive" } },
    { ...receipt, result: { decision: "pass" } },
    { ...receipt, result: { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "looks good" } } }])("rejects missing, stale or incomplete review", async details => {
    mocks.rows.mockResolvedValue([{ id: "review", details }]);
    expect((await checkWorkroomFailureReadiness("room")).mayPublish).toBe(false);
  });
  it("re-resolves evidence instead of trusting a persisted pass", async () => {
    mocks.evidence.mockResolvedValue([]);
    expect((await checkWorkroomFailureReadiness("room")).mayPublish).toBe(false);
  });
  it("invalidates a pass when the observed evidence changes", async () => {
    mocks.evidence.mockResolvedValue([{ ...fixture.resolvedFailureEvidence[0], observed: "Different execution result" }]);
    expect((await checkWorkroomFailureReadiness("room")).mayPublish).toBe(false);
  });
  it("does not fall back to an older pass after a failed current review", async () => {
    mocks.rows.mockResolvedValue([{ id: "new", details: { ...receipt, result: { decision: "fail" } } }, { id: "old", details: receipt }]);
    expect((await checkWorkroomFailureReadiness("room")).mayPublish).toBe(false);
  });
});
