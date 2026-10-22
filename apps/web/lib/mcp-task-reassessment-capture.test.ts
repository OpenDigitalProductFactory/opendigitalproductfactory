import { describe, expect, it, vi } from "vitest";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import {
  hasPersistedReassessmentExecution, reassessmentExecutionManifestDigest,
  withPersistedReassessmentExecution, type ReassessmentCaptureDatabase,
  type PersistedReassessmentExecutionInput,
} from "./mcp-task-reassessment-capture";
import { assertReassessmentToolCall, runReassessmentEffect, type ReassessmentExecutionManifest } from "./routing/reassessment-execution-scope";

function fixture() {
  const now = new Date();
  const manifest: ReassessmentExecutionManifest = {
    schemaVersion: 1, taskRunId: "TR-CAPTURE", userId: "user", agentId: "reviewer", requestDigest: "a".repeat(64),
    executionFence: { schemaVersion: 1, reservation: "reserved", dispatchClaim: "dispatched", authorityDigest: null, requestDigest: "a".repeat(64) },
    binding: { itemId: "BI-CAPTURE", gate: "design-spec", writerToolName: "record_initiative_design_review", expectedCurrentBaselineId: null,
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "b".repeat(40), path: "design.md", providerBlobId: "c".repeat(40) } },
    qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "local", providerConnectionId: "connection",
      providerConnectionVersion: "v1", modelId: "model", providerConfigurationDigest: "d".repeat(64), toolSurfaceDigest: "e".repeat(64), qualificationDigest: "f".repeat(64),
      executionPlan: { providerId: "local", modelId: "model", recipeId: null, contractFamily: "review", executionAdapter: "chat", maxTokens: 20,
        providerSettings: {}, toolPolicy: {}, responsePolicy: {} }, budgetConfiguration: reassessmentBudgetFixture(),
      bounds: { maxProviderStarts: 2, maxDurationMs: 30_000, maxOutputTokens: 20 } },
    startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  const locator = { schemaVersion: 1 as const, manifestArtifactId: "ta-manifest", manifestDigest: reassessmentExecutionManifestDigest(manifest) };
  const metadata = { trigger: "external-mcp", requestDigest: manifest.requestDigest, initiativeReviewBinding: manifest.binding, reassessmentExecution: locator };
  const row = { id: "task-record", taskRunId: manifest.taskRunId, userId: manifest.userId, currentAgentId: manifest.agentId,
    status: "working", threadId: "thread", a2aMetadata: metadata, progressPayload: { resumeReservedAt: "reserved", dispatch: { claimedAt: "dispatched" } } };
  const artifacts: Array<Record<string, unknown>> = [{ id: "manifest-row", artifactId: locator.manifestArtifactId, taskRunId: row.id,
    parts: [{ type: "reassessment-execution-manifest-v1", mimeType: "application/json", data: manifest }], metadata: {} }];
  const executions: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: vi.fn(async () => []), taskRun: { findUnique: vi.fn(async () => row) },
    taskArtifact: {
      findUnique: vi.fn(async ({ where }: { where: { artifactId: string } }) => artifacts.find(a => a.artifactId === where.artifactId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (artifacts.some(a => a.artifactId === data.artifactId)) throw new Error("duplicate sealed capture");
        artifacts.push(data); return data;
      }),
    },
    toolExecution: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { executions.push(data); return { id: `execution-${executions.length}` }; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = executions.find((_e, i) => `execution-${i + 1}` === where.id); if (!found) return { count: 0 };
        Object.assign(found, data); return { count: 1 };
      }),
    },
  };
  const database = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) } as unknown as ReassessmentCaptureDatabase;
  const input: PersistedReassessmentExecutionInput = { taskRunRecordId: row.id, taskRunId: row.taskRunId, userId: row.userId, agentId: row.currentAgentId,
    binding: manifest.binding, requestDigest: manifest.requestDigest, executionFence: manifest.executionFence, a2aMetadata: metadata, progressPayload: row.progressPayload };
  return { manifest, locator, row, input, artifacts, executions, tx, database };
}

