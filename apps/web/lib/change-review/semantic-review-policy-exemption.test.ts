import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ room: vi.fn(), rows: vi.fn(), failed: vi.fn(), review: vi.fn(), ci: vi.fn(), create: vi.fn(), environment: vi.fn(), intent: vi.fn(), approval: vi.fn(), envelope: vi.fn(), user: vi.fn(), lock: vi.fn(), transaction: vi.fn(), access: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { $queryRaw: m.lock, $transaction: m.transaction, workroom: { findUnique: m.room }, externalEvidenceRecord: { findMany: m.rows, findUnique: m.ci, findFirst: m.failed }, workroomActivity: { findUnique: m.review }, platformConfig: { findUnique: vi.fn() }, coworkerActionEnvelope: { findUnique: m.envelope }, user: { findUnique: m.user } } }));
vi.mock("@/lib/observability/external-evidence-store", () => ({ recordExternalEvidenceInStore: m.create }));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution: m.environment }));
vi.mock("@/lib/installation-journey/operating-intent", () => ({ loadInstallationOperatingIntent: m.intent }));
vi.mock("@/lib/coworker/human-approved-execution", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/coworker/human-approved-execution")>(), humanApprovalForExecution: m.approval }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/work-management/workroom-agent-access.server")>(), resolveAgentWorkroomAccess: m.access }));
import { preflightSemanticReviewExemption, recordSemanticReviewExemption, resolveWorkroomReviewExemption } from "./semantic-review-policy-exemption";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { _setGovernanceForTests, governedExecuteTool } from "@/lib/mcp-governed-execute";
import { coworkerAuthorityInputFixture } from "../../test-support/coworker-authority-input-fixture";
const head = "a".repeat(40), tree = "b".repeat(40), digest = "c".repeat(64);
const params = { capsuleId: "WC-room", sourceHeadSha: head, baseTreeHash: "d".repeat(40), headTreeHash: tree, diffDigest: digest, reviewBasis: "operator-accepted-client-assessment",
  reason: "Native review cannot execute; independent source review and CI cover this change.", expiresAt: new Date(Date.now() + 600_000).toISOString(), verificationEvidenceId: "ci", clientAssessmentActivityId: "review" };
