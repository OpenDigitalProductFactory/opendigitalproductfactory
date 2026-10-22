import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../test-support/review-postgres-fixture";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";
import {
  reassessmentExecutionManifestDigest, withPersistedReassessmentExecution,
  type PersistedReassessmentExecutionInput,
} from "./mcp-task-reassessment-capture";
import { runReassessmentEffect, type ReassessmentExecutionManifest } from "./routing/reassessment-execution-scope";

// Only a governed shared SQL slot may supply this URL. There is deliberately no
// general DATABASE_URL fallback and no provider, account or real review task.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_capture_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "TaskArtifact", "ToolExecution"];
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
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