describe("persisted reassessment capture", () => {
  it("persists immutable config and full reservations/results through existing owners before IO", async () => {
    const f = fixture(); const body = "full provider body ".repeat(2_000);
    const output = await withPersistedReassessmentExecution(f.input, async () => runReassessmentEffect({ kind: "provider", name: "http-post", input: { body } }, async () => {
      expect(f.executions).toHaveLength(1);
      expect(f.executions[0]).toMatchObject({ success: false, executionMode: "restricted-reassessment-capture", result: { executionStatus: "reserved" } });
      return { body, usage: { inputTokens: 20, outputTokens: 10 } };
    }), { database: f.database });
    expect(output.body).toBe(body);
    expect(f.executions[0]).toMatchObject({ success: true, taskRunId: "TR-CAPTURE", toolName: "reassessment_capture",
      result: { executionStatus: "observed", output } });
    const captured = JSON.stringify(f.artifacts);
    expect(captured).toContain(body);
    expect(captured).toContain("reassessment-execution-close-v1");
    expect(f.tx.$queryRaw).toHaveBeenCalled();
  });

  it.each(["missing-artifact", "changed-digest", "changed-binding", "changed-actor", "changed-generation", "cancelled", "malformed-marker"])("refuses %s without provider IO", async condition => {
    const f = fixture(); const io = vi.fn(async () => "never");
    if (condition === "missing-artifact") f.artifacts.length = 0;
    if (condition === "changed-digest") f.locator.manifestDigest = "0".repeat(64);
    if (condition === "changed-binding") f.row.a2aMetadata.initiativeReviewBinding = { ...f.manifest.binding, itemId: "BI-OTHER" };
    if (condition === "changed-actor") f.row.currentAgentId = "other";
    if (condition === "changed-generation") f.row.progressPayload.dispatch.claimedAt = "new-generation";
    if (condition === "cancelled") f.row.status = "canceled";
    if (condition === "malformed-marker") (f.input.a2aMetadata as Record<string, unknown>).reassessmentExecution = { ...f.locator, bypass: true };
    await expect(withPersistedReassessmentExecution(f.input, () => runReassessmentEffect({ kind: "provider", name: "http", input: {} }, io), { database: f.database })).rejects.toThrow();
    expect(io).not.toHaveBeenCalled(); expect(f.tx.toolExecution.create).not.toHaveBeenCalled();
  });

  it("rechecks task identity before each reservation and stops without a second provider start", async () => {
    const f = fixture(); const io = vi.fn(async () => "response");
    await withPersistedReassessmentExecution(f.input, async () => {
      await runReassessmentEffect({ kind: "provider", name: "first", input: {} }, io);
      f.row.progressPayload.dispatch.claimedAt = "displaced";
      await expect(runReassessmentEffect({ kind: "provider", name: "second", input: {} }, io)).rejects.toThrow();
    }, { database: f.database });
    expect(io).toHaveBeenCalledOnce();
  });

  it("prevents a second execution of the same persisted manifest even after the first returned", async () => {
    const f = fixture(); const io = vi.fn(async () => "response");
    await withPersistedReassessmentExecution(f.input, () => runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io), { database: f.database });
    await expect(withPersistedReassessmentExecution(f.input, () => runReassessmentEffect({ kind: "provider", name: "post", input: {} }, io), { database: f.database })).rejects.toThrow();
    expect(io).toHaveBeenCalledOnce();
  });

  it("keeps a genuine committed receipt after observation fails and leaves a durable consumed reservation", async () => {
    const f = fixture(); let genuineReceipt: string | null = null;
    f.tx.toolExecution.updateMany.mockRejectedValue(new Error("capture store offline"));
    await withPersistedReassessmentExecution(f.input, async () => {
      assertReassessmentToolCall({ toolName: f.manifest.binding.writerToolName, params: { decision: "pass" }, userId: f.input.userId,
        agentId: f.input.agentId, taskRunId: f.input.taskRunId, executionFence: f.input.executionFence });
      await expect(runReassessmentEffect({ kind: "tool", name: f.manifest.binding.writerToolName, input: { decision: "pass" } }, async () => {
        genuineReceipt = "persisted-domain-receipt"; f.row.status = "canceled"; return { success: true, receiptId: genuineReceipt };
      })).rejects.toThrow(/capture/i);
    }, { database: f.database });
    expect(genuineReceipt).toBe("persisted-domain-receipt");
    expect(f.executions[0]).toMatchObject({ result: { executionStatus: "reserved" }, success: false });
    expect(JSON.stringify(f.artifacts)).toContain("reassessment-effect-uncertain-v1");
  });

  it("cannot enable a scope through ordinary request payload and performs no DB work for ordinary tasks", async () => {
    const f = fixture();
    expect(hasPersistedReassessmentExecution({ request: { reassessmentExecution: f.locator } })).toBe(false);
    const result = await withPersistedReassessmentExecution({ ...f.input, a2aMetadata: { trigger: "external-mcp" } }, async () => "ordinary", { database: f.database });
    expect(result).toBe("ordinary"); expect(f.database.$transaction).not.toHaveBeenCalled();
    expect(hasPersistedReassessmentExecution({ reassessmentExecution: null })).toBe(true);
  });
});
