import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import {
  createReassessmentCaptureHooks, hasPersistedReassessmentExecution, reassessmentExecutionManifestDigest,
  withPersistedReassessmentExecution, type ReassessmentCaptureDatabase,
  type PersistedReassessmentExecutionInput,
} from "./mcp-task-reassessment-capture";
import { assertReassessmentToolCall, runReassessmentEffect, withReassessmentTokenReservation, reassessmentTokenReservationFor,
  type ReassessmentExecutionManifest, type ReassessmentExecutionContext, type ReassessmentCaptureEvent } from "./routing/reassessment-execution-scope";

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
    $queryRaw: vi.fn(async (..._args: unknown[]) => []), taskRun: { findUnique: vi.fn(async () => row) },
    taskArtifact: {
      findMany: vi.fn(async () => artifacts.filter(a => a.name === "reassessment-effect-reservation-v1")),
      findUnique: vi.fn(async ({ where }: { where: { artifactId: string } }) => artifacts.find(a => a.artifactId === where.artifactId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (artifacts.some(a => a.artifactId === data.artifactId)) throw new Error("duplicate sealed capture");
        artifacts.push(data); return data;
      }),
    },
    toolExecution: {
      findMany: vi.fn(async () => executions),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { executions.push(data); return { id: `execution-${executions.length}` }; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = executions.find((_e, i) => `execution-${i + 1}` === where.id); if (!found) return { count: 0 };
        Object.assign(found, data); return { count: 1 };
      }),
    },
  };
  let tail: Promise<void> = Promise.resolve();
  const database = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => {
    const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; });
    await prior; try { return await fn(tx); } finally { release(); }
  }) } as unknown as ReassessmentCaptureDatabase;
  const input: PersistedReassessmentExecutionInput = { taskRunRecordId: row.id, taskRunId: row.taskRunId, userId: row.userId, agentId: row.currentAgentId,
    binding: manifest.binding, requestDigest: manifest.requestDigest, executionFence: manifest.executionFence, a2aMetadata: metadata, progressPayload: row.progressPayload };
  return { manifest, locator, row, input, artifacts, executions, tx, database };
}

function finiteFixture() {
  const f = fixture();
  f.manifest.qualification.budgetConfiguration = reassessmentBudgetFixture({ configuredPerTaskLimit: 50_000 });
  f.manifest.qualification.bounds.maxProviderStarts = 10;
  Object.assign(f.manifest.qualification, { finiteTokenProof: { schemaVersion: 1, kind: "dmr-native-messages-v1", apiRoot: "http://dmr.invalid",
    runtimeVersion: "v1.2.8", modelDigest: "sha256:" + "5".repeat(64), engineIdentity: "llama.cpp", engineArtifactDigest: "sha256:" + "6".repeat(64),
    engineSourceCommit: "72874f5", templateDigest: "7".repeat(64), configDigest: "8".repeat(64) } });
  f.locator.manifestDigest = reassessmentExecutionManifestDigest(f.manifest);
  const context: ReassessmentExecutionContext = { ...f.manifest, manifest: { artifactId: f.locator.manifestArtifactId, digest: f.locator.manifestDigest } };
  return { ...f, context, hooks: createReassessmentCaptureHooks(f.input, f.locator, f.database) };
}
function generationEvent(sequence: number, inputTokens: number): ReassessmentCaptureEvent {
  const bodyUtf8 = `generation-${sequence}`;
  return { kind: "provider", name: "messages", sequence, providerReservationOrdinal: sequence, observedAt: new Date().toISOString(),
    input: { operation: "generation", bodyUtf8, tokenReservation: { schemaVersion: 1, reservationId: randomUUID(),
      bodySha256: createHash("sha256").update(bodyUtf8).digest("hex"), inputTokens, maxOutputTokens: 20, reservedTokens: inputTokens + 20 } } };
}

