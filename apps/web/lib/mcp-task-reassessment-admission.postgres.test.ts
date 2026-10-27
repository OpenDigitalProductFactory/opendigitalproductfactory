import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../test-support/review-postgres-fixture";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import { reassessmentPolicyDigest } from "./mcp-task-reassessment-policy";
import { lockInitiativeReviewCreationSubject, type ApprovedReassessmentPolicy, type AuthorizedReassessmentOriginal } from "./mcp-task-review-reassessment";
import { createPresentReassessmentAdmission, sealPresentReassessmentExecution, type PresentReassessmentAdmissionInput } from "./mcp-task-reassessment-admission";
import { withPersistedReassessmentQualification, type PersistedReassessmentExecutionInput } from "./mcp-task-reassessment-capture";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";
import { promoteReassessmentExecution, runReassessmentQualificationRequest, runReassessmentEffect,
  withReassessmentTokenReservation, reassessmentTokenReservationFor } from "./routing/reassessment-execution-scope";
import type { QualifiedReassessmentExecution } from "./routing/reassessment-phase-contract";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "./shared/reassessment-native-composition";

// Synthetic requests exercise production SQL owners and hooks. Only the shared
// governed runner supplies this URL; no native/provider/parent assessment runs.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_admission_${randomUUID().replaceAll("-", "")}`;
const tables = ["BacklogItem", "TaskRun", "TaskMessage", "WorkCapsule", "TaskArtifact", "ToolExecution"];
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo", path: "design.md", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) };
const workroomRef = { kind: "workroom-head" as const, workroomId: "WC-ADMISSION-FIXTURE", repositoryFullName: artifactRef.repositoryFullName, branchName: "codex/fixture", headSha: artifactRef.commitSha };
const progress = { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" }, attempt: 1, savedCeiling: 50_000 };

describe.skipIf(!url)("atomic production reassessment hooks on PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    for (const table of ["TaskArtifact", "TaskMessage", "TaskRun"]) await fixture.pool.query(`DROP TRIGGER IF EXISTS "admission_failure" ON "${table}"`);
    await fixture.pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
  });
  function packet(gate: "design-spec" | "spec-approval", presentReassessment?: unknown) {
    const binding = parseInitiativeReviewBinding({ itemId: "BI-285EF102", gate, writerToolName: "record_initiative_design_review", expectedCurrentBaselineId: null,
      artifactRef, workroomRef, ...(presentReassessment ? { presentReassessment } : {}) })!;
    const key = presentReassessment ? `review-reassessment-v1-${hash({ itemId: binding.itemId, gate, artifactRef, present: binding.presentReassessment })}` : `fixture-original-${gate}`;
    const parsed = parseRemoteTaskSubmitParams({ agentId: "reviewer", routeContext: "/build", title: "Synthetic exact assessment",
      objective: "Synthetic exact assessment only", prompt: "Synthetic exact assessment only", riskClass: "bounded-write", idempotencyKey: key,
      initiativeReviewBinding: binding, authorityScope: ["backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"] });
    if (typeof parsed === "string") throw new Error(parsed); return parsed;
  }
  async function setup() {
    await fixture.db.backlogItem.createMany({ data: [{ id: "fixture-subject", itemId: "BI-285EF102", title: "Synthetic subject", status: "open", type: "product", workType: "feature", scopeKind: "platform" },
      { id: "fixture-authorization", itemId: "BI-7906C73E", title: "Synthetic authorization", status: "open", type: "product", workType: "feature", scopeKind: "platform" }] });
    const originals: AuthorizedReassessmentOriginal[] = [];
    for (const gate of ["design-spec", "spec-approval"] as const) {
      const parsed = packet(gate), requestDigest = remoteTaskRequestDigest(parsed), taskRunId = `TR-fixture-original-${gate}`;
      const row = await fixture.db.taskRun.create({ data: { taskRunId, userId: "fixture-owner", currentAgentId: parsed.agentId,
        title: parsed.title, objective: parsed.objective, routeContext: parsed.routeContext, status: "input-required", authorityScope: json(parsed.authorityScope),
        progressPayload: json(progress), a2aMetadata: json({ trigger: "external-mcp", requestDigestVersion: 2, requestDigest, requestedAgentId: parsed.agentId,
          idempotencyKey: parsed.idempotencyKey, requestObjective: parsed.objective, riskClass: parsed.riskClass, initiativeReviewBinding: parsed.initiativeReviewBinding }) } });
      await fixture.db.taskMessage.create({ data: { id: randomUUID(), messageId: randomUUID(), taskRunId: row.id, role: "user", parts: json([{ type: "message", text: parsed.prompt }]) } });
      originals.push({ gate, taskRunId, requestDigest, readback: { schemaVersion: 1, taskRunId, classification: "unknown", readOnly: true, replayAllowed: false,
        bounded: true, reason: "Synthetic unknown history", observations: [], missingProof: ["settlement"], binding: { requestDigest, checkpointUpdatedAt: row.updatedAt.toISOString(),
          attempt: 1, dispatchAttempt: 1, writerAttempt: 1, reviewerAgentId: parsed.agentId, itemId: "BI-285EF102", gate, writerToolName: "record_initiative_design_review", artifactRef, workroomId: workroomRef.workroomId } } });
    }
    const policy: ApprovedReassessmentPolicy["policy"] = { schemaVersion: 1, subjectItemId: "BI-285EF102", maxAssessments: 2, historicalConsumption: "retain-unknown",
      currentLimits: "normal-recorded", originalReplay: false, operatorEvidenceActivityIds: ["synthetic-owner-evidence"],
      requirements: originals.map(original => ({ gate: original.gate, originalRequestDigest: original.requestDigest, maxAssessments: 1 })) };
    const proof: ApprovedReassessmentPolicy = { policy, policyDigest: reassessmentPolicyDigest(policy), baselineId: "baseline-fixture", artifactDigest: "sha256:" + "c".repeat(64),
      authorityArtifact: artifactRef, authorizationItemId: "BI-7906C73E", authorizationRowId: "fixture-authorization", subjectRowId: "fixture-subject" };
    return { originals, proof };
  }
  function inputFor(f: Awaited<ReturnType<typeof setup>>, taskRunId: string, gate: "design-spec" | "spec-approval" = "design-spec"): PresentReassessmentAdmissionInput {
    const original = f.originals.find(original => original.gate === gate)!;
    const parsed = packet(gate, { schemaVersion: 1, authorizationItemId: f.proof.authorizationItemId, baselineId: f.proof.baselineId, policyDigest: f.proof.policyDigest,
      originalTaskRunId: original.taskRunId, originalRequestDigest: original.requestDigest, predecessorTaskRunIds: [original.taskRunId], authorityArtifact: f.proof.authorityArtifact });
    const budget = reassessmentBudgetFixture(); budget.registryLimits.perTaskTokenLimit = 50_000; budget.executionConfigLimits.perTaskTokenLimit = 50_000; budget.configuredPerTaskLimit = 50_000;
    const { configurationDigest: _digest, ...unsigned } = budget; budget.configurationDigest = hash(unsigned);
    return { parsed, taskRunId, userId: "fixture-owner", actingAgentId: "fixture-author", authorityDecisionId: "fixture-normal-authority", ...f,
      candidate: { budgetConfiguration: budget, bounds: { maxProviderStarts: 20, maxDurationMs: 30_000, maxOutputTokens: 100 }, nativeObservationUrls: ["http://fixture.invalid/version"] },
      compatibility: { schemaVersion: 1, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
        owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) }, worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } } };
  }
  const authority = async () => {};
  async function admit(input: PresentReassessmentAdmissionInput) {
    const hooks = createPresentReassessmentAdmission(input, { validateAuthority: authority });
    await fixture.db.$transaction(async tx => {
      await hooks.admissionGuard(tx); await lockInitiativeReviewCreationSubject(tx, input.parsed.initiativeReviewBinding);
      const row = await tx.taskRun.create({ data: { taskRunId: input.taskRunId, userId: input.userId, currentAgentId: input.parsed.agentId,
        title: input.parsed.title, objective: input.parsed.objective, routeContext: input.parsed.routeContext, status: "working", threadId: "fixture-thread", contextId: "fixture-thread",
        authorityScope: json(input.parsed.authorityScope), a2aMetadata: json({ trigger: "external-mcp", requestDigestVersion: 2, requestDigest: hooks.requestDigest,
          requestedAgentId: input.parsed.agentId, idempotencyKey: input.parsed.idempotencyKey, riskClass: input.parsed.riskClass, requestObjective: input.parsed.objective,
          initiativeReviewBinding: input.parsed.initiativeReviewBinding }) } });
      await hooks.afterTaskCreated(tx, row);
    }, { timeout: 10_000 });
    const row = await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } });
    const persistedInput: PersistedReassessmentExecutionInput = { taskRunRecordId: row.id, taskRunId: row.taskRunId, userId: row.userId, agentId: input.parsed.agentId,
      requestDigest: hooks.requestDigest, binding: input.parsed.initiativeReviewBinding, executionFence: captureTaskExecutionFence(row.progressPayload, hooks.requestDigest),
      a2aMetadata: row.a2aMetadata, progressPayload: row.progressPayload };
    return { input, row, persistedInput };
  }
  function qualification(input: PresentReassessmentAdmissionInput): QualifiedReassessmentExecution {
    const c = REASSESSMENT_NATIVE_COMPOSITION;
    const unsigned = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const, providerId: "local", providerConnectionId: "fixture-connection",
      providerConnectionVersion: "9".repeat(64), modelId: "fixture-model", providerConfigurationDigest: "d".repeat(64), toolSurfaceDigest: "e".repeat(64),
      executionPlan: { providerId: "local", providerConnectionId: "fixture-connection", providerConnectionVersion: "9".repeat(64), modelId: "fixture-model", accountAuthMethod: "none", executionChannel: "local-runtime",
        recipeId: null, contractFamily: "review", executionAdapter: "chat", maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
      budgetConfiguration: input.candidate.budgetConfiguration, bounds: input.candidate.bounds,
      finiteTokenProof: { schemaVersion: 1 as const, kind: c.kind, apiRoot: "http://fixture.invalid", runtimeVersion: c.runtimeVersion, modelDigest: c.modelDigest,
        engineIdentity: `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`, engineArtifactDigest: `sha256:${c.engineArchiveDigest}`,
        engineSourceCommit: "72874f5" as const, templateDigest: c.templateDigest, configDigest: "f".repeat(64) },
      nativeRuntime: { schemaVersion: 2 as const, catalogDigest: reassessmentNativeCatalogDigest(), observationDigest: "a".repeat(64), spendAwareBudgetClass: "balanced" as const } };
    return { ...unsigned, qualificationDigest: hash(unsigned) };
  }
  async function seal(f: Awaited<ReturnType<typeof admit>>, execute?: () => Promise<void>) {
    return withPersistedReassessmentQualification(f.persistedInput, async () => {
      for (const url of f.input.candidate.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, async () => ({ bodyUtf8: "complete synthetic configuration" }));
      const result = await sealPresentReassessmentExecution({ persistedInput: f.persistedInput, parsed: f.input.parsed, proof: f.input.proof, originals: f.input.originals,
        qualification: qualification(f.input), authorityDecisionId: f.input.authorityDecisionId }, { database: fixture.db, validateAuthority: authority });
      if (execute) await promoteReassessmentExecution(execute); return result;
    }, { database: fixture.db, validateExecutionAuthority: authority });
  }

  it("atomically creates one root marker, initial null fence and complete immutable user message", async () => {
    const f = await admit(inputFor(await setup(), "TR-fixture-present"));
    expect(f.persistedInput.executionFence).toMatchObject({ reservation: null, dispatchClaim: null, authorityDigest: null });
    expect(f.row.a2aMetadata).toMatchObject({ reassessmentExecution: { schemaVersion: 2 } });
    expect(await fixture.db.taskArtifact.count({ where: { name: "reassessment-qualification-root-v2" } })).toBe(1);
    expect(await fixture.db.taskMessage.count({ where: { taskRunId: f.row.id } })).toBe(1);
  });
  it("allows only one concurrent cross-family allocation and joins it after refreshed retry", async () => {
    const f = await setup(), left = inputFor(f, "TR-fixture-family-left"), right = inputFor(f, "TR-fixture-family-right");
    const results = await Promise.allSettled([admit(left), admit(right)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = results[0]!.status === "rejected" ? left : right;
    await expect(admit(loser)).rejects.toMatchObject({ code: "reassessment-existing-assessment" });
    expect(await fixture.db.taskRun.count()).toBe(3); expect(await fixture.db.taskArtifact.count()).toBe(1); expect(await fixture.db.toolExecution.count()).toBe(0);
  });
  it.each(["TaskArtifact", "TaskMessage"])("rolls back every allocation byte when %s persistence fails", async table => {
    const f = await setup();
    await fixture.pool.query(`CREATE OR REPLACE FUNCTION admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic atomic admission failure'; END $$`);
    await fixture.pool.query(`CREATE TRIGGER "admission_failure" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION admission_failure()`);
    await expect(admit(inputFor(f, "TR-fixture-rollback"))).rejects.toThrow(/synthetic atomic admission failure/);
    expect(await fixture.db.taskRun.count()).toBe(2); expect(await fixture.db.taskMessage.count()).toBe(2); expect(await fixture.db.taskArtifact.count()).toBe(0);
  });
  it("seals the complete mirrored Q prefix and preserves every original unknown limit and attempt", async () => {
    const output = { status: 200, headers: [["content-type", "application/json"]], bodyUtf8: JSON.stringify({ content: "Complete synthetic generation response." }) };
    const f = await admit(inputFor(await setup(), "TR-fixture-finite")), effect = vi.fn(async () => output), prior = json(f.row.a2aMetadata);
    await seal(f, async () => {
      expect(await withReassessmentTokenReservation({ bodyUtf8: "synthetic-body", inputTokens: 100, maxOutputTokens: 100 },
        () => runReassessmentEffect({ kind: "provider", name: "synthetic-generation", input: { operation: "generation", bodyUtf8: "synthetic-body", tokenReservation: reassessmentTokenReservationFor("synthetic-body") } }, effect))).toEqual(output);
    });
    expect(effect).toHaveBeenCalledOnce(); expect(await fixture.db.taskRun.count()).toBe(3);
    expect((await fixture.db.taskRun.findUniqueOrThrow({ where: { id: f.row.id } })).a2aMetadata).toEqual(prior);
    const original = await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: f.input.originals[0]!.taskRunId } });
    expect(original.progressPayload).toMatchObject({ ...progress, reassessmentQuarantine: { replayAllowed: false } });
    expect(await fixture.db.taskArtifact.count({ where: { name: "reassessment-execution-seal-v2" } })).toBe(1);
    expect(await fixture.db.toolExecution.count()).toBe(2);
    const executions = await fixture.db.toolExecution.findMany({ where: { taskRunId: f.row.taskRunId, toolName: "reassessment_capture",
      parameters: { path: ["event", "sequence"], equals: 2 } } });
    expect(executions).toHaveLength(1);
    expect(executions[0]!.success).toBe(true);
    expect(executions[0]!.result).toEqual({ executionStatus: "observed", output });
    const observations = await fixture.db.taskArtifact.findMany({ where: { taskRunId: f.row.id, name: "reassessment-effect-observed-v1" } });
    expect(observations).toHaveLength(2);
    expect(observations.map(row => row.parts)).toContainEqual([{ type: "reassessment-effect-observed-v1", mimeType: "application/json", data: {
      event: (executions[0]!.parameters as { event: unknown }).event, reservation: { reservationId: executions[0]!.id }, output } }]);
  });
  it("seals the other requirement without holding an already allocated current assessment", async () => {
    const original = await setup(), first = await admit(inputFor(original, "TR-fixture-design-current")), second = await admit(inputFor(original, "TR-fixture-approval-current", "spec-approval"));
    await seal(second);
    const unchanged = await fixture.db.taskRun.findUniqueOrThrow({ where: { id: first.row.id } });
    expect(unchanged.status).toBe("working"); expect(unchanged.progressPayload).toEqual(first.row.progressPayload); expect(unchanged.a2aMetadata).toEqual(first.row.a2aMetadata);
  });
  it("rolls back seal and quarantine together without refunding the already allocated root", async () => {
    const f = await admit(inputFor(await setup(), "TR-fixture-seal-rollback"));
    await fixture.pool.query(`CREATE OR REPLACE FUNCTION admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic quarantine failure'; END $$`);
    await fixture.pool.query('CREATE TRIGGER "admission_failure" BEFORE UPDATE ON "TaskRun" FOR EACH ROW EXECUTE FUNCTION admission_failure()');
    await expect(seal(f)).rejects.toThrow(/synthetic quarantine failure/);
    expect(await fixture.db.taskArtifact.count({ where: { name: "reassessment-execution-seal-v2" } })).toBe(0);
    expect(await fixture.db.taskArtifact.count({ where: { name: "reassessment-predecessor-quarantine-v2" } })).toBe(0);
    expect(await fixture.db.taskRun.count()).toBe(3); expect(await fixture.db.toolExecution.count()).toBe(1);
    expect((await fixture.db.taskRun.findUniqueOrThrow({ where: { taskRunId: f.input.originals[0]!.taskRunId } })).progressPayload).toEqual(progress);
  });
});
