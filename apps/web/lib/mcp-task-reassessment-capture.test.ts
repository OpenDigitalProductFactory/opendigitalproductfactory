import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { reassessmentBudgetFixture } from "../test-support/reassessment-budget-fixture";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import {
  createReassessmentCaptureHooks, hasPersistedReassessmentExecution, reassessmentExecutionManifestDigest,
  withPersistedReassessmentExecution, type ReassessmentCaptureDatabase,
  withPersistedReassessmentQualification, readPersistedReassessmentQualificationPrefix,
  loadPersistedReassessmentQualificationRoot,
  type PersistedReassessmentExecutionInput,
} from "./mcp-task-reassessment-capture";
import { assertReassessmentToolCall, runReassessmentEffect, withReassessmentTokenReservation, reassessmentTokenReservationFor,
  runReassessmentQualificationRequest, promoteReassessmentExecution,
  validateReassessmentCommitBoundary,
  type ReassessmentExecutionManifest, type ReassessmentExecutionContext, type ReassessmentCaptureEvent } from "./routing/reassessment-execution-scope";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { deriveReassessmentExecutionSealArtifactId, type ReassessmentQualificationManifestV2, type ReassessmentRootLocatorV2,
  type ReassessmentExecutionSealV2 } from "./routing/reassessment-phase-contract";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "./shared/reassessment-native-composition";

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
      findMany: vi.fn(async ({ where }: { where: { name: string | { in: string[] } } }) => artifacts.filter(a =>
        typeof where.name === "string" ? a.name === where.name : where.name.in.includes(String(a.name)))),
      findUnique: vi.fn(async ({ where }: { where: { artifactId: string } }) => artifacts.find(a => a.artifactId === where.artifactId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (artifacts.some(a => a.artifactId === data.artifactId)) throw new Error("duplicate sealed capture");
        artifacts.push(data); return data;
      }),
    },
    toolExecution: {
      findMany: vi.fn(async () => executions),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const id = `execution-${executions.length + 1}`; executions.push({ ...data, id }); return { id }; }),
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

function phaseFixture() {
  const f = fixture(); const { qualification, ...identity } = f.manifest;
  const root: ReassessmentQualificationManifestV2 = { ...identity, schemaVersion: 2, phase: "qualification",
    compatibility: { schemaVersion: 1, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } },
    budgetConfiguration: qualification.budgetConfiguration, bounds: { maxProviderStarts: 4, maxDurationMs: 30_000, maxOutputTokens: 20 },
    nativeObservationUrls: ["http://dmr.invalid/version", "http://dmr.invalid/engines/status"] };
  const locator: ReassessmentRootLocatorV2 = { schemaVersion: 2, manifestArtifactId: "ta-root", manifestDigest: reassessmentExecutionManifestDigest(root) };
  Object.assign(f.row.a2aMetadata, { reassessmentExecution: locator });
  f.artifacts.splice(0, 1, { id: "root-row", artifactId: locator.manifestArtifactId, taskRunId: f.row.id, producerAgentId: root.agentId,
    name: "reassessment-qualification-root-v2", parts: [{ type: "reassessment-qualification-root-v2", mimeType: "application/json", data: root }] });
  const authority = vi.fn(async () => {}), io = vi.fn(async () => ({ status: 200, bodyUtf8: "complete native bytes" }));
  const hash = (data: unknown) => createHash("sha256").update(canonicalJson(data)).digest("hex");
  const produceSeal = async () => {
    const prefix = await f.database.$transaction(tx => readPersistedReassessmentQualificationPrefix(tx, f.input, locator, { requireSealAbsent: true }));
    const unsigned = { ...qualification, bounds: root.bounds, providerConnectionVersion: "9".repeat(64),
      executionPlan: { ...qualification.executionPlan, providerConnectionId: qualification.providerConnectionId, providerConnectionVersion: "9".repeat(64),
        accountAuthMethod: "none" as const, executionChannel: "direct-api" as const },
      nativeRuntime: { schemaVersion: 2 as const, catalogDigest: "8".repeat(64), observationDigest: prefix.digest, spendAwareBudgetClass: "balanced" as const } };
    const { qualificationDigest: _old, ...data } = unsigned;
    const seal: ReassessmentExecutionSealV2 = { schemaVersion: 2, root: locator, taskRunId: root.taskRunId, userId: root.userId, agentId: root.agentId,
      requestDigest: root.requestDigest, executionFence: root.executionFence, binding: root.binding, qualificationPrefix: prefix,
      qualification: { ...data, qualificationDigest: hash(data) }, authorityDecisionId: "normal-current-authority", sealedAt: new Date().toISOString() };
    f.artifacts.push({ id: "seal-row", artifactId: deriveReassessmentExecutionSealArtifactId({ taskRunId: root.taskRunId, rootArtifactId: locator.manifestArtifactId,
      rootDigest: locator.manifestDigest }), taskRunId: f.row.id, producerAgentId: root.agentId, name: "reassessment-execution-seal-v2",
      parts: [{ type: "reassessment-execution-seal-v2", mimeType: "application/json", data: seal }] });
    return seal;
  };
  const observe = async () => { for (const url of root.nativeObservationUrls) await runReassessmentQualificationRequest({ method: "GET", url }, io); };
  return { ...f, root, locator, authority, io, produceSeal, observe };
}