describe("finite durable generation reservation ledger", () => {
  it("captures two generations up to 50K under an exclusive task lock before I/O", async () => {
    const f = finiteFixture(); const io = vi.fn(async () => ({ outputTokens: 1 }));
    await withPersistedReassessmentExecution(f.input, async () => {
      for (const bodyUtf8 of ["first", "second"]) await withReassessmentTokenReservation({ bodyUtf8, inputTokens: 24_980, maxOutputTokens: 20 },
        () => runReassessmentEffect({ kind: "provider", name: "messages", input: { operation: "generation", bodyUtf8,
          tokenReservation: reassessmentTokenReservationFor(bodyUtf8) } }, async () => {
          expect(f.executions.length).toBe(io.mock.calls.length + 1); return io();
        }));
    }, { database: f.database });
    expect(io).toHaveBeenCalledTimes(2); expect(f.tx.toolExecution.findMany).toHaveBeenCalledTimes(2);
    expect(f.tx.$queryRaw.mock.calls.some(args => String(args[0]).includes("FOR UPDATE"))).toBe(true);
  });
  it("independently rejects an already charged 50K reservation even when a caller bypasses the in-memory ledger", async () => {
    const f = finiteFixture(); await f.hooks.reserve(f.context, generationEvent(1, 49_980));
    await expect(f.hooks.reserve(f.context, generationEvent(2, 0))).rejects.toThrow(/token.*limit|allowance/i);
    expect(f.executions).toHaveLength(1); expect(f.tx.taskArtifact.create).toHaveBeenCalledTimes(1);
  });
  it("serializes parallel durable reservations so their combined charge cannot exceed 50K", async () => {
    const f = finiteFixture(); const outcomes = await Promise.allSettled([
      f.hooks.reserve(f.context, generationEvent(1, 29_980)), f.hooks.reserve(f.context, generationEvent(2, 29_980)),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(f.executions).toHaveLength(1);
  });
  it.each(["missing-artifact", "missing-execution", "malformed-reservation", "changed-body", "changed-manifest", "changed-actor", "changed-producer"])("refuses %s current accounting instead of treating it as zero", async condition => {
    const f = finiteFixture(); await f.hooks.reserve(f.context, generationEvent(1, 100));
    if (condition === "missing-artifact") f.artifacts.pop();
    if (condition === "missing-execution") f.executions.pop();
    if (condition === "malformed-reservation") ((f.executions[0]!.parameters as Record<string, unknown>).event as Record<string, unknown>).input = { operation: "generation" };
    if (condition === "changed-body") ((f.executions[0]!.parameters as { event: { input: { bodyUtf8: string } } }).event.input).bodyUtf8 = "changed";
    if (condition === "changed-manifest") (f.executions[0]!.parameters as Record<string, unknown>).manifestDigest = "0".repeat(64);
    if (condition === "changed-actor") f.executions[0]!.agentId = "other";
    if (condition === "changed-producer") f.artifacts.at(-1)!.producerAgentId = "other";
    await expect(f.hooks.reserve(f.context, generationEvent(2, 100))).rejects.toThrow(/accounting|reservation|manifest/i);
    expect(f.tx.toolExecution.create).toHaveBeenCalledTimes(1);
  });
  it("does not refund observed or uncertain reservations and rejects reused token reservation IDs", async () => {
    for (const state of ["observed", "uncertain"] as const) {
      const f = finiteFixture(); const event = generationEvent(1, 49_980); const reservation = await f.hooks.reserve(f.context, event);
      if (state === "observed") await f.hooks.complete(f.context, event, reservation, { outputTokens: 0 });
      else await f.hooks.uncertain!(f.context, event, reservation, { code: "unknown", message: "unobserved" });
      const duplicate = generationEvent(2, 0); (duplicate.input as Record<string, unknown>).tokenReservation = (event.input as Record<string, unknown>).tokenReservation;
      await expect(f.hooks.reserve(f.context, duplicate)).rejects.toThrow(/reservation|token.*limit|allowance/i);
      expect(f.executions).toHaveLength(1);
    }
  });
});

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
