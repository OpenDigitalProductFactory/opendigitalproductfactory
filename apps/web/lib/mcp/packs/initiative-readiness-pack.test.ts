import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  findReads: vi.fn(),
  findReceipts: vi.fn(),
  readSource: vi.fn(),
  recordGateReceipt: vi.fn(),
  recordSpecApproval: vi.fn(),
  recordObjectiveMapping: vi.fn(),
  findActivity: vi.fn(),
  findWorkroom: vi.fn(),
  findBacklogActivities: vi.fn(),
  preflightArtifact: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: (...args: unknown[]) => mocks.findTaskRun(...args) },
    toolExecution: { findMany: (...args: unknown[]) => mocks.findReads(...args) },
    toolExecutionReceipt: { findMany: (...args: unknown[]) => mocks.findReceipts(...args) },
    workroomActivity: { findUnique: (...args: unknown[]) => mocks.findActivity(...args) },
    workroom: { findUnique: (...args: unknown[]) => mocks.findWorkroom(...args) },
    backlogItemActivity: { findMany: (...args: unknown[]) => mocks.findBacklogActivities(...args) },
  },
}));

vi.mock("@/lib/backlog/initiative-readiness", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness")>(),
  recordInitiativeGateReceipt: (...args: unknown[]) => mocks.recordGateReceipt(...args),
  recordInitiativeSpecApproval: (...args: unknown[]) => mocks.recordSpecApproval(...args),
  recordInitiativeObjectiveMappingProposal: (...args: unknown[]) => mocks.recordObjectiveMapping(...args),
}));

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";
vi.mock("@/lib/backlog/initiative-readiness/evidence-preflight", () => ({ preflightEvidenceArtifact: mocks.preflightArtifact }));
import { initiativeReadinessPack, preflightInitiativeEvidence } from "./initiative-readiness-pack";

const expected = {
  record_initiative_evidence: ["manage_backlog", "initiative_evidence_write"],
  record_initiative_design_review: ["manage_backlog", "initiative_design_review"],
  record_initiative_architecture_review: ["manage_ea_model", "initiative_architecture_review"],
  record_initiative_data_review: ["manage_ea_model", "initiative_data_review"],
  record_initiative_ux_review: ["manage_backlog", "initiative_ux_review"],
  record_initiative_security_review: ["manage_compliance", "initiative_security_review"],
  record_initiative_compliance_review: ["manage_compliance", "initiative_compliance_review"],
  record_initiative_domain_review: ["manage_backlog", "initiative_domain_review"],
  record_initiative_archetype_review: ["manage_taxonomy", "initiative_archetype_review"],
  record_initiative_post_implementation_review: ["manage_backlog", "initiative_design_review"],
} as const;

