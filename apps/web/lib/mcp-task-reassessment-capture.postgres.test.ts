import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../test-support/review-postgres-fixture";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";
import {
  reassessmentExecutionManifestDigest, withPersistedReassessmentExecution, withPersistedReassessmentQualification,
  readPersistedReassessmentQualificationPrefix,
  type PersistedReassessmentExecutionInput,
} from "./mcp-task-reassessment-capture";
import { getReassessmentQualificationPrefix, promoteReassessmentExecution, runReassessmentEffect, runReassessmentQualificationRequest,
  validateReassessmentCommitBoundary, type ReassessmentExecutionManifest } from "./routing/reassessment-execution-scope";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "./shared/reassessment-native-composition";
import { deriveReassessmentExecutionSealArtifactId, type ReassessmentExecutionSealV2, type ReassessmentQualificationManifestV2,
  type ReassessmentQualificationPrefix } from "./routing/reassessment-phase-contract";

// Only a governed shared SQL slot may supply this URL. There is deliberately no
// general DATABASE_URL fallback and no provider, account or real review task.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_capture_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "TaskArtifact", "ToolExecution"];
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
const effect = (name: string) => ({ kind: "provider" as const, name, input: { synthetic: true, body: "complete fixture body" } });

describe.skipIf(!url)("restricted capture transactions on PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    await fixture.pool.query('DROP TRIGGER IF EXISTS "capture_failure" ON "ToolExecution"');
    await fixture.pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
  });

  async function admittedFixture() {
    const now = new Date();
    const progress = { resumeReservedAt: "fixture-reservation", dispatch: { claimedAt: "fixture-dispatch" } };
    const requestDigest = "a".repeat(64);
    const executionFence = captureTaskExecutionFence(progress, requestDigest)!;
    const manifest: ReassessmentExecutionManifest = {
      schemaVersion: 1, taskRunId: "TR-CAPTURE-SQL-FIXTURE", userId: "fixture-user", agentId: "fixture-reviewer", requestDigest,
      executionFence,
      binding: { itemId: "BI-CAPTURE-SQL-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
        expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repository",
          commitSha: "b".repeat(40), providerBlobId: "c".repeat(40), path: "docs/superpowers/specs/capture-fixture.md" } },
      qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "fixture-provider",
        providerConnectionId: "fixture-connection", providerConnectionVersion: "fixture-version", modelId: "fixture-model",
        providerConfigurationDigest: "d".repeat(64), toolSurfaceDigest: "e".repeat(64), qualificationDigest: "f".repeat(64),
        executionPlan: { providerId: "fixture-provider", modelId: "fixture-model", recipeId: null, contractFamily: "review",
          executionAdapter: "chat", maxTokens: 20, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
        budgetConfiguration: reassessmentBudgetFixture(), bounds: { maxProviderStarts: 2, maxDurationMs: 30_000, maxOutputTokens: 20 } },
      startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + 30_000).toISOString(),
    };
    const locator = { schemaVersion: 1, manifestArtifactId: "ta-capture-sql-fixture", manifestDigest: reassessmentExecutionManifestDigest(manifest) };
    const metadata = { trigger: "external-mcp", requestDigest, initiativeReviewBinding: manifest.binding, reassessmentExecution: locator };
    const row = await fixture.db.taskRun.create({ data: { taskRunId: manifest.taskRunId, userId: manifest.userId,
      currentAgentId: manifest.agentId, title: "Synthetic capture fixture", objective: "Verify capture transactions only",
      status: "working", threadId: "fixture-thread", progressPayload: progress, a2aMetadata: asJson(metadata) } });
    await fixture.db.taskArtifact.create({ data: { id: randomUUID(), artifactId: locator.manifestArtifactId, taskRunId: row.id, name: "fixture-manifest",
      parts: asJson([{ type: "reassessment-execution-manifest-v1", data: manifest }]) } });
    const input: PersistedReassessmentExecutionInput = { taskRunRecordId: row.id, taskRunId: row.taskRunId, userId: manifest.userId,
      agentId: manifest.agentId, binding: manifest.binding, requestDigest, executionFence, a2aMetadata: metadata, progressPayload: progress };
    return { input, manifest, progress, metadata };
  }
  const run = <T>(input: PersistedReassessmentExecutionInput, callback: () => Promise<T>) =>
    withPersistedReassessmentExecution(input, callback, { database: fixture.db });
  const artifacts = (name: string) => fixture.db.taskArtifact.findMany({ where: { name } });

  async function qualificationFixture() {
    const f = await admittedFixture(), { qualification: _qualification, schemaVersion: _version, ...identity } = f.manifest;
    const root: ReassessmentQualificationManifestV2 = { ...identity, schemaVersion: 2, phase: "qualification",
      compatibility: { schemaVersion: 1, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
        owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
          worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } },
      budgetConfiguration: reassessmentBudgetFixture({ agentId: f.input.agentId, registryAgentId: f.input.agentId, registryAgentName: f.input.agentId }),
      bounds: { maxProviderStarts: 4, maxDurationMs: 30_000, maxOutputTokens: 20 },
      nativeObservationUrls: ["http://fixture.invalid/version", "http://fixture.invalid/engines/status"] };
    const locator = { schemaVersion: 2 as const, manifestArtifactId: "ta-capture-qualification-sql-fixture", manifestDigest: hash(root) };
    const metadata = { ...f.metadata, reassessmentExecution: locator };
    await fixture.db.taskRun.update({ where: { taskRunId: f.input.taskRunId }, data: { a2aMetadata: asJson(metadata) } });
    await fixture.db.taskArtifact.create({ data: { id: randomUUID(), artifactId: locator.manifestArtifactId, taskRunId: f.input.taskRunRecordId,
      name: "reassessment-qualification-root-v2", producerAgentId: f.input.agentId,
      parts: asJson([{ type: "reassessment-qualification-root-v2", data: root }]) } });
    return { ...f, root, locator, input: { ...f.input, a2aMetadata: metadata } };
  }
  type QualificationFixture = Awaited<ReturnType<typeof qualificationFixture>>;
  const qualify = <T>(f: QualificationFixture, callback: () => Promise<T>,
    validateExecutionAuthority: (tx: Prisma.TransactionClient, root: ReassessmentQualificationManifestV2, seal: ReassessmentExecutionSealV2) => Promise<void> = async () => {}) =>
    withPersistedReassessmentQualification(f.input, callback, { database: fixture.db, validateExecutionAuthority });
  async function observeQualification(f: QualificationFixture) {
    for (const url of f.root.nativeObservationUrls) {
      await runReassessmentQualificationRequest({ method: "GET", url }, async () => ({ url, body: "complete synthetic observation" }));
    }
    return getReassessmentQualificationPrefix();
  }
  const readPrefix = (f: QualificationFixture) => fixture.db.$transaction(tx =>
    readPersistedReassessmentQualificationPrefix(tx, f.input, f.locator, { requireSealAbsent: true }));
  function syntheticSeal(f: QualificationFixture, prefix: ReassessmentQualificationPrefix): ReassessmentExecutionSealV2 {
    const qualification = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const,
      providerId: "fixture-provider", providerConnectionId: "fixture-connection", providerConnectionVersion: "7".repeat(64), modelId: "fixture-model",
      providerConfigurationDigest: "d".repeat(64), toolSurfaceDigest: "e".repeat(64), budgetConfiguration: f.root.budgetConfiguration, bounds: f.root.bounds,
      executionPlan: { providerId: "fixture-provider", providerConnectionId: "fixture-connection", providerConnectionVersion: "7".repeat(64),
        modelId: "fixture-model", accountAuthMethod: "none", executionChannel: "direct-api", recipeId: null, contractFamily: "review",
        executionAdapter: "chat", maxTokens: 20, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
      nativeRuntime: { schemaVersion: 2 as const, catalogDigest: "8".repeat(64), observationDigest: prefix.digest, spendAwareBudgetClass: "balanced" as const } };
    return { schemaVersion: 2, root: f.locator, taskRunId: f.root.taskRunId, userId: f.root.userId, agentId: f.root.agentId,
      requestDigest: f.root.requestDigest, executionFence: f.root.executionFence, binding: f.root.binding, qualificationPrefix: prefix,
      qualification: { ...qualification, qualificationDigest: hash(qualification) }, authorityDecisionId: "synthetic-authority", sealedAt: new Date().toISOString() };
  }
  async function storeSeal(tx: Prisma.TransactionClient, f: QualificationFixture, prefix: ReassessmentQualificationPrefix) {
    const seal = syntheticSeal(f, prefix);
    const artifactId = deriveReassessmentExecutionSealArtifactId({ taskRunId: f.input.taskRunId,
      rootArtifactId: f.locator.manifestArtifactId, rootDigest: f.locator.manifestDigest });
    await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId, taskRunId: f.input.taskRunRecordId,
      name: "reassessment-execution-seal-v2", producerAgentId: f.input.agentId,
      parts: asJson([{ type: "reassessment-execution-seal-v2", data: seal }]) } });
    return { artifactId, seal };
  }
  async function sealCompletedPrefix(f: QualificationFixture, prefix: ReassessmentQualificationPrefix) {
    // Synthetic test producer only. Native qualification and R3 authority issuance remain outside this suite.
    return fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${f.input.taskRunId} FOR UPDATE`;
      expect(await readPersistedReassessmentQualificationPrefix(tx, f.input, f.locator, { requireSealAbsent: true })).toEqual(prefix);
      return storeSeal(tx, f, prefix);
    });
  }

  async function failOwner(operation: "INSERT" | "UPDATE") {
    await fixture.pool.query(`CREATE OR REPLACE FUNCTION capture_fail_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic second-owner failure'; END $$`);
    await fixture.pool.query(`CREATE TRIGGER "capture_failure" BEFORE ${operation} ON "ToolExecution"
      FOR EACH ROW EXECUTE FUNCTION capture_fail_owner()`);
  }
  async function waitForTaskLock() {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const waiting = await fixture.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",
        [schema, '%FROM "TaskRun"%FOR UPDATE%']);
      if (waiting.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The production capture reservation did not reach its actual PostgreSQL TaskRun lock.");
  }

  it("promotes a complete mirrored Q prefix through its persisted seal and reserves E without reopening capture", async () => {
    const f = await qualificationFixture(); const io = vi.fn(async () => "complete synthetic execution output");
    const validate = vi.fn(async (_tx: Prisma.TransactionClient, root: ReassessmentQualificationManifestV2, seal: ReassessmentExecutionSealV2) => {
      expect(root.taskRunId).toBe(f.input.taskRunId); expect(seal.authorityDecisionId).toBe("synthetic-authority");
      expect(seal.root).toEqual(f.locator); expect(seal.qualification.nativeRuntime?.observationDigest).toBe(seal.qualificationPrefix.digest);
    });
    await qualify(f, async () => {
      const prefix = await observeQualification(f);
      expect(prefix).toMatchObject({ eventCount: 2, providerReservations: 2, providerStarts: 2 });
      expect(await readPrefix(f)).toEqual(prefix);
      await sealCompletedPrefix(f, prefix);
      await expect(promoteReassessmentExecution(() => runReassessmentEffect({ ...effect("fixture-E-generation"), input: { operation: "generation", synthetic: true } }, io)))
        .resolves.toBe("complete synthetic execution output");
    }, validate);
    expect(io).toHaveBeenCalledOnce(); expect(validate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const executions = await fixture.db.toolExecution.findMany();
    expect(executions).toHaveLength(3);
    expect(executions.map(row => (row.parameters as { event: { sequence: number } }).event.sequence).sort()).toEqual([1, 2, 3]);
    for (const row of executions) expect(row).toMatchObject({ success: true, parameters: { schemaVersion: 2,
      manifestArtifactId: f.locator.manifestArtifactId, manifestDigest: f.locator.manifestDigest } });
    const reservations = await artifacts("reassessment-effect-reservation-v1");
    expect(reservations).toHaveLength(3);
    for (const row of reservations) expect(row).toMatchObject({ metadata: { schemaVersion: 2 } });
    expect(await artifacts("reassessment-execution-open-v1")).toHaveLength(1);
    expect(await artifacts("reassessment-execution-seal-v2")).toHaveLength(1);
    expect(await artifacts("reassessment-execution-close-v1")).toMatchObject([{ parts: [{ data: { providerStarts: 3, providerReservations: 3, closed: true } }] }]);
  });

  it.each(["current", "revoked", "changed-seal"])("validates %s writer commit authority inside its supplied SQL transaction with E outstanding", async condition => {
    const f = await qualificationFixture(); let committing = false, writerTx: Prisma.TransactionClient | undefined;
    const validate = vi.fn(async (tx: Prisma.TransactionClient) => {
      if (committing) {
        expect(tx).toBe(writerTx);
        if (condition === "revoked") throw new Error("Synthetic current authority revoked.");
      }
    });
    await qualify(f, async () => {
      const prefix = await observeQualification(f), stored = await sealCompletedPrefix(f, prefix);
      // Synthetic catalog-shaped data exercises capture/commit wiring only;
      // no native runtime, inference or actual parent assessment is qualified.
      const seal = stored.seal, q = seal.qualification, c = REASSESSMENT_NATIVE_COMPOSITION;
      q.providerId = "local"; q.executionPlan.providerId = "local"; q.executionPlan.executionChannel = "local-runtime";
      q.nativeRuntime!.catalogDigest = reassessmentNativeCatalogDigest();
      q.finiteTokenProof = { schemaVersion: 1, kind: c.kind, apiRoot: "http://fixture.invalid", runtimeVersion: c.runtimeVersion,
        modelDigest: c.modelDigest, engineIdentity: `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`,
        engineArtifactDigest: `sha256:${c.engineArchiveDigest}`, engineSourceCommit: "72874f5", templateDigest: c.templateDigest, configDigest: "a".repeat(64) };
      const { qualificationDigest: _old, ...unsigned } = q; q.qualificationDigest = hash(unsigned);
      await fixture.db.taskArtifact.update({ where: { artifactId: stored.artifactId }, data: {
        parts: asJson([{ type: "reassessment-execution-seal-v2", data: seal }]),
      } });
      await promoteReassessmentExecution(() => runReassessmentEffect({ kind: "tool", name: f.root.binding.writerToolName, input: {} }, async () => {
        if (condition === "changed-seal") {
          await fixture.db.taskArtifact.update({ where: { artifactId: stored.artifactId }, data: {
            parts: asJson([{ type: "reassessment-execution-seal-v2", data: { ...seal, authorityDecisionId: "changed-authority" } }]),
          } });
        }
        await fixture.db.$transaction(async tx => {
          writerTx = tx; committing = true;
          await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${f.input.taskRunId} FOR SHARE`;
          const check = validateReassessmentCommitBoundary(tx, f.input);
          if (condition === "current") {
            await expect(check).resolves.toBeUndefined();
            await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: "ta-synthetic-publication", taskRunId: f.input.taskRunRecordId,
              name: "synthetic-publication", parts: asJson([{ type: "test-only", data: { actualReceipt: false } }]) } });
          } else await expect(check).rejects.toThrow(/commit-authority/);
        });
        return { syntheticOutcome: true };
      }));
    }, validate);
    expect(await artifacts("synthetic-publication")).toHaveLength(condition === "current" ? 1 : 0);
    expect(validate).toHaveBeenCalledTimes(condition === "changed-seal" ? 2 : 3);
    expect(await fixture.db.toolExecution.count({ where: { success: false } })).toBe(0);
  });

  it("refuses an old Q reservation if its derived seal appears after capture opens", async () => {
    const f = await qualificationFixture(); const io = vi.fn(async () => "never");
    await qualify(f, async () => {
      // Deliberately unapproved early seal: any deterministic seal presence must exclude Q.
      await fixture.db.$transaction(tx => storeSeal(tx, f, { eventCount: 0, digest: hash([]), providerReservations: 0, providerStarts: 0 }));
      await expect(runReassessmentQualificationRequest({ method: "GET", url: f.root.nativeObservationUrls[0]! }, io))
        .rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
      await expect(readPrefix(f)).rejects.toThrow(/seal|prefix|capture|qualification/i);
    });
    expect(io).not.toHaveBeenCalled(); expect(await fixture.db.toolExecution.count()).toBe(0);
    expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(0);
  });

  it.each(["missing-artifact", "missing-execution", "empty-mirrors", "unknown-execution", "mirrored-output", "mirrored-event", "changed-producer"] as const)
    ("refuses a persisted Q prefix with %s instead of deriving a seal", async change => {
      const f = await qualificationFixture();
      await qualify(f, async () => {
        await observeQualification(f);
        const execution = (await fixture.db.toolExecution.findFirst())!;
        const observed = (await artifacts("reassessment-effect-observed-v1"))[0]!;
        if (change === "missing-artifact") await fixture.db.taskArtifact.delete({ where: { artifactId: observed.artifactId } });
        if (change === "missing-execution") await fixture.db.toolExecution.delete({ where: { id: execution.id } });
        if (change === "empty-mirrors") {
          await fixture.db.toolExecution.deleteMany();
          await fixture.db.taskArtifact.deleteMany({ where: { name: { in: ["reassessment-effect-reservation-v1", "reassessment-effect-observed-v1"] } } });
        }
        if (change === "unknown-execution") await fixture.db.toolExecution.update({ where: { id: execution.id },
          data: { success: false, result: asJson({ executionStatus: "reserved", consumption: "unknown-until-observed" }) } });
        if (change === "mirrored-output") await fixture.db.toolExecution.update({ where: { id: execution.id },
          data: { result: asJson({ executionStatus: "observed", output: { changed: "only the ToolExecution mirror" } }) } });
        if (change === "mirrored-event") {
          const parameters = JSON.parse(JSON.stringify(execution.parameters)) as { event: { name: string } };
          parameters.event.name = "changed-only-one-owner";
          await fixture.db.toolExecution.update({ where: { id: execution.id }, data: { parameters: asJson(parameters) } });
        }
        if (change === "changed-producer") await fixture.db.taskArtifact.update({ where: { artifactId: observed.artifactId }, data: { producerAgentId: "other-agent" } });
        await expect(readPrefix(f)).rejects.toThrow(/prefix|ledger|capture|reservation|observation|mirror/i);
        expect(await artifacts("reassessment-execution-seal-v2")).toHaveLength(0);
      });
    });

  it("preserves an unknown started Q observation and refuses prefix derivation", async () => {
    const f = await qualificationFixture(); const io = vi.fn(async () => { throw new Error("synthetic response lost"); });
    await qualify(f, async () => {
      await expect(runReassessmentQualificationRequest({ method: "GET", url: f.root.nativeObservationUrls[0]! }, io))
        .rejects.toMatchObject({ code: "reassessment-capture-incomplete" });
      await expect(readPrefix(f)).rejects.toThrow(/prefix|ledger|capture|reservation|observation|mirror/i);
    });
    expect(io).toHaveBeenCalledOnce(); expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(1);
    expect(await artifacts("reassessment-effect-observed-v1")).toHaveLength(0);
    expect(await artifacts("reassessment-effect-uncertain-v1")).toHaveLength(1);
    expect(await fixture.db.toolExecution.findFirst()).toMatchObject({ success: false, result: { executionStatus: "reserved", consumption: "unknown-until-observed" } });
  });

  it.each(["seal", "authority"] as const)("rechecks persisted %s before the first E reservation", async change => {
    const f = await qualificationFixture(); const io = vi.fn(async () => "never"); let revoked = false;
    const validate = vi.fn(async () => { if (revoked) throw new Error("synthetic execution authority revoked"); });
    await qualify(f, async () => {
      const prefix = await observeQualification(f), stored = await sealCompletedPrefix(f, prefix);
      await promoteReassessmentExecution(async () => {
        if (change === "authority") revoked = true;
        else await fixture.db.taskArtifact.update({ where: { artifactId: stored.artifactId }, data: {
          parts: asJson([{ type: "reassessment-execution-seal-v2", data: { ...stored.seal, root: { ...f.locator, manifestDigest: "0".repeat(64) } } }]),
        } });
        await expect(runReassessmentEffect({ ...effect("fixture-E-after-change"), input: { operation: "generation", synthetic: true } }, io))
          .rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
      });
    }, validate);
    expect(io).not.toHaveBeenCalled(); expect(await fixture.db.toolExecution.count()).toBe(2);
    expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(2);
  });

  it("serializes a Q reservation behind a committed task hold with zero observation starts", async () => {
    const f = await qualificationFixture(); const io = vi.fn(async () => "never");
    await qualify(f, async () => {
      const blocker = await fixture.pool.connect(); let transactionOpen = true; let pending: Promise<string> | undefined;
      await blocker.query("BEGIN");
      try {
        await blocker.query('UPDATE "TaskRun" SET status=$1 WHERE "taskRunId"=$2', ["input-required", f.input.taskRunId]);
        pending = runReassessmentQualificationRequest({ method: "GET", url: f.root.nativeObservationUrls[0]! }, io);
        void pending.catch(() => undefined);
        await waitForTaskLock(); expect(io).not.toHaveBeenCalled();
        await blocker.query("COMMIT"); transactionOpen = false;
        await expect(pending).rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
      } finally {
        if (transactionOpen) await blocker.query("ROLLBACK");
        blocker.release(); await pending?.catch(() => undefined);
      }
    });
    expect(io).not.toHaveBeenCalled(); expect(await fixture.db.toolExecution.count()).toBe(0);
    expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(0);
  });

  it("commits both reservation owners before the synthetic effect and captures the full output", async () => {
    const { input } = await admittedFixture();
    const body = "full observed output ".repeat(2_000);
    const io = vi.fn(async () => {
      const [reserved, executions] = await Promise.all([artifacts("reassessment-effect-reservation-v1"), fixture.db.toolExecution.findMany()]);
      expect(reserved).toHaveLength(1); expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({ success: false, result: { executionStatus: "reserved", consumption: "unknown-until-observed" } });
      return { body };
    });
    await expect(run(input, () => runReassessmentEffect(effect("fixture-positive"), io))).resolves.toEqual({ body });
    expect(io).toHaveBeenCalledOnce();
    expect(await fixture.db.toolExecution.findFirst()).toMatchObject({ success: true, result: { executionStatus: "observed", output: { body } } });
    expect(JSON.stringify(await artifacts("reassessment-effect-observed-v1"))).toContain(body);
  });

  it("allows only one concurrent execution callback for the same persisted manifest", async () => {
    const { input } = await admittedFixture(); const io = vi.fn(async () => "synthetic output");
    const outcomes = await Promise.allSettled([run(input, () => runReassessmentEffect(effect("first-worker"), io)),
      run(input, () => runReassessmentEffect(effect("second-worker"), io))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(io).toHaveBeenCalledOnce(); expect(await artifacts("reassessment-execution-open-v1")).toHaveLength(1);
    expect(await fixture.db.toolExecution.count()).toBe(1);
  });

  it("rolls back the first reservation owner when inserting the second owner fails, with zero starts", async () => {
    const { input } = await admittedFixture(); const io = vi.fn(async () => "never");
    await failOwner("INSERT");
    await expect(run(input, () => runReassessmentEffect(effect("fixture-insert-failure"), io)))
      .rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
    expect(io).not.toHaveBeenCalled(); expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(0);
    expect(await fixture.db.toolExecution.count()).toBe(0);
  });

  it("retains the provider-start ceiling across committed effects without a third reservation", async () => {
    const { input } = await admittedFixture(); const io = vi.fn(async () => "synthetic output");
    await run(input, async () => {
      await runReassessmentEffect(effect("fixture-start-one"), io);
      await runReassessmentEffect(effect("fixture-start-two"), io);
      await expect(runReassessmentEffect(effect("fixture-start-three"), io))
        .rejects.toMatchObject({ code: "reassessment-provider-start-limit" });
    });
    expect(io).toHaveBeenCalledTimes(2); expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(2);
    expect(await fixture.db.toolExecution.count()).toBe(2);
  });

  it.each(["hold", "cancellation", "uncertainty", "reservation", "dispatch", "authority", "request"] as const)
    ("starts nothing when %s wins the real TaskRun lock", async change => {
      const f = await admittedFixture(); const io = vi.fn(async () => "never");
      await run(f.input, async () => {
        const blocker = await fixture.pool.connect(); let transactionOpen = true;
        let pending: Promise<string> | undefined;
        await blocker.query("BEGIN");
        try {
          const progress: Record<string, unknown> = { ...f.progress };
          if (change === "reservation") progress.resumeReservedAt = "displaced-reservation";
          if (change === "dispatch") progress.dispatch = { claimedAt: "displaced-dispatch" };
          if (change === "authority") progress.reviewExecutionAuthority = { schemaVersion: 1, tokenId: "displaced-authority" };
          if (change === "uncertainty") progress.executionUncertainty = { schemaVersion: 1, settlement: "unknown" };
          const status = change === "hold" ? "input-required" : change === "cancellation" ? "canceled" : "working";
          const metadata = change === "request" ? { ...f.metadata, requestDigest: "0".repeat(64) } : f.metadata;
          await blocker.query('UPDATE "TaskRun" SET status=$1,"progressPayload"=$2::jsonb,"a2aMetadata"=$3::jsonb WHERE "taskRunId"=$4',
            [status, JSON.stringify(progress), JSON.stringify(metadata), f.input.taskRunId]);
          pending = runReassessmentEffect(effect(`fixture-${change}`), io);
          void pending.catch(() => undefined);
          await waitForTaskLock(); expect(io).not.toHaveBeenCalled();
          await blocker.query("COMMIT"); transactionOpen = false;
          await expect(pending).rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
        } finally {
          if (transactionOpen) await blocker.query("ROLLBACK");
          blocker.release();
          await pending?.catch(() => undefined);
        }
      });
      expect(io).not.toHaveBeenCalled(); expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(0);
      expect(await fixture.db.toolExecution.count()).toBe(0);
    });

  it("retains a started reservation and its observation after cancellation, then refuses another effect", async () => {
    const { input } = await admittedFixture(); const io = vi.fn(async () => {
      expect(await fixture.db.toolExecution.count()).toBe(1);
      await fixture.db.taskRun.update({ where: { taskRunId: input.taskRunId }, data: { status: "canceled" } });
      return "observed before returning";
    });
    await run(input, async () => {
      await expect(runReassessmentEffect(effect("fixture-started"), io)).resolves.toBe("observed before returning");
      await expect(runReassessmentEffect(effect("fixture-after-cancel"), io)).rejects.toMatchObject({ code: "reassessment-capture-unavailable" });
    });
    expect(io).toHaveBeenCalledOnce(); expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(1);
    expect(await fixture.db.toolExecution.findFirst()).toMatchObject({ success: true, result: { executionStatus: "observed" } });
  });

  it("rolls back a partial observation, preserves unknown consumption and holds subsequent effects", async () => {
    const { input } = await admittedFixture(); const io = vi.fn(async () => "synthetic started effect");
    await failOwner("UPDATE");
    await run(input, async () => {
      await expect(runReassessmentEffect(effect("fixture-observation-failure"), io)).rejects.toMatchObject({ code: "reassessment-capture-incomplete" });
      await expect(runReassessmentEffect(effect("fixture-after-unknown"), io)).rejects.toMatchObject({ code: "reassessment-execution-held" });
    });
    expect(io).toHaveBeenCalledOnce(); expect(await artifacts("reassessment-effect-observed-v1")).toHaveLength(0);
    expect(await artifacts("reassessment-effect-reservation-v1")).toHaveLength(1);
    expect(await fixture.db.toolExecution.findFirst()).toMatchObject({ success: false,
      result: { executionStatus: "reserved", consumption: "unknown-until-observed" } });
    expect(JSON.stringify(await artifacts("reassessment-effect-uncertain-v1"))).toContain('"holdFurtherEffects":true');
  });
});
