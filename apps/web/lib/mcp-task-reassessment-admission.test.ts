import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import { createPresentReassessmentAdmission, sealPresentReassessmentExecution, type PresentReassessmentAdmissionInput } from "./mcp-task-reassessment-admission";
import { reassessmentNativeCatalogDigest, REASSESSMENT_NATIVE_COMPOSITION } from "./shared/reassessment-native-composition";
import type { QualifiedReassessmentExecution } from "./routing/reassessment-phase-contract";
import type { ReassessmentCaptureDatabase } from "./mcp-task-reassessment-capture";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";
const lineage = vi.hoisted(() => ({ rows: [] as unknown[], collect: vi.fn(), lock: vi.fn(), revalidate: vi.fn() }));
const prefix = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./mcp-task-reassessment-lineage", () => ({ collectReassessmentLineage: lineage.collect, lockReassessmentLineage: lineage.lock,
  revalidateReassessmentLineage: lineage.revalidate }));
vi.mock("./mcp-task-reassessment-capture", async original => ({ ...await original<object>(), readPersistedReassessmentQualificationPrefix: prefix.read }));
function fixture() {
  const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo", path: "design.md", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) };
  const relation = { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture", policyDigest: "c".repeat(64),
    originalTaskRunId: "TR-original-design", originalRequestDigest: "1".repeat(64), predecessorTaskRunIds: ["TR-original-design"], authorityArtifact: artifactRef };
  const binding = parseInitiativeReviewBinding({ writerToolName: "record_initiative_design_review", itemId: "BI-285EF102", gate: "design-spec",
    expectedCurrentBaselineId: null, artifactRef, presentReassessment: relation, workroomRef: { kind: "workroom-head", workroomId: "WC-FIXTURE",
      repositoryFullName: artifactRef.repositoryFullName, branchName: "codex/fixture", headSha: artifactRef.commitSha } })!;
  const key = createHash("sha256").update(canonicalJson({ itemId: binding.itemId, gate: binding.gate, artifactRef, present: binding.presentReassessment })).digest("hex");
  const parsed = parseRemoteTaskSubmitParams({ agentId: "reviewer", routeContext: "/build", title: "Synthetic assessment", objective: "Exact synthetic assessment", prompt: "Exact synthetic assessment",
    riskClass: "bounded-write", idempotencyKey: `review-reassessment-v1-${key}`, initiativeReviewBinding: binding,
    authorityScope: [`backlog-item:${binding.itemId}`, "tool:read_source_at_version", "tool:record_initiative_design_review"] });
  if (typeof parsed === "string") throw new Error(parsed);
  const policy = { schemaVersion: 1 as const, subjectItemId: "BI-285EF102" as const, maxAssessments: 2 as const,
    historicalConsumption: "retain-unknown" as const, currentLimits: "normal-recorded" as const, originalReplay: false as const, operatorEvidenceActivityIds: ["evidence"],
    requirements: [{ gate: "design-spec" as const, originalRequestDigest: "1".repeat(64), maxAssessments: 1 as const },
      { gate: "spec-approval" as const, originalRequestDigest: "2".repeat(64), maxAssessments: 1 as const }] };
  const input: PresentReassessmentAdmissionInput = { parsed, taskRunId: "TR-present", userId: "owner", actingAgentId: "author", authorityDecisionId: "decision-current",
    proof: { policy, policyDigest: relation.policyDigest, baselineId: relation.baselineId, artifactDigest: "sha256:" + "d".repeat(64),
      authorityArtifact: artifactRef, authorizationItemId: relation.authorizationItemId, authorizationRowId: "authorization-row", subjectRowId: "subject-row" },
    originals: policy.requirements.map(requirement => ({ gate: requirement.gate, taskRunId: `TR-original-${requirement.gate === "design-spec" ? "design" : "approval"}`,
      requestDigest: requirement.originalRequestDigest, readback: { schemaVersion: 1, taskRunId: `TR-original-${requirement.gate === "design-spec" ? "design" : "approval"}`,
        classification: "unknown", readOnly: true, replayAllowed: false, bounded: true, reason: "Retained unknown", observations: [], missingProof: ["historical-settlement"],
        binding: { requestDigest: requirement.originalRequestDigest, checkpointUpdatedAt: new Date().toISOString(), attempt: 1, dispatchAttempt: 1, writerAttempt: 1,
          writerToolName: binding.writerToolName, reviewerAgentId: "old-reviewer", itemId: binding.itemId, gate: requirement.gate, artifactRef, workroomId: "WC-FIXTURE" } } })),
    candidate: { budgetConfiguration: reassessmentBudgetFixture(), bounds: { maxProviderStarts: 20, maxDurationMs: 30_000, maxOutputTokens: 100 },
      nativeObservationUrls: ["http://fixture.invalid/version"] },
    compatibility: { schemaVersion: 1, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) }, worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } } };
  lineage.rows = []; const snapshot = { input: { binding, organizationId: null, originals: input.originals }, subjectRowId: input.proof.subjectRowId, rows: lineage.rows, fingerprint: "e".repeat(64) };
  lineage.collect.mockReset().mockImplementation(async () => snapshot); lineage.lock.mockReset().mockImplementation(async () => ({ snapshot, itemRowIds: [] }));
  lineage.revalidate.mockReset().mockImplementation(async () => snapshot);
  prefix.read.mockReset().mockResolvedValue({ eventCount: 1, providerReservations: 1, providerStarts: 1, digest: "a".repeat(64) });
  const artifacts: Record<string, unknown>[] = [], messages: Record<string, unknown>[] = [];
  const row = { id: "present-row", taskRunId: input.taskRunId, userId: input.userId, currentAgentId: parsed.agentId, status: "working", contextId: "thread", threadId: "thread",
    progressPayload: null, a2aMetadata: { trigger: "external-mcp", requestDigest: remoteTaskRequestDigest(parsed), initiativeReviewBinding: binding } };
  const tx = { backlogItem: { findUnique: vi.fn(async () => ({ id: "subject-row", itemId: binding.itemId, organizationId: null })) },
    taskRun: { findUnique: vi.fn(async () => row), updateMany: vi.fn(async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 }; }) },
    taskArtifact: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { artifacts.push(data); return data; }),
      findUnique: vi.fn(async ({ where }: { where: { artifactId: string } }) => artifacts.find(value => value.artifactId === where.artifactId) ?? null) },
    taskMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { messages.push(data); return data; }) } };
  const validateAuthority = vi.fn(async () => {});
  return { input, tx: tx as unknown as Prisma.TransactionClient, mocks: tx, row, artifacts, messages, validateAuthority };
}