describe("initiative readiness reviewer tools", () => {
  it("requires the exact positive terminal verification evidence to resolve the qualification finding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-18T12:00:00.000Z"));
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-research-writer-secret");
    const headSha = "d".repeat(40);
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-B3DEC077", workroomId: "WC-QUAL",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha,
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "review-protocol-1",
      shapeKey: "delivery-small-fix", shapeVersion: "1.0.0", stageKey: "reproduce", policyVersion: 1,
      targetProductionBlobIds: ["e".repeat(40)], allowedPaths: ["apps/web/lib/example.test.ts"],
      executorMode: "sandbox-build", requiredPlatform: "linux",
      permittedTools: ["run_sandbox_tests", "record_workroom_evidence"],
      issuedAt: "2025-06-18T11:00:00.000Z", expiresAt: "2025-06-18T13:00:00.000Z",
      maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha, diffDigest: `sha256:${"f".repeat(64)}`, testBlobIds: ["1".repeat(40)],
        productionBytesUnchanged: true, reviewReceiptId: "review-1" },
    };
    const token = createQualificationExperimentAdmission(binding);
    const params = { itemId: binding.itemId, gate: "research", decision: "pass", reason: "Bound verification reproduced the gap.",
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: headSha,
        path: "docs/protocol.md", providerBlobId: binding.protocol.providerBlobId },
      findings: [], resolvedFindingRefs: ["IF-91E987DA433B0C82"], qualificationEvidenceId: "evidence-verify" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { qualificationExperiment: binding } });
    const outputDigest = `sha256:${"2".repeat(64)}`;
    mocks.findActivity.mockResolvedValue({ id: "evidence-verify", workCapsuleId: "room-row", payload: { result: {
      qualificationOutcome: "positive", qualificationBindingDigest: qualificationBindingDigest(binding),
      command: "run_sandbox_tests", outputDigest, taskRunId: "TR-SCHED-QUAL",
      executorMode: "sandbox-build", requiredPlatform: "linux", headSha,
      testBlobIds: binding.candidate!.testBlobIds,
      toolExecutionReceiptIds: ["receipt-verify"], startedAt: "2025-06-18T11:05:00.000Z",
      completedAt: "2025-06-18T11:06:00.000Z",
    } } });
    mocks.findWorkroom.mockResolvedValue({ backlogItemId: binding.itemId, workspaceState: {
      qualificationExperimentAdmission: { schemaVersion: 1, status: "settled", token,
        bindingDigest: qualificationBindingDigest(binding), startCount: 1, issuedAt: binding.issuedAt,
        startedAt: "2025-06-18T11:05:00.000Z", taskId: "task-verify", taskRunId: "TR-SCHED-QUAL",
        evidenceId: "evidence-verify" },
    } });
    mocks.findReceipts.mockResolvedValue([{ id: "receipt-verify", receiptKind: "sandbox-test-run",
      receiptStatus: "valid", executionStatus: "succeeded", expiresAt: new Date("2025-07-18T11:06:00.000Z"),
      outputDigest: { sha256: "2".repeat(64) }, toolExecution: { taskRunId: "TR-SCHED-QUAL",
        toolName: "run_sandbox_tests", success: true, parameters: { auto_fix: false },
        result: { success: true, data: { testsFailed: 0, typecheckPassed: true, autoFixEnabled: false } },
        createdAt: new Date("2025-06-18T11:05:30.000Z") } }]);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "research-receipt" });
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: true, data: { receiptId: "research-receipt" } });
    expect(mocks.findReceipts).toHaveBeenCalledTimes(1);
    mocks.findActivity.mockResolvedValue({ id: "evidence-verify", workCapsuleId: "room-row", payload: { result: {
      qualificationOutcome: "positive", qualificationBindingDigest: qualificationBindingDigest(binding),
      command: "run_sandbox_tests", outputDigest, taskRunId: "TR-FOREIGN",
      executorMode: "sandbox-build", requiredPlatform: "linux", headSha,
      testBlobIds: binding.candidate!.testBlobIds,
      toolExecutionReceiptIds: ["receipt-verify"], startedAt: "2025-06-18T11:05:00.000Z",
      completedAt: "2025-06-18T11:06:00.000Z",
    } } });
    mocks.findReceipts.mockResolvedValue([{ id: "receipt-verify", receiptKind: "sandbox-test-run",
      receiptStatus: "valid", executionStatus: "succeeded", expiresAt: new Date("2025-07-18T11:06:00.000Z"),
      outputDigest: { sha256: "2".repeat(64) }, toolExecution: { taskRunId: "TR-FOREIGN",
        toolName: "run_sandbox_tests", success: true, parameters: { auto_fix: false },
        result: { success: true, data: { testsFailed: 0, typecheckPassed: true, autoFixEnabled: false } },
        createdAt: new Date("2025-06-18T11:05:30.000Z") } }]);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: false, error: "qualification-evidence-required" });
    mocks.findActivity.mockResolvedValue({ id: "evidence-verify", workCapsuleId: "room-row", payload: { result: {
      qualificationOutcome: "positive", qualificationBindingDigest: qualificationBindingDigest(binding),
      command: "run_sandbox_tests", outputDigest, taskRunId: "TR-SCHED-QUAL",
      executorMode: "sandbox-build", requiredPlatform: "linux", headSha,
      testBlobIds: binding.candidate!.testBlobIds,
      toolExecutionReceiptIds: ["receipt-verify"], startedAt: "2025-06-18T11:05:00.000Z",
      completedAt: "2025-06-18T11:06:00.000Z",
    } } });
    mocks.findReceipts.mockResolvedValue([{ id: "receipt-verify", receiptKind: "sandbox-test-run",
      receiptStatus: "valid", executionStatus: "succeeded", expiresAt: new Date("2025-07-18T11:06:00.000Z"),
      outputDigest: { sha256: "2".repeat(64) }, toolExecution: { taskRunId: "TR-SCHED-QUAL",
        toolName: "run_sandbox_tests", success: true, parameters: { auto_fix: false },
        result: { success: true, data: { testsFailed: 0, typecheckPassed: true, autoFixEnabled: false } },
        createdAt: new Date("2025-06-18T11:05:30.000Z") } }]);
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { qualificationExperiment: {
      ...binding, repositoryFullName: "foreign/repo",
    } } });
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: false, error: "qualification-evidence-required" });
    mocks.findReceipts.mockResolvedValue([]);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: false, error: "qualification-evidence-required" });
    mocks.findActivity.mockResolvedValue(null);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: false, error: "qualification-evidence-required" });
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("accepts a settled host verification only from exact typed execution activities", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-18T12:00:00.000Z"));
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-research-writer-secret");
    const headSha = "d".repeat(40);
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-B3DEC077", workroomId: "WC-QUAL",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha,
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "review-protocol-1",
      shapeKey: "delivery-small-fix", shapeVersion: "1.0.0", stageKey: "reproduce", policyVersion: 1,
      targetProductionBlobIds: ["e".repeat(40)], allowedPaths: ["scripts/lib/local-ci-gate-state.test.mjs"],
      executorMode: "workroom-host", requiredPlatform: "win32",
      permittedTools: ["record_execution_evidence", "record_workroom_evidence"],
      issuedAt: "2025-06-18T11:00:00.000Z", expiresAt: "2025-06-18T13:00:00.000Z",
      maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha, diffDigest: `sha256:${"f".repeat(64)}`, testBlobIds: ["1".repeat(40)],
        productionBytesUnchanged: true, reviewReceiptId: "review-1" },
    };
    const token = createQualificationExperimentAdmission(binding);
    const outputDigest = `sha256:${"2".repeat(64)}`;
    const execution = { workroomId: binding.workroomId,
      qualificationBindingDigest: qualificationBindingDigest(binding), executorMode: "workroom-host",
      platform: "win32", headSha, testBlobIds: binding.candidate!.testBlobIds,
      command: "pnpm exec vitest run scripts/lib/local-ci-gate-state.test.mjs", outputDigest,
      startedAt: "2025-06-18T11:05:10.000Z", completedAt: "2025-06-18T11:05:20.000Z",
      exitCode: 0, skipped: false };
    const params = { itemId: binding.itemId, gate: "research", decision: "pass",
      reason: "The exact Windows handle qualification passed.", artifactRef: { kind: "repo-blob-at-commit",
        repositoryFullName: binding.repositoryFullName, commitSha: headSha,
        path: binding.protocol.path, providerBlobId: binding.protocol.providerBlobId },
      findings: [], resolvedFindingRefs: ["IF-91E987DA433B0C82"], qualificationEvidenceId: "evidence-host" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { qualificationExperiment: binding } });
    mocks.findActivity.mockResolvedValue({ id: "evidence-host", workCapsuleId: "room-row", payload: { result: {
      qualificationOutcome: "positive", qualificationBindingDigest: qualificationBindingDigest(binding),
      command: execution.command, outputDigest, executorMode: "workroom-host", requiredPlatform: "win32",
      headSha, testBlobIds: binding.candidate!.testBlobIds, executionEvidenceActivityIds: ["activity-host"],
      startedAt: execution.startedAt, completedAt: execution.completedAt,
    } } });
    mocks.findWorkroom.mockResolvedValue({ backlogItemId: binding.itemId, workspaceState: {
      qualificationExperimentAdmission: { schemaVersion: 1, status: "settled", token,
        bindingDigest: qualificationBindingDigest(binding), startCount: 1, issuedAt: binding.issuedAt,
        startedAt: "2025-06-18T11:05:00.000Z", taskId: "workroom-host:WC-QUAL",
        evidenceId: "evidence-host" },
    } });
    mocks.findBacklogActivities.mockResolvedValue([{ id: "activity-host",
      backlogItem: { itemId: binding.itemId }, payload: { evidenceKind: "test_pass", qualification: execution },
      recordedAt: new Date(execution.completedAt) }]);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "research-host-receipt" });

    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: true, data: { receiptId: "research-host-receipt" } });
    mocks.findBacklogActivities.mockResolvedValue([{ id: "activity-host",
      backlogItem: { itemId: binding.itemId }, payload: { evidenceKind: "test_pass",
        qualification: { ...execution, platform: "linux" } }, recordedAt: new Date(execution.completedAt) }]);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(params, "user", {} as never))
      .toMatchObject({ success: false, error: "qualification-evidence-required" });
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it("preflights the accepted item and artifact rather than caller replacements", async () => {
    const artifactRef = { kind: "document-version", versionId: "accepted-version" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_evidence", itemId: "BI-ACCEPTED", gate: "research", artifactRef,
    } } });
    mocks.preflightArtifact.mockResolvedValue(null);
    const context = { taskRunId: "TR-ACCEPTED", agentId: "AGT-OWN", tokenScope: "write" as const };
    expect(await preflightInitiativeEvidence({ itemId: "BI-FORGED", gate: "classification",
      artifactRef: { kind: "document-version", versionId: "forged" }, reason: "Verified." }, "user", context)).toBeNull();
    expect(mocks.preflightArtifact).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", context,
      params: expect.objectContaining({ itemId: "BI-ACCEPTED", gate: "research", artifactRef }) }));
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
  });
  it("refuses malformed trusted workroom context and never accepts a caller-selected replacement", async () => {
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40),
      providerBlobId: "b".repeat(40), path: "plan.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "plan-review", artifactRef,
      workroomRef: { kind: "workroom-head", workroomId: "WC-TEST" },
    } } });
    const handler = initiativeReadinessPack.handlers.record_initiative_design_review!;
    expect(await handler({ itemId: "BI-OTHER", gate: "plan-review", artifactRef, decision: "pass", reason: "Reviewed.",
      findings: [], resolvedFindingRefs: [], workroomRef: { kind: "workroom-head", workroomId: "WC-OTHER" } },
      "user", { taskRunId: "TR-BOUND" } as never)).toMatchObject({ success: false, error: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    mocks.findTaskRun.mockResolvedValue(null);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "legacy-receipt" });
    await handler({ itemId: "BI-TEST", gate: "plan-review", artifactRef, decision: "pass", reason: "Reviewed.",
      findings: [], resolvedFindingRefs: [], workroomRef: { kind: "workroom-head", workroomId: "WC-OTHER" } }, "user", {} as never);
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ workroomRef: undefined }));
  });
  it("carries only the trusted TaskRun workroom identity to the writer alongside the historical plan", async () => {
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: "admitted", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "9".repeat(64) };
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
      commitSha: "99986af2a1fb1ff8d041ca7d9080ea6d02a4f963", providerBlobId: "b".repeat(40), path: "plan.md" };
    const workroomRef = { kind: "workroom-head", workroomId: "WC-DF238BD5", repositoryFullName: "owner/repo",
      branchName: "feat/provider-accounts-ux", headSha: "45eb029a53ffd593f08be48eb4a061488aaa735f" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_design_review", itemId: "BI-7AA4EB6B", gate: "plan-review", artifactRef, workroomRef,
      expectedCurrentBaselineId: "baseline-434",
    } } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "plan-receipt" });
    expect(await initiativeReadinessPack.handlers.record_initiative_design_review!({ decision: "pass", reason: "Reviewed.",
      findings: [], resolvedFindingRefs: [], workroomRef: { ...workroomRef, headSha: artifactRef.commitSha },
      taskExecutionFence: { ...taskExecutionFence, reservation: "forged" } },
      "user", { taskRunId: "TR-E084", agentId: "AGT-WS-REVIEW", taskExecutionFence } as never)).toMatchObject({ success: true });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ artifactRef, workroomRef,
      expectedCurrentBaselineId: "baseline-434", boundReviewTask: expect.objectContaining({ executionFence: taskExecutionFence }) }));
  });
  it("validates a real failure citation after metrics-only source auditing without retaining source in the audit", async () => {
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "design.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_post_implementation_review", itemId: "BI-PIR", gate: "post-implementation-review", artifactRef,
    } } });
    mocks.findReads.mockResolvedValue([{ id: "read-1", toolName: "read_source_at_version", success: true, createdAt: new Date(), result: {},
      parameters: { repositoryFullName: "owner/repo", path: "design.md", version: artifactRef.commitSha, expectedBlobId: artifactRef.providerBlobId } }]);
    mocks.readSource.mockResolvedValue({ success: true, message: "Exact source", data: {
      repositoryFullName: "owner/repo", path: "design.md", version: artifactRef.commitSha, blobId: artifactRef.providerBlobId,
      content: "Verification: TBD", startLine: 2, endLine: 2, totalLines: 2, hasMore: false, nextCursor: null,
    } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "real-failure" });
    const assessment = { decision: "fail", reason: "Verification remains unspecified.", resolvedFindingRefs: [], findings: [{
      issue: "Verification is unspecified.", severity: "important", evidence: { blobId: artifactRef.providerBlobId, startLine: 2, endLine: 2, quote: "Verification: TBD" },
    }] };
    const handler = initiativeReadinessPack.handlers.record_initiative_post_implementation_review!;
    const context = { taskRunId: "TR-PIR", agentId: "AGT-REVIEW", governedDispatch: mocks.readSource } as never;
    expect(await handler(assessment, "user", context))
      .toMatchObject({ success: true, data: { receiptId: "real-failure" } });
    expect(mocks.readSource).toHaveBeenCalledTimes(1);
    expect(mocks.readSource).toHaveBeenCalledWith("read_source_at_version", expect.objectContaining({
      version: artifactRef.commitSha, expectedBlobId: artifactRef.providerBlobId, path: artifactRef.path,
    }));
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ decision: "fail", findings: assessment.findings }));
    mocks.recordGateReceipt.mockClear();
    assessment.findings[0]!.evidence.quote = "invented quote";
    expect(await handler(assessment, "user", context))
      .toMatchObject({ success: false, error: "malformed-receipt" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    mocks.readSource.mockResolvedValue({ success: false, error: "insufficient_token_scope", message: "Reader grant was revoked." });
    expect(await handler(assessment, "user", context)).toMatchObject({ success: false, error: "insufficient_token_scope" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
  });

  it("validates a short cited range without hydrating a design larger than 64k", async () => {
    const lines = Array.from({ length: 1000 }, (_, index) => index === 49 ? "Verification: TBD" : "x".repeat(80));
    expect(lines.join("\n").length).toBeGreaterThan(64_000);
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "large.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_post_implementation_review", itemId: "BI-PIR", gate: "post-implementation-review", artifactRef,
    } } });
    mocks.findReads.mockResolvedValue([{ id: "read-large", toolName: "read_source_at_version", success: true, createdAt: new Date(), result: {},
      parameters: { repositoryFullName: "owner/repo", path: "large.md", version: artifactRef.commitSha, expectedBlobId: artifactRef.providerBlobId, startLine: 50 } }]);
    mocks.readSource.mockImplementation(async (_name, args) => args.startLine === 50 ? { success: true, message: "Cited range", data: {
      repositoryFullName: "owner/repo", path: "large.md", version: artifactRef.commitSha, blobId: artifactRef.providerBlobId,
      content: lines[49] + "\n", startLine: 50, endLine: 50, totalLines: lines.length, hasMore: true, nextCursor: "remaining-document",
    } } : { success: false, error: "unexpected-full-read", message: "Only the cited range is needed." });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "large-failure" });
    const result = await initiativeReadinessPack.handlers.record_initiative_post_implementation_review!({ decision: "fail",
      reason: "Verification remains unspecified.", resolvedFindingRefs: [], findings: [{ issue: "Verification is unspecified.", severity: "important",
        evidence: { blobId: artifactRef.providerBlobId, startLine: 50, endLine: 50, quote: lines[49] } }] },
      "user", { taskRunId: "TR-PIR", agentId: "AGT-REVIEW", governedDispatch: mocks.readSource } as never);
    expect(result).toMatchObject({ success: true, data: { receiptId: "large-failure" } });
    expect(mocks.readSource).toHaveBeenCalledTimes(1);
  });
  it("BI-31159978 rejects positive observations encoded as passing research findings without deleting them", async () => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: {
      trigger: "external-mcp",
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence", itemId: "BI-31159978", gate: "research",
        artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
          commitSha: "7d22b24673c138036685312387a425984c7a330d",
          providerBlobId: "511894b16063195e4bf9f6977f1f5a3fd0549693", path: "design.md" },
      },
    } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "unexpected-receipt" });
    const assessment = { decision: "pass", reason: "The reproduction is complete.",
      findings: [{ issue: "The design clearly documents the ownership boundary.", severity: "important" }],
      resolvedFindingRefs: [] };
    const original = structuredClone(assessment);
    const result = await initiativeReadinessPack.handlers.record_initiative_evidence!(
      assessment, "user-1", { taskRunId: "TR-REPRO", agentId: "AGT-WS-PORTFOLIO" } as never,
    );
    expect(result).toMatchObject({ success: false, error: "malformed-receipt" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    expect(assessment).toEqual(original);
    const corrected = await initiativeReadinessPack.handlers.record_initiative_evidence!(
      { ...assessment, findings: [], reason: assessment.reason + " The design clearly documents the ownership boundary." },
      "user-1", { taskRunId: "TR-REPRO", agentId: "AGT-WS-PORTFOLIO" } as never,
    );
    expect(corrected).toMatchObject({ success: true, data: { receiptId: "unexpected-receipt" } });
    expect(mocks.recordGateReceipt).toHaveBeenCalledTimes(1);
  });

  it("requires bound read evidence for a failing finding and preserves a supported finding", async () => {
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "sha", providerBlobId: "blob", path: "design.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_evidence", itemId: "BI-31159978", gate: "research", artifactRef,
    } } });
    const assessment = { decision: "fail", reason: "A verification requirement remains open.", resolvedFindingRefs: [],
      findings: [{ issue: "Verification is unspecified.", severity: "important", evidence: {
        blobId: "blob", startLine: 2, endLine: 2, quote: "Verification: TBD",
      } }] };
    const context = { taskRunId: "TR-BOUND", agentId: "AGT-WS-PORTFOLIO" } as never;
    mocks.findReads.mockResolvedValue([]);
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(assessment, "user-1", context))
      .toMatchObject({ success: false, error: "malformed-receipt" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    mocks.findReads.mockResolvedValue([{ result: { data: { repositoryFullName: "owner/repo", version: "sha", path: "design.md",
      blobId: "blob", startLine: 1, endLine: 2, content: "# Design\nVerification: TBD" } } }]);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "failed-receipt" });
    expect(await initiativeReadinessPack.handlers.record_initiative_evidence!(assessment, "user-1", context))
      .toMatchObject({ success: true, data: { receiptId: "failed-receipt" } });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ findings: assessment.findings, decision: "fail" }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("assigns one exact capability and one exact grant to every thin lane", () => {
    for (const [name, [capability, grant]] of Object.entries(expected)) {
      const definition = initiativeReadinessPack.definitions.find((candidate) => candidate.name === name);
      expect(definition?.requiredCapability).toBe(capability);
      expect(initiativeReadinessPack.grants[name]).toEqual([grant]);
      expect(TOOL_TO_GRANTS[name]).toEqual([grant]);
    }
  });

  it("does not expose a parameterized cross-lane reviewer tool", () => {
    expect(initiativeReadinessPack.definitions.map((definition) => definition.name)).not.toContain("record_initiative_review");
  });

  it("records a PIR using the server binding without asking the model to reconstruct identity", async () => {
    const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "2".repeat(40), providerBlobId: "3".repeat(40), path: "design.md" };
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: {
      writerToolName: "record_initiative_post_implementation_review", itemId: "BI-PIR", gate: "post-implementation-review", expectedCurrentBaselineId: null, artifactRef,
    } } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "PIR-RECEIPT" });
    const result = await initiativeReadinessPack.handlers.record_initiative_post_implementation_review!(
      { decision: "pass", reason: "The repair and verification support acceptance.", findings: [], resolvedFindingRefs: [] },
      "reviewer-user", { taskRunId: "TR-PIR", agentId: "AGT-REVIEW" } as never,
    );
    expect(result).toMatchObject({ success: true, data: { receiptId: "PIR-RECEIPT" } });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-PIR", gate: "post-implementation-review", artifactRef,
      requiresIndependentReviewer: true, reviewerAgentId: "AGT-REVIEW",
    }));
    expect(mocks.recordSpecApproval).not.toHaveBeenCalled();
  });

  it("keeps objective evidence as a proposal operation on the non-approval tool", () => {
    const evidence = initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_evidence")!;
    expect(evidence.inputSchema.properties).toHaveProperty("objectiveMappings");
    expect(evidence.inputSchema.properties).toHaveProperty("baselineId");
    expect(initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_design_review")?.inputSchema.properties)
      .not.toHaveProperty("objectiveMappings");
  });

  it("accepts finding issues but never caller-selected stable finding IDs", () => {
    for (const definition of initiativeReadinessPack.definitions) {
      expect(definition.inputSchema.properties).toHaveProperty("findings");
      expect(definition.inputSchema.properties).not.toHaveProperty("findingRefs");
    }
  });

  it("fails closed on malformed finding arrays and findings attached to a passing spec approval", async () => {
    const handler = initiativeReadinessPack.handlers.record_initiative_design_review!;
    const base = {
      itemId: "BI-TEST",
      gate: "spec-approval",
      decision: "pass",
      artifactRef: { kind: "document-version", versionId: "version-1" },
      reason: "Reviewed.",
      resolvedFindingRefs: [],
      profile: "feature",
      artifactRole: "design-spec",
    };

    await expect(handler({ ...base, findings: [{ severity: "important" }] }, "user-1", {} as never))
      .resolves.toMatchObject({ success: false, error: "malformed-receipt" });
    await expect(handler({
      ...base,
      findings: [{ issue: "Unresolved scope gap", severity: "important" }],
    }, "user-1", {} as never)).resolves.toMatchObject({ success: false, error: "malformed-receipt" });
  });

  it("derives immutable receipt identity from the exact external TaskRun binding", async () => {
    const artifactRef = {
      kind: "repo-blob-at-commit",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
      path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
      providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    };
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-F0715C9C",
          gate: "research",
          artifactRef,
        },
      },
    });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "IRR-RESEARCH-1" });

    const result = await initiativeReadinessPack.handlers.record_initiative_evidence!({
      itemId: "BI-SPOOFED",
      gate: "classification",
      artifactRef: { kind: "document-version", versionId: "spoofed" },
      decision: "pass",
      reason: "Independent assessment from the bound artifact.",
      findings: [],
      resolvedFindingRefs: [],
    }, "user-1", {
      taskRunId: "TR-MCP-BOUND",
      agentId: "AGT-WS-BUILD",
      tokenScope: "write",
    } as never);

    expect(mocks.findTaskRun).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-BOUND" },
      select: { a2aMetadata: true },
    });
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-F0715C9C",
      gate: "research",
      artifactRef,
      decision: "pass",
      findings: [],
      resolvedFindingRefs: [],
      reason: "Independent assessment from the bound artifact.",
    }));
    expect(result).toMatchObject({ success: true, entityId: "IRR-RESEARCH-1" });
  });

  it("uses the server-bound spec baseline precondition even when model arguments spoof string null", async () => {
    const artifactRef = {
      kind: "repo-blob-at-commit",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
      path: "docs/superpowers/specs/2026-08-23-initiative-readiness-traversal-repair-design.md",
      providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    };
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_design_review",
          itemId: "BI-F0715C9C",
          gate: "spec-approval",
          expectedCurrentBaselineId: null,
          artifactRef,
        },
      },
    });
    mocks.recordSpecApproval.mockResolvedValue({ ok: true, baselineId: "IBL-1", receiptId: "IRR-1" });

    const result = await initiativeReadinessPack.handlers.record_initiative_design_review!({
      decision: "pass",
      reason: "Complete.",
      findings: [],
      resolvedFindingRefs: [],
      profile: "fix",
      artifactRole: "design-spec",
      expectedCurrentBaselineId: "null",
      supersessionDispositions: [],
    }, "user-1", { taskRunId: "TR-MCP-SPEC", agentId: "AGT-WS-REVIEW", tokenScope: "write" } as never);

    expect(mocks.recordSpecApproval).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-F0715C9C",
      artifactRef,
      expectedCurrentBaselineId: null,
    }));
    expect(result).toMatchObject({ success: true, entityId: "IBL-1" });
  });

  it("passes only the server-bound eligible evidence ids to objective-mapping persistence", async () => {
    const eligibleEvidenceActivityIds = ["E-1", "E-2"];
    mocks.findTaskRun.mockResolvedValue({
      a2aMetadata: {
        trigger: "external-mcp",
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-BOUND",
          gate: "objective-mapping",
          expectedCurrentBaselineId: "baseline-current",
          eligibleEvidenceActivityIds,
          artifactRef: {
            kind: "repo-blob-at-commit",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
            path: "docs/superpowers/specs/design.md",
            providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
          },
        },
      },
    });
    mocks.recordObjectiveMapping.mockResolvedValue({ ...ok(), proposalId: "MAP-1" });

    await initiativeReadinessPack.handlers.record_initiative_evidence!({
      operation: "objective-mapping",
      baselineId: "baseline-spoofed",
      objectiveMappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-1"] }],
      reason: "Bound mapping.",
    }, "user-1", {
      taskRunId: "TR-MCP-MAPPING",
      agentId: "AGT-WS-ACCEPT",
      authorityDecisionId: "AUTH-1",
      tokenScope: "write",
    } as never);

    expect(mocks.recordObjectiveMapping).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-MAPPING",
      itemId: "BI-BOUND",
      baselineId: "baseline-current",
      eligibleEvidenceActivityIds,
    }));
  });
});

