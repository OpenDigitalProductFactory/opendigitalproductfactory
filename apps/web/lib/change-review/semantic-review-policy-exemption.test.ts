import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn(), failed: vi.fn(), review: vi.fn(), ci: vi.fn(), create: vi.fn(), environment: vi.fn(), intent: vi.fn(), approval: vi.fn(), envelope: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: m.room }, externalEvidenceRecord: { findMany: m.rows, findUnique: m.ci, findFirst: m.failed }, workroomActivity: { findUnique: m.review }, platformConfig: { findUnique: vi.fn() }, coworkerActionEnvelope: { findUnique: m.envelope } } }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: m.create }));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: m.environment }));
vi.mock("@/lib/installation-journey/operating-intent", () => ({ loadInstallationOperatingIntent: m.intent }));
vi.mock("@/lib/coworker/human-approved-execution", () => ({ humanApprovalForExecution: m.approval }));
import { recordSemanticReviewExemption, resolveWorkroomReviewExemption } from "./semantic-review-policy-exemption";
const head = "a".repeat(40), tree = "b".repeat(40), digest = "c".repeat(64);
const params = { capsuleId: "WC-room", sourceHeadSha: head, baseTreeHash: "d".repeat(40), headTreeHash: tree, diffDigest: digest, reviewBasis: "operator-accepted-client-assessment",
  reason: "Native review cannot execute; independent source review and CI cover this change.", expiresAt: new Date(Date.now() + 600_000).toISOString(), verificationEvidenceId: "ci", clientAssessmentActivityId: "review" };