async function sealingFixture() {
  const f = fixture(), hooks = createPresentReassessmentAdmission(f.input, { validateAuthority: f.validateAuthority });
  await hooks.admissionGuard(f.tx); await hooks.afterTaskCreated(f.tx, f.row);
  const oldProgress = { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" }, attempt: 1, savedLimits: { ceiling: 50_000 } };
  const predecessors = f.input.originals.map(original => ({ id: `row-${original.taskRunId}`, taskRunId: original.taskRunId, userId: "owner", currentAgentId: "old-reviewer",
    parentTaskRunId: null, requestDigest: original.requestDigest, binding: parseInitiativeReviewBinding({ ...f.input.parsed.initiativeReviewBinding,
      gate: original.gate, presentReassessment: undefined })!, a2aMetadata: { requestDigest: original.requestDigest }, progressPayload: structuredClone(oldProgress), status: "input-required" }));
  // Absence is encoded by removing the optional relation, as real persisted
  // original requests do; an own undefined property never confers authority.
  for (const predecessor of predecessors) { const raw = { ...f.input.parsed.initiativeReviewBinding! }; delete raw.presentReassessment; predecessor.binding = parseInitiativeReviewBinding({ ...raw, gate: predecessor.binding.gate })!; }
  lineage.rows.push(...predecessors, { ...f.row, binding: f.input.parsed.initiativeReviewBinding, requestDigest: hooks.requestDigest });
  f.mocks.taskRun.updateMany.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = where.id === f.row.id ? f.row : predecessors.find(value => value.id === where.id); if (!row) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  const c = REASSESSMENT_NATIVE_COMPOSITION;
  const unsigned = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const, providerId: "local", providerConnectionId: "connection",
    providerConnectionVersion: "9".repeat(64), modelId: "fixture-model", providerConfigurationDigest: "e".repeat(64), toolSurfaceDigest: "f".repeat(64),
    executionPlan: { providerId: "local", providerConnectionId: "connection", providerConnectionVersion: "9".repeat(64), modelId: "fixture-model", executionChannel: "local-runtime", accountAuthMethod: "none",
      recipeId: null, contractFamily: "review", executionAdapter: "chat", maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
    budgetConfiguration: f.input.candidate.budgetConfiguration, bounds: f.input.candidate.bounds,
    finiteTokenProof: { schemaVersion: 1 as const, kind: c.kind, apiRoot: "http://fixture.invalid", runtimeVersion: c.runtimeVersion, modelDigest: c.modelDigest,
      engineIdentity: `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`, engineArtifactDigest: `sha256:${c.engineArchiveDigest}`,
      engineSourceCommit: "72874f5" as const, templateDigest: c.templateDigest, configDigest: "a".repeat(64) },
    nativeRuntime: { schemaVersion: 2 as const, catalogDigest: reassessmentNativeCatalogDigest(), observationDigest: "a".repeat(64), spendAwareBudgetClass: "balanced" as const } };
  const qualification: QualifiedReassessmentExecution = { ...unsigned, qualificationDigest: createHash("sha256").update(canonicalJson(unsigned)).digest("hex") };
  const persistedInput = { taskRunRecordId: f.row.id, taskRunId: f.row.taskRunId, userId: f.row.userId, agentId: f.row.currentAgentId,
    requestDigest: hooks.requestDigest, binding: f.input.parsed.initiativeReviewBinding, executionFence: captureTaskExecutionFence(f.row.progressPayload, hooks.requestDigest),
    a2aMetadata: f.row.a2aMetadata, progressPayload: f.row.progressPayload };
  const database = { $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(f.tx) } as unknown as ReassessmentCaptureDatabase;
  return { ...f, predecessors, oldProgress, database, sealInput: { persistedInput, parsed: f.input.parsed, proof: f.input.proof,
    originals: f.input.originals, qualification, authorityDecisionId: f.input.authorityDecisionId } };
}
describe("atomic present reassessment allocation", () => {
  it("joins the existing exact requirement across families instead of allocating again", async () => {
    const f = fixture(); lineage.rows.push({ id: "existing", taskRunId: "TR-other-family", requestDigest: "f".repeat(64), binding: f.input.parsed.initiativeReviewBinding });
    const hooks = createPresentReassessmentAdmission(f.input, { validateAuthority: f.validateAuthority });
    await expect(hooks.admissionGuard(f.tx)).rejects.toMatchObject({ code: "reassessment-existing-assessment", taskRunId: "TR-other-family" });
    expect(f.artifacts).toHaveLength(0);
  });
  it("refuses an exhausted two-assessment policy regardless of terminal state", async () => {
    const f = fixture(); for (let i = 0; i < 2; i++) lineage.rows.push({ id: `existing-${i}`, taskRunId: `TR-existing-${i}`, status: "canceled",
      requestDigest: "f".repeat(64), binding: { ...f.input.parsed.initiativeReviewBinding!, gate: "spec-approval" } });
    await expect(createPresentReassessmentAdmission(f.input, { validateAuthority: f.validateAuthority }).admissionGuard(f.tx)).rejects.toThrow(/limit|exhausted/i);
  });
  it("requires the same transaction's successful guard before writing a root", async () => {
    const f = fixture(); const hooks = createPresentReassessmentAdmission(f.input, { validateAuthority: f.validateAuthority });
    await expect(hooks.afterTaskCreated(f.tx, f.row)).rejects.toThrow(); expect(f.artifacts).toHaveLength(0);
  });
  it("commits one Q root, immutable marker and complete initial message through existing owners", async () => {
    const f = fixture(), hooks = createPresentReassessmentAdmission(f.input, { validateAuthority: f.validateAuthority });
    await hooks.admissionGuard(f.tx); await hooks.afterTaskCreated(f.tx, f.row);
    expect(f.validateAuthority).toHaveBeenCalled(); expect(f.artifacts).toHaveLength(1); expect(f.messages).toHaveLength(1);
    expect(f.row.a2aMetadata).toMatchObject({ reassessmentExecution: { schemaVersion: 2 } });
    expect(JSON.stringify(f.artifacts)).toContain("reassessment-qualification-root-v2");
    expect(f.messages[0]).toMatchObject({ taskRunId: f.row.id, role: "user", parts: [{ type: "message", text: f.input.parsed.prompt }] });
  });
  it("adds a seal without changing the root locator or historical uncertainty, counters and limits", async () => {
    const f = await sealingFixture(), prior = structuredClone(f.row.a2aMetadata);
    const seal = await sealPresentReassessmentExecution(f.sealInput, { database: f.database, validateAuthority: f.validateAuthority });
    expect(seal.schemaVersion).toBe(2); expect(f.row.a2aMetadata).toEqual(prior); expect(f.messages).toHaveLength(1);
    expect(f.artifacts.filter(row => row.name === "reassessment-execution-seal-v2")).toHaveLength(1);
    expect(f.predecessors[0]!.progressPayload).toMatchObject({ ...f.oldProgress, reassessmentQuarantine: { replayAllowed: false } });
    expect(f.predecessors[1]!.progressPayload).toEqual(f.oldProgress);
  });
  it("keeps the other authorized current assessment active while sealing this requirement", async () => {
    const f = await sealingFixture(); const other = { id: "other-current", taskRunId: "TR-other-current", requestDigest: "b".repeat(64), status: "working",
      progressPayload: { savedCounters: 7 }, binding: { ...f.input.parsed.initiativeReviewBinding!, gate: "spec-approval" } };
    lineage.rows.push(other);
    await sealPresentReassessmentExecution(f.sealInput, { database: f.database, validateAuthority: f.validateAuthority });
    expect(other.status).toBe("working"); expect(other.progressPayload).toEqual({ savedCounters: 7 });
    expect(f.artifacts.some(row => row.taskRunId === other.id)).toBe(false);
  });
  it.each(["authority", "prefix", "catalog", "fence"])("refuses sealing on %s before any seal or quarantine", async condition => {
    const f = await sealingFixture();
    if (condition === "authority") f.validateAuthority.mockRejectedValue(new Error("genuine receipt already committed"));
    if (condition === "prefix") prefix.read.mockRejectedValue(new Error("incomplete persisted prefix"));
    if (condition === "catalog") f.sealInput.qualification.nativeRuntime!.catalogDigest = "f".repeat(64);
    if (condition === "fence") f.sealInput.persistedInput.executionFence = { ...f.sealInput.persistedInput.executionFence!, reservation: "displaced" };
    await expect(sealPresentReassessmentExecution(f.sealInput, { database: f.database, validateAuthority: f.validateAuthority })).rejects.toThrow();
    expect(f.artifacts).toHaveLength(1); expect(f.predecessors[0]!.progressPayload).toEqual(f.oldProgress);
  });
});
