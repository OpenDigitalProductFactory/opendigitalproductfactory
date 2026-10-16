import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  prepareSpecialists: vi.fn(),
  prisma: {
    workroom: { findUnique: vi.fn() },
    externalEvidenceRecord: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    taskRun: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  recordExternalEvidence: vi.fn(),
  recordWorkCapsuleEvidence: vi.fn(),
  dispatchRoutedSemanticReview: vi.fn(),
  enqueueSemanticReview: vi.fn(),
  retryPersistedSemanticReview: vi.fn(),
}));

vi.mock("@/lib/change-review/review-specialist-preparation", () => ({ prepareWorkroomReviewSpecialists: mocks.prepareSpecialists }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: mocks.recordExternalEvidence }));
vi.mock("@/lib/change-review/routed-semantic-review", () => ({
  dispatchRoutedSemanticReview: mocks.dispatchRoutedSemanticReview,
}));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: mocks.recordWorkCapsuleEvidence }));
vi.mock("@/lib/change-review/semantic-review-background", () => ({ enqueueSemanticReview: mocks.enqueueSemanticReview, retryPersistedSemanticReview: mocks.retryPersistedSemanticReview }));

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { changeReviewPack } from "./change-review-pack";
import { failureAnalysisFixture } from "@/lib/change-review/failure-analysis.test-fixtures";
import { validateFailureAnalysis } from "@/lib/change-review/failure-analysis";
import { resolveFailureAnalysisEvidence } from "@/lib/change-review/failure-analysis-evidence";

const taskRows: Array<Record<string, unknown>> = [];

function validReviewInput() {
  const artifact = "diff --git a/file.ts b/file.ts\n";
  const identity = { capsuleId: "WC-SINGLE-FLIGHT", baseTreeHash: "a".repeat(40),
    headTreeHash: "b".repeat(40), diffDigest: createHash("sha256").update(artifact).digest("hex") };
  const fixture = failureAnalysisFixture(identity);
  mocks.prisma.workroom.findUnique.mockResolvedValue({ id: "capsule-row-1", capsuleId: identity.capsuleId,
    headSha: "c".repeat(40), executorKind: "codex-desktop" });
  const row = { id: "executed-test", workCapsuleId: "capsule-row-1", operationType: "local_integration_ci",
    createdAt: new Date(), details: { gateKey: "gate-1", leaseId: "lease-1", status: "passed",
      evidenceValidity: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      evidence: { gatePassed: true, sha: "c".repeat(40), headTreeHash: identity.headTreeHash,
        diffDigest: identity.diffDigest, output: "Exact identity verified", completedAt: new Date().toISOString(),
        commands: ["verify exact identity"] } } };
  mocks.prisma.externalEvidenceRecord.findMany.mockImplementation(async ({ where }) =>
    where.workCapsuleId === row.workCapsuleId && where.id.in.includes(row.id) ? [row] : []);
  return { row, input: { ...identity, authorSurface: "codex-desktop", artifactType: "code-change", title: "Immutable gate coordination",
    artifact, verificationEvidence: "Focused tests passed.", changedFiles: ["apps/web/lib/file.ts"], failureAnalysis: fixture.failureAnalysis } };
}