const context = { userContext: { userId: "operator", platformRole: "HR-000", isSuperuser: false }, agentId: "author", approvedAuthorityEnvelopeId: "approved" };
beforeEach(() => {
  vi.clearAllMocks();
  m.room.mockResolvedValue({ id: "room", capsuleId: "WC-room", headSha: head, repositoryFullName: "owner/repo", headBranch: "fix/topic", executorRef: "author-thread" });
  m.environment.mockResolvedValue({ environmentClass: "development" });
  m.intent.mockResolvedValue({ status: "valid", intent: { primaryPurpose: "evolve-dpf" } });
  m.approval.mockResolvedValue({ envelopeId: "approved", userId: "operator" });
  m.rows.mockResolvedValue([]);
  m.failed.mockResolvedValue(null);
  m.ci.mockResolvedValue({ id: "ci", workCapsuleId: "room", operationType: "local_integration_ci", details: { status: "passed", gateKey: "gate", leaseId: "lease", evidenceValidity: { expiresAt: params.expiresAt }, evidence: { sha: head, headTreeHash: tree, diffDigest: digest, gatePassed: true, commands: ["test"], output: "Executed checks passed", completedAt: new Date().toISOString() } } });
  m.review.mockResolvedValue({ id: "review", workCapsuleId: "room", kind: "evidence-recorded", recordedById: "operator", recordedByAgentId: "reviewer", payload: { kind: "decision-record", result: { capsuleId: "WC-room", sourceHeadSha: head, headTreeHash: tree, diffDigest: digest, decision: "pass", rationale: "Independent review covered the final source and failure paths." } } });
  m.create.mockImplementation(async input => ({ id: "exception", details: input.details }));
  m.envelope.mockImplementation(async () => ({ status: "executed", delegatingUserId: "operator", coworkerAgentId: "author", manifestActionId: "record_semantic_review_exemption", inputFingerprint: m.create.mock.calls[0]?.[0].details.authorityInputFingerprint,
    argsJson: { humanApproval: { userId: "operator", approvedAt: new Date(Date.now() - 60_000).toISOString() } } }));
});
describe("audited DEV review exceptions", () => {
  it("refuses a failure on this head outside the newest twenty receipts", async () => {
    m.rows.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ id: String(index), details: { sourceHeadSha: "e".repeat(40), result: { decision: "inconclusive" } } })));
    m.failed.mockResolvedValue({ id: "older-current-failure" });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("records actual issuer and assessment actors without asserting source authorship or certified independence", async () => {
    const result = await recordSemanticReviewExemption(params, "operator", context);
    expect(result.success).toBe(true);
    expect(m.create.mock.calls[0][0].details).toMatchObject({ nativeReview: "UNRUN", independentReview: "UNVERIFIED", approvedByUserId: "operator", requestingAgentId: "author", assessmentRecordedByAgentId: "reviewer", sourceHeadSha: head, sourceExecutorRef: "author-thread" });
    expect(m.create.mock.calls[0][0].details).not.toHaveProperty("authorAgentId");
  });
  it.each(["production", "unknown"])("refuses %s installation", async environmentClass => {
    m.environment.mockResolvedValue({ environmentClass });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("refuses a delegate without verified human approval", async () => {
    m.approval.mockResolvedValue(null);
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(false);
  });
  it("requires durable verified delegated approval for every canonical waiver", async () => {
    m.approval.mockResolvedValue(null);
    expect((await recordSemanticReviewExemption(params, "operator", { userContext: context.userContext })).success).toBe(false);
  });
  it("refuses a waiver that omits explicit acceptance of unverified client assessment", async () => {
    expect((await recordSemanticReviewExemption({ ...params, reviewBasis: undefined }, "operator", context)).success).toBe(false);
  });
  it("accepts separate admitted reviewer sessions sharing the same coworker identity", async () => {
    const room = await m.room(); const review = await m.review();
    m.room.mockImplementation(async ({ where }) => where.id === "reviewer-room" ? { id: "reviewer-room", executorRef: "reviewer-thread" } : room);
    m.review.mockResolvedValue({ ...review, workCapsuleId: "reviewer-room", recordedByAgentId: "author" });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.create.mock.calls[0][0].details).toMatchObject({ assessmentRecordedByAgentId: "author", assessmentWorkroomExecutorRef: "reviewer-thread", sourceExecutorRef: "author-thread", independentReview: "UNVERIFIED" });
  });
  it("does not certify independence when the same executor writes in a second room", async () => {
    const room = await m.room(); const review = await m.review();
    m.room.mockImplementation(async ({ where }) => where.id === "reviewer-room" ? { id: "reviewer-room", executorRef: "author-thread" } : room);
    m.review.mockResolvedValue({ ...review, workCapsuleId: "reviewer-room", recordedByAgentId: "author" });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.create.mock.calls[0][0].details.independentReview).toBe("UNVERIFIED");
  });
  it("retains failed CI as failed and refuses to call it passing evidence", async () => {
    const row = await m.ci(); m.ci.mockResolvedValue({ ...row, details: { ...row.details, status: "failed" } });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(false);
  });
  it("accepts canonical executed source checks without relabeling the full gate as passed", async () => {
    const review = await m.review();
    m.ci.mockResolvedValue(null);
    m.review.mockImplementation(async ({ where }) => where.id === "review" ? review : {
      id: "ci", workCapsuleId: "room", kind: "evidence-recorded", recordedById: "operator", recordedByAgentId: "author",
      payload: { kind: "test", result: { status: "passed", tier: "source-local-checks", sourceHeadSha: head, headTreeHash: tree, diffDigest: digest,
        commands: ["vitest affected tests", "tsc --noEmit"], output: "Executed affected tests and types passed", completedAt: new Date().toISOString(), expiresAt: params.expiresAt, fullGateStatus: "UNRUN" } },
    });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.create.mock.calls[0][0].details.verificationStatus).toBe("client-reported-source-checks-passed/full-gate-UNRUN");
  });
  it("revalidates issued records and rejects changed verification", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "exception", details: m.create.mock.calls[0][0].details }]);
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toMatchObject({ evidenceId: "exception" });
    m.ci.mockResolvedValue(null);
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it("rejects a revoked approval on consumption", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "exception", details: m.create.mock.calls[0][0].details }]);
    m.envelope.mockResolvedValue({ status: "cancelled" });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it("rejects a copied approval fingerprint when the approved expiry was changed", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "forged", details: { ...m.create.mock.calls[0][0].details, expiresAt: new Date(Date.now() + 120_000).toISOString() } }]);
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it.each([{ sourceHeadSha: "e".repeat(40) }, { expiresAt: new Date(Date.now() - 60_000).toISOString() }, { diffDigest: "bad" }])("refuses invalid source or expiry", async patch => {
    expect((await recordSemanticReviewExemption({ ...params, ...patch }, "operator", context)).success).toBe(false);
  });
});