describe("the writer schema states its contract before the writer refuses it (BI-9E522F11)", () => {
  // Measured 2026-09-06 on the reference install: four spec-approval attempts
  // in one hour ended malformed-receipt ("A passing spec approval cannot
  // introduce findings"), one CLASSIFICATION_REQUIRED (profile copied from the
  // spec header), one finding-resolution-invalid. Every rule was enforced on
  // the server and stated nowhere the reviewer could read before calling.
  it("tells the reviewer that a pass carries no findings, what profile to name, and what a resolution may cite", () => {
    const tool = initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_design_review");
    const properties = (tool?.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(properties.decision?.description).toMatch(/findings=\[\]/);
    expect(properties.findings?.description).toMatch(/ONLY on a failing receipt/);
    expect(properties.findings?.description).toMatch(/malformed-receipt/);
    expect(properties.profile?.description).toMatch(/authoritative classification/);
    expect(properties.profile?.description).toMatch(/CLASSIFICATION_REQUIRED/);
    expect(properties.resolvedFindingRefs?.description).toMatch(/finding-resolution-invalid/);
  });
});

describe("bound terminal effect identity carriage", () => {
  const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40),
    providerBlobId: "b".repeat(40), path: "docs/superpowers/specs/design.md" };
  const requestDigest = "9".repeat(64);
  const params = { decision: "pass", reason: "Independent review.", findings: [], resolvedFindingRefs: [],
    profile: "feature", artifactRole: "design-spec", boundReviewTask: { taskRunId: "TR-FORGED", requestDigest: "8".repeat(64) } };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findReads.mockResolvedValue([]);
  });

  it.each(["design-spec", "spec-approval"])("refuses an external TaskRun's %s writer when its accepted binding is absent", async gate => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: null } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "unbound-receipt" });
    mocks.recordSpecApproval.mockResolvedValue({ ok: true, receiptId: "unbound-receipt", baselineId: "unbound-baseline" });
    const result = await initiativeReadinessPack.handlers.record_initiative_design_review!({ ...params, itemId: "BI-BOUND", gate, artifactRef },
      "user", { taskRunId: "TR-UNBOUND", agentId: "AGT-WS-REVIEW", authorityDecisionId: "AUTH-1", tokenScope: "write" } as never);
    expect(result).toMatchObject({ success: false, error: "initiative_review_binding_required" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
    expect(mocks.recordSpecApproval).not.toHaveBeenCalled();
  });

  it.each([{}, { writerToolName: "record_initiative_architecture_review", itemId: "BI-BOUND", gate: "design-spec", artifactRef },
    { writerToolName: "record_initiative_design_review", itemId: "BI-BOUND", gate: "design-spec", artifactRef, futureAuthority: true }])("refuses malformed or mismatched persisted external review binding %j", initiativeReviewBinding => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding } });
    return expect(initiativeReadinessPack.handlers.record_initiative_design_review!({ ...params, itemId: "BI-BOUND", gate: "design-spec", artifactRef },
      "user", { taskRunId: "TR-UNBOUND", agentId: "AGT-WS-REVIEW" } as never)).resolves.toMatchObject({ success: false, error: "initiative_review_binding_required" });
  });

  it("preserves a non-external TaskRun's ordinary independent writer authority", async () => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "scheduled" } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "ordinary-receipt" });
    expect(await initiativeReadinessPack.handlers.record_initiative_design_review!({ ...params, itemId: "BI-BOUND", gate: "design-spec", artifactRef },
      "user", { taskRunId: "TR-SCHED-REVIEW", agentId: "AGT-WS-REVIEW" } as never)).toMatchObject({ success: true });
    expect(mocks.recordGateReceipt).toHaveBeenCalledOnce();
  });

  it.each(["design-spec", "spec-approval"])("carries authenticated task/digest for %s, ignoring forged tool arguments", async (gate) => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest, initiativeReviewBinding: {
      writerToolName: "record_initiative_design_review", itemId: "BI-BOUND", gate, artifactRef,
      expectedCurrentBaselineId: null,
    } } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "receipt-1" });
    mocks.recordSpecApproval.mockResolvedValue({ ok: true, receiptId: "receipt-1", baselineId: "baseline-1" });
    await initiativeReadinessPack.handlers.record_initiative_design_review!(params, "user", {
      taskRunId: "TR-BOUND", agentId: "AGT-WS-REVIEW", authorityDecisionId: "AUTH-1", tokenScope: "write",
    } as never);
    const writer = gate === "spec-approval" ? mocks.recordSpecApproval : mocks.recordGateReceipt;
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ boundReviewTask: { taskRunId: "TR-BOUND", requestDigest } }));
  });

  it("does not accept an argument-selected task identity on an unbound call", async () => {
    mocks.findTaskRun.mockResolvedValue(null);
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "receipt-1" });
    await initiativeReadinessPack.handlers.record_initiative_design_review!({ ...params, itemId: "BI-BOUND", gate: "design-spec", artifactRef },
      "user", { agentId: "AGT-WS-REVIEW" } as never);
    expect(mocks.recordGateReceipt.mock.calls[0]?.[0].boundReviewTask).toBeUndefined();
  });

  it("reports an existing rejecting spec verdict without claiming a new baseline", async () => {
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest, initiativeReviewBinding: {
      writerToolName: "record_initiative_design_review", itemId: "BI-BOUND", gate: "spec-approval", artifactRef,
      expectedCurrentBaselineId: null,
    } } });
    mocks.recordSpecApproval.mockResolvedValue({ ok: true, receiptId: "prior-fail", baselineId: null,
      artifactDigest: `sha256:${"a".repeat(64)}`, deduplicated: true, receipt: { decision: "fail" } });
    const result = await initiativeReadinessPack.handlers.record_initiative_design_review!(params, "user", {
      taskRunId: "TR-BOUND", agentId: "AGT-WS-REVIEW", authorityDecisionId: "AUTH-1", tokenScope: "write",
    } as never);
    expect(result).toMatchObject({ success: true, entityId: "prior-fail", data: { receiptId: "prior-fail", decision: "fail", idempotentReplay: true } });
    expect(result.message).not.toMatch(/baseline recorded/i);
  });
});