describe("persisted qualification and additive execution seal", () => {
  it.each(["current", "changed-task", "changed-root-authority", "extra-key", "malformed-scopes"])("reads only %s admitted pre-Q request authority", async condition => {
    const f = phaseFixture(); const requestAuthority = { authorityDecisionId: "normal-allow", actingAgentId: "requester", tokenGrantScopes: ["initiative_evidence_write"] };
    const metadata = { ...f.row.a2aMetadata, presentReviewAuthority: requestAuthority };
    f.row.a2aMetadata = metadata;
    f.input.a2aMetadata = structuredClone(metadata);
    f.artifacts[0]!.metadata = { authorityDecisionId: requestAuthority.authorityDecisionId, actingAgentId: requestAuthority.actingAgentId };
    if (condition === "changed-task") requestAuthority.authorityDecisionId = "different-allow";
    if (condition === "changed-root-authority") f.artifacts[0]!.metadata = { ...requestAuthority, authorityDecisionId: "different-allow" };
    if (condition === "extra-key") Object.assign(requestAuthority, { grant: true });
    if (condition === "malformed-scopes") Object.assign(requestAuthority, { tokenGrantScopes: [null] });
    const read = loadPersistedReassessmentQualificationRoot(f.input, { database: f.database });
    if (condition === "current") {
      await expect(read).resolves.toMatchObject({ seed: { taskRunId: f.root.taskRunId, compatibility: f.root.compatibility }, requestAuthority });
    } else await expect(read).rejects.toThrow(/request authority/i);
    expect(f.executions).toHaveLength(0);
    expect(f.artifacts).toHaveLength(1);
  });
  it.each(["current", "revoked", "changed-seal", "changed-root", "displaced"])("rechecks %s authority in the writer transaction with its E reservation still outstanding", async condition => {
    const f = phaseFixture(); let commit = false;
    f.authority.mockImplementation(async () => { if (commit && condition === "revoked") throw new Error("authority revoked"); });
    await withPersistedReassessmentQualification(f.input, async () => {
      await f.observe(); const seal = await f.produceSeal();
      const q = seal.qualification, c = REASSESSMENT_NATIVE_COMPOSITION;
      q.executionPlan.executionChannel = "local-runtime"; q.nativeRuntime!.catalogDigest = reassessmentNativeCatalogDigest();
      q.finiteTokenProof = { schemaVersion: 1, kind: c.kind, apiRoot: "http://dmr.invalid", runtimeVersion: c.runtimeVersion,
        modelDigest: c.modelDigest, engineIdentity: `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`,
        engineArtifactDigest: `sha256:${c.engineArchiveDigest}`, engineSourceCommit: "72874f5", templateDigest: c.templateDigest, configDigest: "a".repeat(64) };
      const { qualificationDigest: _old, ...unsigned } = q;
      q.qualificationDigest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
      await promoteReassessmentExecution(async () => {
        await runReassessmentEffect({ kind: "tool", name: f.root.binding.writerToolName, input: {} }, async () => {
          commit = true;
          if (condition === "changed-seal") seal.authorityDecisionId = "different-authority";
          if (condition === "changed-root") f.root.bounds = { ...f.root.bounds, maxProviderStarts: f.root.bounds.maxProviderStarts + 1 };
          if (condition === "displaced") f.row.status = "input-required";
          const transactions = vi.mocked(f.database.$transaction).mock.calls.length;
          const reads = f.tx.toolExecution.findMany.mock.calls.length;
          const verify = validateReassessmentCommitBoundary(f.tx, f.input);
          if (condition === "current") await expect(verify).resolves.toBeUndefined();
          else await expect(verify).rejects.toThrow(/commit-authority/i);
          expect(f.tx.toolExecution.findMany.mock.calls).toHaveLength(reads);
          expect(vi.mocked(f.database.$transaction).mock.calls).toHaveLength(transactions);
          return "synthetic canonical outcome";
        });
      });
    }, { database: f.database, validateExecutionAuthority: f.authority });
    expect(f.authority).toHaveBeenCalledTimes(condition === "current" || condition === "revoked" ? 3 : 2);
  });
  it("uses the same opened root and mirrored prefix for a genuine stored seal before E", async () => {
    const f = phaseFixture();
    await withPersistedReassessmentQualification(f.input, async () => {
      await f.observe(); await f.produceSeal();
      await promoteReassessmentExecution(() => runReassessmentEffect({ kind: "provider", name: "messages", input: { operation: "generation" } }, f.io));
    }, { database: f.database, validateExecutionAuthority: f.authority });
    expect(f.io).toHaveBeenCalledTimes(3); expect(f.authority).toHaveBeenCalledTimes(2);
    expect(f.executions.map(row => (row.parameters as { event: { sequence: number } }).event.sequence)).toEqual([1, 2, 3]);
    expect(f.artifacts.filter(row => row.name === "reassessment-execution-open-v1")).toHaveLength(1);
    expect(f.artifacts.filter(row => row.name === "reassessment-execution-close-v1")).toHaveLength(1);
  });
  it.each(["missing-execution", "missing-observation", "unknown-result", "changed-producer", "changed-output", "missing-output", "missing-authority"])("refuses %s before E I/O", async condition => {
    const f = phaseFixture(); const execute = vi.fn(async () => ({}));
    await withPersistedReassessmentQualification(f.input, async () => {
      await f.observe(); await f.produceSeal();
      if (condition === "missing-execution") f.executions.pop();
      if (condition === "missing-observation") f.artifacts.splice(f.artifacts.findIndex(row => row.name === "reassessment-effect-observed-v1"), 1);
      if (condition === "unknown-result") f.executions[0]!.success = false;
      if (condition === "changed-producer") f.artifacts.find(row => row.name === "reassessment-effect-observed-v1")!.producerAgentId = "other";
      if (condition === "changed-output") f.executions[0]!.result = { executionStatus: "observed", output: "changed bytes" };
      if (condition === "missing-output") {
        f.executions[0]!.result = { executionStatus: "observed", output: null };
        delete ((f.artifacts.find(row => row.name === "reassessment-effect-observed-v1")!.parts as Array<{ data: Record<string, unknown> }>)[0]!.data).output;
      }
      await expect(promoteReassessmentExecution(execute)).rejects.toThrow(/prefix|seal/i);
    }, { database: f.database, ...(condition === "missing-authority" ? {} : { validateExecutionAuthority: f.authority }) });
    expect(execute).not.toHaveBeenCalled(); expect(f.io).toHaveBeenCalledTimes(2);
  });
  it("refuses promotion while the reserved GET has not completed", async () => {
    const f = phaseFixture(); let finish!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }); const barrier = new Promise<void>(resolve => { finish = resolve; });
    await withPersistedReassessmentQualification(f.input, async () => {
      const pending = runReassessmentQualificationRequest({ method: "GET", url: f.root.nativeObservationUrls[0]! }, async () => { started(); await barrier; return {}; });
      await entered;
      await expect(f.database.$transaction(tx => readPersistedReassessmentQualificationPrefix(tx, f.input, f.locator, { requireSealAbsent: true }))).rejects.toThrow(/prefix/i);
      finish(); await pending;
    }, { database: f.database });
  });
  it("refuses a second Q reservation after the seal was inserted", async () => {
    const f = phaseFixture();
    await withPersistedReassessmentQualification(f.input, async () => {
      await f.observe(); await f.produceSeal();
      await expect(f.database.$transaction(tx => readPersistedReassessmentQualificationPrefix(tx, f.input, f.locator, { requireSealAbsent: true }))).rejects.toThrow(/seal/i);
    }, { database: f.database });
    await expect(withPersistedReassessmentQualification(f.input, f.io, { database: f.database })).rejects.toThrow();
    expect(f.io).toHaveBeenCalledTimes(2);
  });
});

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