describe("change-review MCP pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskRows.length = 0;
    mocks.prepareSpecialists.mockImplementation(async ({ userId, capsuleId }) => ({ schemaVersion: 1, userId, capsuleId, registryVersion: "1.0.0", authorAgentIds: ["codex"], requiredProfessions: [], specialists: [], unavailableProfessions: [] }));
    mocks.prisma.workroom.findUnique.mockResolvedValue({ id: "capsule-row-1" });
    mocks.prisma.externalEvidenceRecord.findFirst.mockResolvedValue(null);
    mocks.prisma.externalEvidenceRecord.findUnique.mockResolvedValue(null);
    mocks.recordExternalEvidence.mockResolvedValue({ id: "outcome-evidence-1" });
    mocks.dispatchRoutedSemanticReview.mockResolvedValue({
      decision: "pass",
      issues: [],
      summary: "The exact change passes semantic review.",
    });
    mocks.prisma.taskRun.findMany.mockImplementation(async ({ where }) =>
      taskRows.filter((row) => row.repeatedPatternKey === where.repeatedPatternKey));
    mocks.prisma.taskRun.findUnique.mockImplementation(async ({ where }) =>
      taskRows.find((row) => row.taskRunId === where.taskRunId) ?? null);
    mocks.prisma.taskRun.create.mockImplementation(async ({ data }) => {
      if (taskRows.some((row) => row.taskRunId === data.taskRunId)) {
        throw Object.assign(new Error("duplicate TaskRun"), { code: "P2002" });
      }
      const row = {
        ...data,
        progressPayload: data.progressPayload ?? null,
        createdAt: new Date(),
      };
      taskRows.push(row);
      return row;
    });
    mocks.prisma.taskRun.update.mockImplementation(async ({ where, data }) => {
      const row = taskRows.find((candidate) => candidate.taskRunId === where.taskRunId);
      if (!row) throw new Error("missing TaskRun");
      Object.assign(row, data);
      return row;
    });
    // markTaskRunWorking is a guarded updateMany (BI-D208E70C): move the row
    // only from a working-entry state, and report how many rows moved.
    mocks.prisma.taskRun.updateMany.mockImplementation(async ({ where, data }) => {
      const allowed: string[] = where.status?.in ?? [];
      const row = taskRows.find(
        (candidate) => candidate.taskRunId === where.taskRunId && allowed.includes(String(candidate.status)),
      );
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });
  });

  it("exposes native review and outcome-correlation operations", () => {
    expect(changeReviewPack.definitions.map((definition) => definition.name)).toEqual([
      "review_semantic_change",
      "record_semantic_review_outcome",
      "retry_semantic_review",
      "record_semantic_review_exemption",
    ]);
    expect(Object.keys(changeReviewPack.handlers)).toEqual([
      "review_semantic_change",
      "record_semantic_review_outcome",
      "retry_semantic_review",
      "record_semantic_review_exemption",
    ]);
  });

  it("consults authority only for the exemption writer, preserving ordinary review", () => {
    expect(changeReviewPack.definitions.find(d => d.name === "record_semantic_review_exemption")).toMatchObject({ consequence: "authority", requiredCapability: "manage_platform" });
    expect(changeReviewPack.definitions.find(d => d.name === "review_semantic_change")?.consequence).toBeUndefined();
    expect(isToolAllowedByGrants("record_semantic_review_exemption", ["view_platform"])).toBe(false);
  });

  it("requires evidence-writing authority", () => {
    expect(changeReviewPack.grants.review_semantic_change).toEqual(["backlog_write"]);
    expect(changeReviewPack.grants.record_semantic_review_outcome).toEqual(["backlog_write"]);
    expect(changeReviewPack.grants.retry_semantic_review).toEqual(["backlog_write"]);
    expect(isToolAllowedByGrants("retry_semantic_review", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("retry_semantic_review", ["view_platform"])).toBe(false);
    expect(isToolAllowedByGrants("review_semantic_change", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("review_semantic_change", ["view_platform"])).toBe(false);
  });

  it("requires receipt and GitHub/CI correlation identity", () => {
    const definition = changeReviewPack.definitions.find(
      (candidate) => candidate.name === "record_semantic_review_outcome",
    )!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining([
      "capsuleId",
      "receiptId",
      "surface",
      "pullRequestNumber",
      "ciPassed",
      "merged",
    ]));
  });

  it("binds confirmed recovery to the authenticated user, never a payload identity", async () => {
    mocks.retryPersistedSemanticReview.mockResolvedValueOnce({ newTaskRunId: "TR-1", strategy: "native-review" });
    const out = await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-1", confirmed: true, userId: "other" }, "requester");
    expect(out.success).toBe(true);
    expect(mocks.retryPersistedSemanticReview).toHaveBeenCalledWith("TR-1", "requester", true);
  });
  it("requires both evidence and immutable identity for successor recovery", async () => {
    expect(await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-1", confirmed: true,
      remediationVerificationId: "RV-1" }, "requester")).toMatchObject({ success: false });
    expect(mocks.retryPersistedSemanticReview).not.toHaveBeenCalled();
    mocks.retryPersistedSemanticReview.mockResolvedValueOnce({ newTaskRunId: "TR-2", strategy: "bounded-review-successor" });
    expect(await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-1", confirmed: true,
      remediationVerificationId: "RV-1", expectedRequestDigest: "a".repeat(64) }, "requester")).toMatchObject({ success: true, entityId: "TR-2" });
    expect(mocks.retryPersistedSemanticReview).toHaveBeenCalledWith("TR-1", "requester", true,
      { remediationVerificationId: "RV-1", expectedRequestDigest: "a".repeat(64) });
  });

  it("requires explicit confirmation before invoking recovery", async () => {
    const out = await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-1", confirmed: "true" }, "requester");
    expect(out.success).toBe(false);
    expect(mocks.retryPersistedSemanticReview).not.toHaveBeenCalled();
  });
  it.each(["semantic-review-recovery-authority-denied", "semantic-review-deadline-exhausted", "semantic-review-recovery-state-changed"])("preserves the underlying refusal: %s", async reason => {
    mocks.retryPersistedSemanticReview.mockRejectedValueOnce(new Error(reason));
    const out = await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-1", confirmed: true }, "requester");
    expect(out).toMatchObject({ success: false, message: reason });
  });
  it("does not dispatch unrelated tasks", async () => {
    mocks.retryPersistedSemanticReview.mockResolvedValueOnce(null);
    expect(await changeReviewPack.handlers.retry_semantic_review!({ taskRunId: "TR-OTHER", confirmed: true }, "requester")).toMatchObject({ success: false });
    expect(mocks.enqueueSemanticReview).not.toHaveBeenCalled();
  });

  it("requires an immutable tree identity and exact artifact", () => {
    const definition = changeReviewPack.definitions[0]!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining([
      "capsuleId",
      "baseTreeHash",
      "headTreeHash",
      "diffDigest",
      "artifact",
      "verificationEvidence",
    ]));
  });

  it("persists one review before queueing and subscribes a concurrent caller without inline inference", async () => {
    const { input } = validReviewInput();

    const [left, right] = await Promise.all([
      changeReviewPack.handlers.review_semantic_change!(input, "user-1", { agentId: "codex" }),
      changeReviewPack.handlers.review_semantic_change!(input, "user-1", { agentId: "codex" }),
    ]);

    expect([left.data?.disposition, right.data?.disposition].sort())
      .toEqual(["admitted", "subscribed"]);
    expect(mocks.dispatchRoutedSemanticReview).not.toHaveBeenCalled();
    expect(mocks.recordExternalEvidence).not.toHaveBeenCalled();
    expect(mocks.enqueueSemanticReview).toHaveBeenCalledOnce();
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0]).toMatchObject({ status: "submitted", artifacts: { create: {
      parts: [{ kind: "data", data: { input: { artifact: input.artifact } } }],
    } } });
    const packet = (taskRows[0]!.artifacts as { create: { parts: Array<{ data: { input: { identity: { failureAnalysisDigest: string } } } }> } }).create.parts[0]!.data;
    const executionEvidence = await resolveFailureAnalysisEvidence(input.failureAnalysis, "capsule-row-1");
    expect(packet.input.identity.failureAnalysisDigest).toBe(validateFailureAnalysis(input.failureAnalysis, input, executionEvidence).digest);
  });

  it("keeps an unavailable required craft explicit and admits no review task", async () => {
    const { input } = validReviewInput();
    mocks.prepareSpecialists.mockResolvedValue({ schemaVersion: 1, userId: "user-1", capsuleId: input.capsuleId, registryVersion: "1.0.0", authorAgentIds: ["codex"], requiredProfessions: ["ux-design"], specialists: [], unavailableProfessions: ["ux-design"] });
    const result = await changeReviewPack.handlers.review_semantic_change!(input, "user-1", { agentId: "codex" });
    expect(result).toMatchObject({ success: false, error: "required_specialists_unavailable", data: { requiredProfessions: ["ux-design"] } });
    expect(mocks.prisma.taskRun.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "malformed", "unresolved", "wrong-room", "wrong-tree", "wrong-diff", "expired", "wrong-head"])(
    "refuses %s evidence before reserving or enqueueing review work", async (kind) => {
      const { input, row } = validReviewInput();
      const submitted: Record<string, unknown> = { ...input };
      if (kind === "missing") delete submitted.failureAnalysis;
      if (kind === "malformed") submitted.failureAnalysis = {};
      if (kind === "unresolved") mocks.prisma.externalEvidenceRecord.findMany.mockResolvedValue([]);
      if (kind === "wrong-room") row.workCapsuleId = "other-room";
      if (kind === "wrong-tree") row.details.evidence.headTreeHash = "d".repeat(40);
      if (kind === "wrong-diff") row.details.evidence.diffDigest = "d".repeat(64);
      if (kind === "expired") row.details.evidenceValidity.expiresAt = new Date(Date.now() - 60_000).toISOString();
      if (kind === "wrong-head") row.details.evidence.sha = "d".repeat(40);
      const out = await changeReviewPack.handlers.review_semantic_change!(submitted, "user-1", { agentId: "codex" });
      expect(out).toMatchObject({ success: false, error: "invalid_failure_analysis", data: { reasons: expect.any(Array) } });
      expect(mocks.prisma.taskRun.findMany).not.toHaveBeenCalled();
      expect(mocks.prisma.taskRun.create).not.toHaveBeenCalled();
      expect(mocks.enqueueSemanticReview).not.toHaveBeenCalled();
      expect(taskRows).toHaveLength(0);
    });

  it("records infrastructure-inconclusive correlation without semantic quality counts", async () => {
    mocks.prisma.externalEvidenceRecord.findFirst
      .mockResolvedValueOnce({
        details: {
          schemaVersion: "semantic-change-review-receipt.v2",
          capsuleId: "WC-CALIBRATION",
          baseTreeHash: "a".repeat(40),
          headTreeHash: "b".repeat(40),
          diffDigest: "c".repeat(64),
          policyVersion: "semantic-change-review-policy.v2",
          reviewerVersion: "change-reviewer.v1",
          specialistIds: [],
          disposition: "reviewed",
          risk: "high",
          result: {
            decision: "inconclusive",
            issues: [],
            summary: "Review capacity was unavailable.",
            inconclusiveReason: "capacity-exhausted",
          },
          reviewedAt: "2026-08-01T16:00:00.000Z",
        },
      })
      .mockResolvedValueOnce(null);

    const result = await changeReviewPack.handlers.record_semantic_review_outcome!({
      capsuleId: "WC-CALIBRATION",
      receiptId: "receipt-inconclusive",
      surface: "external",
      pullRequestNumber: 4001,
      ciPassed: true,
      merged: true,
      acceptedFindingCount: 9,
      falsePositiveFindingCount: 4,
    }, "user-1", { agentId: "change-reviewer" });

    expect(result.success).toBe(true);
    expect(mocks.recordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      target: "receipt-inconclusive",
      details: expect.objectContaining({
        correlationStatus: "infrastructure-inconclusive",
        acceptedFindingCount: 0,
        falsePositiveFindingCount: 0,
      }),
    }));
    expect(mocks.recordWorkCapsuleEvidence).toHaveBeenCalledTimes(1);
  });

  it.each([
    { schemaVersion: "semantic-change-review-receipt.v2" },
    { schemaVersion: "semantic-change-review-receipt.v3", artifactType: "code-change" },
  ])("reuses an existing correlation for $schemaVersion", async (contract) => {
    mocks.prisma.externalEvidenceRecord.findFirst
      .mockResolvedValueOnce({
        details: {
          ...contract,
          result: { decision: "pass", issues: [], summary: "Passed." },
        },
      })
      .mockResolvedValueOnce({
        id: "existing-outcome-1",
        resultSummary: "Already correlated.",
        details: { receiptId: "receipt-pass" },
      });

    const result = await changeReviewPack.handlers.record_semantic_review_outcome!({
      capsuleId: "WC-CALIBRATION",
      receiptId: "receipt-pass",
      surface: "external",
      pullRequestNumber: 4002,
      ciPassed: true,
      merged: true,
    }, "user-1", { agentId: "change-reviewer" });

    expect(result).toMatchObject({ success: true, entityId: "existing-outcome-1" });
    expect(mocks.recordExternalEvidence).not.toHaveBeenCalled();
    expect(mocks.recordWorkCapsuleEvidence).not.toHaveBeenCalled();
  });
});