const context = { userContext: { userId: "operator", platformRole: "HR-000", isSuperuser: false }, agentId: "author", approvedAuthorityEnvelopeId: "approved" };
beforeEach(() => {
  vi.resetAllMocks();
  m.lock.mockResolvedValue([{ id: "room" }]);
  m.transaction.mockImplementation(async body => body({ $queryRaw: m.lock, workroom: { findUnique: m.room }, externalEvidenceRecord: { create: m.create } }));
  m.room.mockResolvedValue({ id: "room", capsuleId: "WC-room", headSha: head, repositoryFullName: "owner/repo", headBranch: "fix/topic", executorRef: "author-thread" });
  m.access.mockImplementation(async ({ requested }) => ({ decision: { level: requested, reason: "authorized" }, agentPrincipalId: "actual-author" }));
  m.environment.mockResolvedValue({ environmentClass: "development" });
  m.intent.mockResolvedValue({ status: "valid", intent: { primaryPurpose: "evolve-dpf" } });
  m.approval.mockResolvedValue({ envelopeId: "approved", userId: "operator", approverUserId: "operator", onBehalfOf: null });
  m.user.mockResolvedValue({ email: "human@example.test", isActive: true, isSuperuser: false, automationVerificationId: null, automationProfile: null, automationExpiresAt: null, automationSlot: null, groups: [{ platformRole: { roleId: "HR-000" } }] });
  m.rows.mockResolvedValue([]);
  m.failed.mockResolvedValue(null);
  m.ci.mockResolvedValue({ id: "ci", workCapsuleId: "room", operationType: "local_integration_ci", details: { status: "passed", gateKey: "gate", leaseId: "lease", evidenceValidity: { expiresAt: params.expiresAt }, evidence: { sha: head, headTreeHash: tree, diffDigest: digest, gatePassed: true, commands: ["test"], output: "Executed checks passed", completedAt: new Date().toISOString() } } });
  m.review.mockResolvedValue({ id: "review", workCapsuleId: "room", kind: "evidence-recorded", recordedById: "operator", recordedByAgentId: "reviewer", payload: { kind: "decision-record", result: { capsuleId: "WC-room", sourceHeadSha: head, headTreeHash: tree, diffDigest: digest, decision: "pass", rationale: "Independent review covered the final source and failure paths." } } });
  m.create.mockImplementation(async input => ({ id: "exception", details: input.details }));
  m.envelope.mockImplementation(async () => ({ id: "approved", status: "executed", resolvedAt: new Date(Date.now() - 30_000), expiresAt: new Date(Date.now() + 600_000), delegatingUserId: "operator", coworkerAgentId: "author", manifestActionId: "record_semantic_review_exemption", inputFingerprint: fingerprintCoworkerInput(params),
    argsJson: { humanApproval: { userId: "operator", approvedAt: new Date(Date.now() - 60_000).toISOString() } } }));
});
afterEach(() => _setGovernanceForTests({}));
describe("audited DEV review exceptions", () => {
  it("rejects an ineligible installation before consulting human approval", async () => {
    m.environment.mockResolvedValue({ environmentClass: "production" });
    m.intent.mockResolvedValue({ status: "valid", intent: { primaryPurpose: "operate-organization" } });
    expect(await preflightSemanticReviewExemption(params, "operator", context))
      .toMatchObject({ success: false, error: "review_exemption_refused" });
    expect(m.environment).toHaveBeenCalledOnce();
    expect(m.approval).not.toHaveBeenCalled();
    expect(m.room).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("leaves fully eligible exact requests to human authorization without issuing an exception", async () => {
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toBeNull();
    expect(m.access).toHaveBeenCalledWith({ userId: "operator", agentId: "author", workroomId: "room", requested: "content" }, expect.anything());
    expect(m.approval).not.toHaveBeenCalled(); expect(m.lock).not.toHaveBeenCalled();
    expect(m.ci).toHaveBeenCalled(); expect(m.review).toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["expired", "at-expiry", "overlong", "invalid-date", "invalid-source", "missing-basis", "missing-verification", "missing-assessment"])(
    "rejects %s parameters without private reads or a human approval probe", async kind => {
      const now = Date.now();
      const patch = kind === "expired" ? { expiresAt: new Date(now - 1000).toISOString() }
        : kind === "at-expiry" ? { expiresAt: new Date(now).toISOString() }
        : kind === "overlong" ? { expiresAt: new Date(now + 25 * 60 * 60 * 1000).toISOString() }
        : kind === "invalid-date" ? { expiresAt: "invalid" }
        : kind === "invalid-source" ? { headTreeHash: "invalid" }
        : kind === "missing-verification" ? { verificationEvidenceId: " " }
        : kind === "missing-assessment" ? { clientAssessmentActivityId: " " } : { reviewBasis: undefined };
      expect(await preflightSemanticReviewExemption({ ...params, ...patch }, "operator", context)).toMatchObject({ success: false, error: "review_exemption_refused" });
      expect(m.approval).not.toHaveBeenCalled(); expect(m.room).not.toHaveBeenCalled();
      expect(m.ci).not.toHaveBeenCalled(); expect(m.review).not.toHaveBeenCalled();
      expect(m.create).not.toHaveBeenCalled();
    },
  );
  it("admits the existing maximum expiry bound without granting an exception", async () => {
    const now = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try { expect(await preflightSemanticReviewExemption({ ...params, expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() }, "operator", context)).toBeNull(); }
    finally { clock.mockRestore(); }
  });
  it("rechecks expiry after human approval even when parameter admission previously passed", async () => {
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toBeNull();
    const roomReads = m.room.mock.calls.length;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(params.expiresAt));
    try {
      expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(false);
      expect(m.approval).toHaveBeenCalledOnce(); expect(m.room).toHaveBeenCalledTimes(roomReads);
      expect(m.create).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it("holds the room fence through evidence insertion", async () => {
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
    expect(m.lock.mock.calls[0][0].join("?")).toContain("FOR UPDATE");
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
    expect(m.create.mock.calls[0][1]).toMatchObject({ $queryRaw: m.lock });
  });
  it("refuses publication when the executor changes after evidence resolution", async () => {
    const original = await m.room();
    m.room.mockResolvedValueOnce(original).mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, executorRef: "receiving-thread" });
    const result = await recordSemanticReviewExemption(params, "operator", context);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/identity changed/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("creates and consumes an exact on-behalf decision using the real shared approval verifier", async () => {
    const actual = await vi.importActual<typeof import("@/lib/coworker/human-approved-execution")>("@/lib/coworker/human-approved-execution");
    m.approval.mockImplementation(actual.humanApprovalForExecution);
    const approved = { ...await m.envelope(), status: "approved", argsJson: { humanApproval: { userId: "admin", approvedAt: new Date(Date.now() - 60_000).toISOString(), by: "admin", onBehalfOf: "operator", reason: "Owner authorized this exact exception." } } };
    m.envelope.mockResolvedValue(approved);
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.create.mock.calls[0][0].details).toMatchObject({ approvedByUserId: "operator", approvalDeciderUserId: "admin" });
    m.rows.mockResolvedValue([{ id: "exception", details: m.create.mock.calls[0][0].details }]);
    m.envelope.mockResolvedValue({ ...approved, status: "executed" });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toMatchObject({ evidenceId: "exception" });
    m.user.mockResolvedValue({ isActive: false, isSuperuser: false, groups: [] });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it("records the actual decision maker separately from the delegated owner", async () => {
    m.approval.mockResolvedValue({ envelopeId: "approved", userId: "operator", approverUserId: "admin", onBehalfOf: "operator" });
    expect((await recordSemanticReviewExemption(params, "operator", context)).success).toBe(true);
    expect(m.create.mock.calls[0][0].details).toMatchObject({ approvedByUserId: "operator", approvalDeciderUserId: "admin", approvalOnBehalfOfUserId: "operator" });
  });
  it("consumes a valid on-behalf approval without rewriting its recorded decider", async () => {
    m.approval.mockResolvedValue({ envelopeId: "approved", userId: "operator", approverUserId: "admin", onBehalfOf: "operator" });
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "exception", details: m.create.mock.calls[0][0].details }]);
    const approved = await m.envelope();
    m.envelope.mockResolvedValue({ ...approved, argsJson: { humanApproval: { userId: "admin", approvedAt: new Date(Date.now() - 60_000).toISOString(), by: "admin", onBehalfOf: "operator", reason: "Owner authorized this exact exception." } } });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toMatchObject({ evidenceId: "exception" });
  });
  it("does not turn a legacy record without decider provenance into an on-behalf exception", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    const { approvalDeciderUserId: _decider, approvalOnBehalfOfUserId: _owner, ...legacy } = m.create.mock.calls[0][0].details;
    m.rows.mockResolvedValue([{ id: "exception", details: legacy }]);
    const approved = await m.envelope();
    m.envelope.mockResolvedValue({ ...approved, argsJson: { humanApproval: { userId: "admin", approvedAt: new Date(Date.now() - 60_000).toISOString(), by: "admin", onBehalfOf: "operator", reason: "Owner authorized this exact exception." } } });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it("retains a legacy direct-owner record with a still-valid exact approval", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    const { approvalDeciderUserId: _decider, approvalOnBehalfOfUserId: _owner, ...legacy } = m.create.mock.calls[0][0].details;
    m.rows.mockResolvedValue([{ id: "exception", details: legacy }]);
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toMatchObject({ evidenceId: "exception" });
  });
  it("rejects changed actual-decider provenance", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "exception", details: { ...m.create.mock.calls[0][0].details, approvalDeciderUserId: "someone-else" } }]);
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
  it("rechecks actual decision-maker authority when the exception is consumed", async () => {
    await recordSemanticReviewExemption(params, "operator", context);
    m.rows.mockResolvedValue([{ id: "exception", details: m.create.mock.calls[0][0].details }]);
    m.user.mockResolvedValue({ isActive: false, isSuperuser: false, groups: [] });
    expect(await resolveWorkroomReviewExemption("WC-room", "room", head)).toBeNull();
  });
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

describe("exception prerequisite content admission", () => {
  it("rejects missing or mismatched authenticated actors without reading prerequisites", async () => {
    for (const caller of [undefined, { ...context, userContext: undefined },
      { ...context, userContext: { ...context.userContext, userId: "another-user" } },
      { ...context, userContext: { ...context.userContext, platformRole: "developer" } },
      { ...context, agentId: " " }]) {
      expect(await preflightSemanticReviewExemption(params, "operator", caller)).toMatchObject({ success: false, error: "review_exemption_refused" });
    }
    expect(m.environment).not.toHaveBeenCalled(); expect(m.room).not.toHaveBeenCalled();
    expect(m.review).not.toHaveBeenCalled(); expect(m.approval).not.toHaveBeenCalled();
  });
  it("does not distinguish an absent target from one the actual caller cannot read", async () => {
    const original = await m.room(); m.room.mockClear();
    m.room.mockResolvedValue(null);
    const absent = await preflightSemanticReviewExemption(params, "operator", context);
    expect(absent).toMatchObject({ success: false, error: "review_exemption_refused" });
    m.room.mockResolvedValue(original); m.room.mockClear();
    m.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toEqual(absent);
    expect(m.room.mock.calls).toEqual([[{ where: { capsuleId: "WC-room" }, select: { id: true } }]]);
    expect(m.ci).not.toHaveBeenCalled(); expect(m.review).not.toHaveBeenCalled();
  });
  it.each(["oauth", "pat", "internal"])("%s cannot inspect an inaccessible alternate assessment room or infer its existence", async authSource => {
    const caller = { ...context, authSource };
    m.review.mockResolvedValue(null);
    const absent = await preflightSemanticReviewExemption(params, "operator", caller);
    expect(absent).toMatchObject({ success: false, error: "review_exemption_refused" });
    m.review.mockClear(); m.access.mockClear();
    m.review.mockResolvedValue({ workCapsuleId: "private-review-room" });
    m.access.mockImplementation(async ({ workroomId }) => ({ decision: { level: workroomId === "room" ? "content" : "none" } }));
    const denied = await preflightSemanticReviewExemption(params, "operator", caller);
    expect(denied).toEqual(absent);
    expect(m.review.mock.calls).toEqual([[{ where: { id: "review" }, select: { workCapsuleId: true } }]]);
    expect(m.access).toHaveBeenCalledWith({ userId: "operator", agentId: "author", workroomId: "private-review-room", requested: "content" }, expect.anything());
    expect(m.ci).not.toHaveBeenCalled(); expect(m.approval).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("admits a separately authorized assessment and fences its payload to the admitted room", async () => {
    const originalReview = await m.review(); m.review.mockClear();
    const originalRoom = await m.room(); m.room.mockClear();
    m.review.mockResolvedValue({ ...originalReview, workCapsuleId: "reviewer-room" });
    m.room.mockImplementation(async ({ where }) => where.id === "reviewer-room" ? { id: "reviewer-room", executorRef: "review-chat" } : originalRoom);
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toBeNull();
    expect(m.access).toHaveBeenCalledWith({ userId: "operator", agentId: "author", workroomId: "reviewer-room", requested: "content" }, expect.anything());
    expect(m.review).toHaveBeenCalledWith({ where: { id: "review", workCapsuleId: "reviewer-room" } });
    expect(m.ci).toHaveBeenCalledWith({ where: { id: "ci", workCapsuleId: "room" } });
    expect(m.approval).not.toHaveBeenCalled(); expect(m.lock).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("cannot follow an assessment moved to another room between its locator and payload reads", async () => {
    m.review.mockImplementation(async ({ select, where }) => select ? { workCapsuleId: "room" }
      : where.workCapsuleId === "private-new-owner" ? { payload: "MUST-NOT-READ" } : null);
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toMatchObject({ success: false, error: "review_exemption_refused" });
    expect(m.review).toHaveBeenCalledWith({ where: { id: "review", workCapsuleId: "room" } });
    expect(m.review.mock.calls.some(([args]) => args.where.workCapsuleId === "private-new-owner")).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("scopes both executed and source-local verification lookups to the admitted target", async () => {
    const review = await m.review(); m.review.mockClear();
    m.ci.mockImplementation(async ({ where }) => { expect(where).toEqual({ id: "ci", workCapsuleId: "room" }); return null; });
    m.review.mockImplementation(async ({ where }) => where.id === "review" ? review : null);
    const missing = await preflightSemanticReviewExemption(params, "operator", context);
    expect(missing).toMatchObject({ success: false, error: "review_exemption_refused" });
    expect(m.review).toHaveBeenCalledWith({ where: { id: "ci", workCapsuleId: "room" } });
    expect(m.approval).not.toHaveBeenCalled();
  });
  it.each(["environment", "access", "review", "ci"] as const)("keeps a failed %s read inconclusive without exposing its private error", async reader => {
    m[reader].mockRejectedValue(new Error("PRIVATE-room-WC-SECRET branch confidential/head person@example.test"));
    const result = await preflightSemanticReviewExemption(params, "operator", context);
    expect(result).toMatchObject({ success: false, error: "authority_evidence_unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|WC-SECRET|confidential\/head|person@example/);
    expect(m.approval).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["installation", "intent", "source", "verification", "assessment", "native-failure", "access"])("rechecks %s changed while a person decides", async fact => {
    expect(await preflightSemanticReviewExemption(params, "operator", context)).toBeNull();
    if (fact === "installation") m.environment.mockResolvedValue({ environmentClass: "production" });
    if (fact === "intent") m.intent.mockResolvedValue({ status: "valid", intent: { primaryPurpose: "operate-organization" } });
    if (fact === "source") m.room.mockResolvedValue({ ...await m.room(), headSha: "e".repeat(40) });
    if (fact === "verification") m.ci.mockResolvedValue(null);
    if (fact === "assessment") m.review.mockResolvedValue(null);
    if (fact === "native-failure") m.failed.mockResolvedValue({ id: "current-failure" });
    if (fact === "access") m.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    const result = await recordSemanticReviewExemption(params, "operator", context);
    expect(result).toMatchObject({ success: false, error: "review_exemption_refused" });
    expect(m.approval).toHaveBeenCalledOnce(); expect(m.create).not.toHaveBeenCalled();
  });
});

function governedFixture(authSource: string | undefined) {
  const base = coworkerAuthorityInputFixture();
  const authority = vi.fn(async () => coworkerAuthorityInputFixture({
    authContext: { ...base.authContext, actingHumanUserId: "operator", actingAgentId: "author",
      grantedCapabilities: [...base.authContext.grantedCapabilities, "manage_platform"] },
    action: { ...base.action, toolName: "record_semantic_review_exemption", requiredCapability: "manage_platform",
      sideEffect: true, executionMode: "immediate", approvalPolicy: "all", consequence: "authority" }, rawParams: params,
  }));
  const envelopes = vi.fn(async () => ({ id: "ENV-ELIGIBLE", status: "proposed", expiresAt: new Date(params.expiresAt) }));
  const decisions = vi.fn(); const execute = vi.fn(async () => ({ success: true, message: "Must remain approval-gated." }));
  _setGovernanceForTests({ resolveAgentGrants: async () => ["backlog_write"], isAllowedByGrants: () => true,
    executeTool: execute, resolveCoworkerAuthorityInput: authority, authorizationDecisionCreate: decisions,
    authorityApprovalEnvelopeCreate: envelopes, toolExecutionCreate: async () => ({ id: "audit" }),
    toolExecutionReceiptCreate: async () => ({ id: "receipt" }), policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true, authorityExecutedOutcome: async () => null, toolPreflight: null });
  return { authority, envelopes, decisions, execute, call: () => governedExecuteTool({
    toolName: "record_semantic_review_exemption", rawParams: params, userId: "operator", userContext: context.userContext,
    source: authSource ? "external-jsonrpc" : "agentic-loop", context: { agentId: "author", ...(authSource ? { authSource } : {}) },
  }) };
}

describe("exception eligibility to actual governed escalation", () => {
  it.each(["oauth", "pat", undefined])("keeps one human approval for an eligible %s request", async authSource => {
    const f = governedFixture(authSource);
    expect(await f.call()).toMatchObject({ success: false, error: "approval_required", data: { envelopeId: "ENV-ELIGIBLE" } });
    expect(f.authority).toHaveBeenCalledOnce(); expect(f.decisions).toHaveBeenCalledOnce(); expect(f.envelopes).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled(); expect(m.approval).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["production", "missing-room", "denied-review", "bad-verification", "failed-review", "read-unavailable"])("%s creates no authority row, approval or exception", async problem => {
    const f = governedFixture(undefined);
    if (problem === "production") m.environment.mockResolvedValue({ environmentClass: "production" });
    if (problem === "missing-room") m.room.mockResolvedValue(null);
    if (problem === "denied-review") {
      m.review.mockResolvedValue({ workCapsuleId: "private-review-room" });
      m.access.mockImplementation(async ({ workroomId }) => ({ decision: { level: workroomId === "room" ? "content" : "none" } }));
    }
    if (problem === "bad-verification") m.ci.mockResolvedValue(null);
    if (problem === "failed-review") m.failed.mockResolvedValue({ id: "current-failure" });
    if (problem === "read-unavailable") m.environment.mockRejectedValue(new Error("PRIVATE unavailable prerequisite"));
    expect(await f.call()).toMatchObject({ success: false, error: problem === "read-unavailable" ? "authority_evidence_unavailable" : "review_exemption_refused",
      governance: { rejected: "precondition_denied" } });
    expect(f.authority).not.toHaveBeenCalled(); expect(f.decisions).not.toHaveBeenCalled(); expect(f.envelopes).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled(); expect(m.approval).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
});
