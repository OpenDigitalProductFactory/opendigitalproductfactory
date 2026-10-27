import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { afterEach, describe, expect, it, vi } from "vitest";
const publishedSnapshot = vi.hoisted(() => ({ readFile: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:fs", () => ({ default: { promises: { readFile: publishedSnapshot.readFile } } }));
vi.mock("node:child_process", () => ({ spawnSync: publishedSnapshot.spawnSync }));
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import metadata from "./fixtures/reassessment-native-model.json";
import { reassessmentMessagesAdapter } from "../routing/reassessment-messages-adapter";
import { runReassessmentQualification, promoteReassessmentExecution, runReassessmentExecution,
  reassessmentToolSurfaceDigest, type QualifiedReassessmentExecution, type ReassessmentQualificationHooks,
  type ReassessmentExecutionSeed } from "../routing/reassessment-execution-scope";
import { captureReassessmentNativeRuntime, reassessmentNativeRuntimeUrls, reassessmentNativeMessagesFetch,
  REASSESSMENT_NATIVE_COMPOSITION, assertNativeRuntimeMatches } from "./reassessment-native-runtime";
import { nativeRuntimeReaderFor } from "./reassessment-native-runtime";
import { withReassessmentHttpTransport } from "./reassessment-http-capture";
import { inspectLocalGpuAdmission } from "./host-gpu-admission";
import type { RoutedExecutionPlan } from "../routing/recipe-types";

const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const tools = ["read_source_at_version", "record_initiative_design_review"].map(name => ({ type: "function", function: {
  name, description: name, parameters: { type: "object", properties: {}, additionalProperties: false },
} }));
const provider = { providerId: "local", baseUrl: "http://fixture.invalid/engines/v1", endpoint: null };
const modelId = REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef;

/** Synthetic storage, account and compatibility facts are explicit fixture
 * owners. Actual Q/E scope, parser, capture, adapter and wire guards execute;
 * the only HTTP port returns static bytes and never reaches a real runtime. */
function fixture() {
  publishedSnapshot.readFile.mockReset().mockRejectedValue(Object.assign(new Error("Snapshot absent"), { code: "ENOENT" }));
  publishedSnapshot.spawnSync.mockReset();
  const startedAt = new Date().toISOString(), requestDigest = "a".repeat(64);
  const plan: RoutedExecutionPlan = { providerId: "local", modelId, providerConnectionId: "provider-default-local",
    providerConnectionVersion: "b".repeat(64), accountAuthMethod: "none", executionChannel: "local-runtime",
    recipeId: null, contractFamily: "review", executionAdapter: "chat", maxTokens: 100, providerSettings: {},
    toolPolicy: { toolChoice: "required" }, responsePolicy: {} };
  const baseBudget = reassessmentBudgetFixture();
  const budget = reassessmentBudgetFixture({ configuredPerTaskLimit: 50000,
    registryLimits: { ...baseBudget.registryLimits, perTaskTokenLimit: 50000 },
    executionConfigLimits: { ...baseBudget.executionConfigLimits, perTaskTokenLimit: 50000 } });
  const root = { schemaVersion: 2 as const, phase: "qualification" as const, taskRunId: "TR-NATIVE-CONNECTED", userId: "human", agentId: "reviewer", requestDigest,
    executionFence: { schemaVersion: 1 as const, reservation: "reservation", dispatchClaim: "dispatch", authorityDigest: "c".repeat(64), requestDigest },
    binding: { writerToolName: "record_initiative_design_review" as const, itemId: "BI-FIXTURE", gate: "design-spec" as const,
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "d".repeat(40), path: "design.md", providerBlobId: "e".repeat(40) } },
    budgetConfiguration: budget, bounds: { maxProviderStarts: 30, maxDurationMs: 30000, maxOutputTokens: 100 },
    nativeObservationUrls: reassessmentNativeRuntimeUrls(provider, modelId), startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30000).toISOString(),
    manifest: { artifactId: "root", digest: "f".repeat(64) },
    compatibility: { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } } };
  let qualified: QualifiedReassessmentExecution;
  const hooks: ReassessmentQualificationHooks = { open: vi.fn(async () => {}),
    reserve: vi.fn(async (_context, event) => ({ reservationId: `event-${event.sequence}` })),
    complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}), close: vi.fn(async () => {}),
    readExecutionSeal: vi.fn(async (context, prefix) => ({ schemaVersion: 2 as const, root: { schemaVersion: 2 as const, manifestArtifactId: context.manifest.artifactId,
      manifestDigest: context.manifest.digest }, taskRunId: context.taskRunId, userId: context.userId, agentId: context.agentId,
      requestDigest: context.requestDigest, executionFence: context.executionFence, binding: context.binding,
      qualificationPrefix: prefix, qualification: qualified, authorityDecisionId: "fixture-server-readback", sealedAt: new Date().toISOString() })) };
  const actual = { count: 100, output: 8, context: 131072, includeThinkingEvidence: false };
  const network = vi.fn(async (url: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const payload = path.endsWith("/version") ? { version: "v1.2.8" } : path.endsWith("/status") ? {
      "llama.cpp": `Running: llama.cpp b9879-metal (sha256:${REASSESSMENT_NATIVE_COMPOSITION.engineArchiveDigest}) 72874f5`,
    } : path.endsWith("/_configure") ? [{ Backend: "llama.cpp", Model: modelId, ModelID: metadata.id, Mode: "completion", Config: { "context-size": actual.context } }]
      : path.endsWith("/models") ? { data: [{ id: modelId, dmr: { context_window: 4096 } }] } : path.endsWith("/engines/ps") ? []
      : path.includes("/models/sha256:") ? metadata : path.endsWith("/count_tokens") ? { input_tokens: actual.count }
      : path.endsWith("/messages") ? { content: [{ type: "tool_use", id: "reader", name: "read_source_at_version", input: { maxLines: 20 } }],
        stop_reason: "tool_use", usage: { input_tokens: actual.count, cache_read_input_tokens: 0, output_tokens: actual.output } } : null;
    if (payload === null) throw new Error(`Unexpected fixture HTTP path: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "x-api-key": "secret-not-captured" } });
  });
  const execute = <T>(fn: (request: Parameters<typeof reassessmentMessagesAdapter.execute>[0]) => Promise<T>) =>
    runReassessmentQualification(root, hooks, async () => {
      const observed = await captureReassessmentNativeRuntime({ provider, modelRef: modelId, fetchImpl: network, assertCurrent: async () => {} });
      if (actual.includeThinkingEvidence) {
        const interpreted = await nativeRuntimeReaderFor(observed)(undefined, { modelId, provider });
        if (!interpreted || typeof interpreted !== "object") throw new Error("Fixture runtime evidence missing");
        plan.localThinkingBudgetEvidence = interpreted.thinkingBudgetEvidence;
      }
      const unsigned = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const,
        providerId: "local", providerConnectionId: plan.providerConnectionId!, providerConnectionVersion: plan.providerConnectionVersion!, modelId,
        executionPlan: plan, providerConfigurationDigest: "1".repeat(64), toolSurfaceDigest: reassessmentToolSurfaceDigest(tools),
        budgetConfiguration: budget, bounds: root.bounds, finiteTokenProof: observed.finiteTokenProof,
        nativeRuntime: { schemaVersion: 2 as const, catalogDigest: observed.catalogDigest, observationDigest: observed.observationDigest,
          requestedBudgetClass: "balanced" as const, spendAwareBudgetClass: "balanced" as const } };
      qualified = { ...unsigned, qualificationDigest: hash(unsigned) };
      return promoteReassessmentExecution(() => withReassessmentHttpTransport({ fetchImpl: network, assertCurrent: async () => {} }, () => fn({
        providerId: "local", modelId, plan, provider: { baseUrl: provider.baseUrl!, headers: {} }, tools,
        systemPrompt: "Canonical reviewer criteria.", messages: [{ role: "user", content: "Full immutable source and history." }],
        fetchImpl: reassessmentNativeMessagesFetch(plan, tools),
      })));
    });
  return { root, hooks, actual, network, plan, execute, qualification: () => qualified };
}

describe("connected finite native Q/E transport", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["absent", "stale"])("durably captures %s host telemetry and real capacity under the same finite root", async state => {
    const f = fixture(); vi.stubEnv("DPF_HOST_GPU_SNAPSHOT_FILE", "/fixture-state/host-gpu.json");
    const bytes = Buffer.from(JSON.stringify({ observedAtMs: Date.now() - 21_000, memoryUsedMiB: 800, memoryTotalMiB: 24000, utilizationPercent: 99 }));
    if (state === "stale") publishedSnapshot.readFile.mockResolvedValue(bytes);
    await f.execute(async request => {
      expect(await inspectLocalGpuAdmission({ modelId })).toEqual({ defer: null, unloadIdle: false });
      return reassessmentMessagesAdapter.execute(request);
    });
    expect(f.network).toHaveBeenCalledTimes(8); expect(String(f.network.mock.calls[5]![0])).toBe("http://fixture.invalid/engines/ps");
    const output = vi.mocked(f.hooks.complete).mock.calls[5]![3];
    expect(output).toMatchObject({ http: { status: 200, bodyEncoding: "base64", bodyBase64: Buffer.from("[]").toString("base64") },
      observation: { snapshot: null, runners: [], decision: { defer: null, unloadIdle: false },
        provenance: { source: "published-file", path: resolve("/fixture-state/host-gpu.json"), unknownReason: `published-snapshot-${state}` } } });
    if (state === "stale") expect(output).toMatchObject({ observation: { provenance: { readOutcome: "complete", bodyBase64: bytes.toString("base64") } } });
    else expect(output).toMatchObject({ observation: { provenance: { readOutcome: "absent", errorCode: "ENOENT" } } });
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 8, reservedTokens: 200, unknownEffects: 0 }));
    expect(publishedSnapshot.spawnSync).not.toHaveBeenCalled(); expect(JSON.stringify(output)).not.toContain("secret-not-captured");
  });
  it("preserves recognized normal runtime evidence while allowing only its observation time to refresh", async () => {
    const f = fixture(); f.actual.includeThinkingEvidence = true;
    await f.execute(request => reassessmentMessagesAdapter.execute({ ...request, plan: { ...request.plan,
      localThinkingBudgetEvidence: { ...request.plan.localThinkingBudgetEvidence!, observedAt: Date.now() + 1 } } }));
    expect(f.network).toHaveBeenCalledTimes(7);
  });
  it("rejects altered runtime evidence before counting", async () => {
    const f = fixture(); f.actual.includeThinkingEvidence = true;
    await expect(f.execute(request => reassessmentMessagesAdapter.execute({ ...request, plan: { ...request.plan,
      localThinkingBudgetEvidence: { ...request.plan.localThinkingBudgetEvidence!, modelDigest: "sha256:" + "0".repeat(64) } } }))).rejects.toThrow(/composition|evidence/);
    expect(f.network).toHaveBeenCalledTimes(5);
  });
  it("captures five qualification GETs then identical count/generation bytes under one finite root", async () => {
    const f = fixture(); const result = await f.execute(request => reassessmentMessagesAdapter.execute(request));
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 8 });
    expect(f.network).toHaveBeenCalledTimes(7); expect(f.hooks.open).toHaveBeenCalledOnce();
    const count = f.network.mock.calls[5]!, generation = f.network.mock.calls[6]!;
    expect(count[1]?.body).toBe(generation[1]?.body);
    expect(JSON.parse(String(count[1]?.body))).toMatchObject({ model: metadata.id, max_tokens: 100 });
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 7, reservedTokens: 200, unknownEffects: 0 }));
    expect(JSON.stringify(vi.mocked(f.hooks.complete).mock.calls)).not.toContain("secret-not-captured");
  });
  it("refuses a legacy v1 finite DTO even if it contains copied schema2 fields", async () => {
    const f = fixture(); await f.execute(async () => {});
    const { phase: _phase, budgetConfiguration: _budget, bounds: _bounds, nativeObservationUrls: _urls, compatibility: _compat, ...identity } = f.root;
    const seed: ReassessmentExecutionSeed = { ...identity, schemaVersion: 1, qualification: f.qualification() };
    const oldNetwork = vi.fn(async () => new Response(JSON.stringify({ input_tokens: 100 })));
    await expect(runReassessmentExecution(seed, { open: async () => {}, reserve: async () => ({ reservationId: "old" }), complete: async () => {} },
      () => reassessmentMessagesAdapter.execute({ providerId: "local", modelId, plan: f.plan, provider: { baseUrl: provider.baseUrl!, headers: {} },
        tools, messages: [], systemPrompt: "review", fetchImpl: oldNetwork }))).rejects.toThrow(/promoted|qualified|scope|finite/i);
    expect(oldNetwork).not.toHaveBeenCalled();
  });
  it("retains the exact full generation reservation when its pre-effect capture fails", async () => {
    const f = fixture();
    vi.mocked(f.hooks.reserve).mockImplementation(async (_context, event) => {
      if (event.sequence === 7) throw new Error("generation capture unavailable");
      return { reservationId: `event-${event.sequence}` };
    });
    await expect(f.execute(request => reassessmentMessagesAdapter.execute(request))).rejects.toThrow(/capture/);
    expect(f.network).toHaveBeenCalledTimes(6);
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 200, held: true, providerStarts: 6 }));
  });
  it("pays for a fresh execution snapshot and refuses changed context before counting", async () => {
    const f = fixture();
    await f.execute(async () => {
      f.actual.context = 65536;
      const observed = await captureReassessmentNativeRuntime({ provider, modelRef: modelId, fetchImpl: f.network, assertCurrent: async () => {} });
      expect(() => assertNativeRuntimeMatches(f.qualification(), observed)).toThrow(/runtime-changed/);
    });
    expect(f.network).toHaveBeenCalledTimes(10);
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 10, reservedTokens: 0, held: true }));
  });
});
