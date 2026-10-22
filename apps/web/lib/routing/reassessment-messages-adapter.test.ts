import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "../shared/reassessment-native-composition";
import type { AdapterRequest } from "./adapter-types";
import {
  reassessmentTokenReservationFor, reassessmentToolSurfaceDigest, runReassessmentEffect,
  runReassessmentQualification, runReassessmentQualificationRequest, promoteReassessmentExecution,
  type ReassessmentCaptureHooks, type ReassessmentExecutionSeed, type ReassessmentQualificationHooks,
} from "./reassessment-execution-scope";
import { reassessmentMessagesAdapter } from "./reassessment-messages-adapter";

const tools = ["read_source_at_version", "record_initiative_design_review"].map(name => ({
  type: "function", function: { name, description: `Restricted ${name}`,
    parameters: { type: "object", properties: {}, additionalProperties: false } },
}));
function payload(usage: unknown = { input_tokens: 70, cache_read_input_tokens: 30, output_tokens: 8 }) {
  return { content: [{ type: "thinking", thinking: "Inspect the immutable source." },
    { type: "text", text: "Reading the bound design." },
    { type: "tool_use", id: "call-reader", name: "read_source_at_version", input: { maxLines: 20 } }],
  stop_reason: "tool_use", usage };
}
async function runWireFixture<T>(seed: ReassessmentExecutionSeed, hooks: ReassessmentCaptureHooks, fn: () => Promise<T>) {
  const { qualification, ...identity } = seed;
  const root = { ...identity, schemaVersion: 2 as const, phase: "qualification" as const,
    budgetConfiguration: qualification.budgetConfiguration, bounds: qualification.bounds,
    nativeObservationUrls: ["http://dmr.invalid/version"],
    compatibility: { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } } };
  const phaseHooks = { ...hooks, readExecutionSeal: async (_context: unknown, prefix: { digest: string }) => {
    const q = { ...qualification, nativeRuntime: { schemaVersion: 2 as const, catalogDigest: reassessmentNativeCatalogDigest(), observationDigest: prefix.digest,
      requestedBudgetClass: "balanced" as const, spendAwareBudgetClass: "balanced" as const } };
    const { qualificationDigest: _, ...unsigned } = q; q.qualificationDigest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
    return { schemaVersion: 2, root: { schemaVersion: 2, manifestArtifactId: root.manifest.artifactId, manifestDigest: root.manifest.digest },
      taskRunId: root.taskRunId, userId: root.userId, agentId: root.agentId, requestDigest: root.requestDigest, executionFence: root.executionFence,
      binding: root.binding, qualificationPrefix: prefix, qualification: q, authorityDecisionId: "fixture-readback", sealedAt: new Date().toISOString() };
  } } as unknown as ReassessmentQualificationHooks;
  return runReassessmentQualification(root, phaseHooks, async () => {
    await runReassessmentQualificationRequest({ method: "GET", url: root.nativeObservationUrls[0]! }, async () => "fixture-version", value => ({ value }));
    return promoteReassessmentExecution(fn);
  });
}
function fixture(count: unknown = { input_tokens: 100 }, response: unknown = payload()) {
  const startedAt = new Date().toISOString();
  const plan: AdapterRequest["plan"] = { providerId: "local", modelId: "model", recipeId: null,
    providerConnectionId: "connection", providerConnectionVersion: "a".repeat(64), accountAuthMethod: "none", executionChannel: "local-runtime",
    contractFamily: "review", executionAdapter: "chat", maxTokens: 100, providerSettings: {},
    toolPolicy: { toolChoice: "required" }, responsePolicy: {} };
  const seed: ReassessmentExecutionSeed = {
    schemaVersion: 1, taskRunId: "TR-NATIVE-MESSAGES", userId: "human", agentId: "reviewer",
    requestDigest: "a".repeat(64), executionFence: { schemaVersion: 1, reservation: "reservation",
      dispatchClaim: "dispatch", authorityDigest: "b".repeat(64), requestDigest: "a".repeat(64) },
    binding: { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
        commitSha: "c".repeat(40), path: "design.md", providerBlobId: "d".repeat(40) } },
    qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "local", modelId: "model",
      providerConnectionId: "connection", providerConnectionVersion: "a".repeat(64), providerConfigurationDigest: "e".repeat(64),
      toolSurfaceDigest: reassessmentToolSurfaceDigest(tools), qualificationDigest: "f".repeat(64), executionPlan: plan,
      budgetConfiguration: reassessmentBudgetFixture({ configuredPerTaskLimit: 50_000,
        registryLimits: { ...reassessmentBudgetFixture().registryLimits, perTaskTokenLimit: 50_000 },
        executionConfigLimits: { ...reassessmentBudgetFixture().executionConfigLimits, perTaskTokenLimit: 50_000 } }),
      bounds: { maxProviderStarts: 20, maxDurationMs: 30_000, maxOutputTokens: 100 },
      finiteTokenProof: { schemaVersion: 1, kind: "dmr-native-messages-v1", apiRoot: "http://dmr.invalid",
        runtimeVersion: "v1.2.8", modelDigest: REASSESSMENT_NATIVE_COMPOSITION.modelDigest,
        engineIdentity: `Running: llama.cpp b9879-metal (sha256:${REASSESSMENT_NATIVE_COMPOSITION.engineArchiveDigest}) 72874f5`,
        engineArtifactDigest: `sha256:${REASSESSMENT_NATIVE_COMPOSITION.engineArchiveDigest}`, engineSourceCommit: "72874f5",
        templateDigest: REASSESSMENT_NATIVE_COMPOSITION.templateDigest, configDigest: "4".repeat(64) } },
    startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(),
    manifest: { artifactId: "ta-native-manifest", digest: "5".repeat(64) },
  };
  const hooks: ReassessmentCaptureHooks = { open: vi.fn(async () => {}),
    reserve: vi.fn(async (_context, event) => ({ reservationId: `capture-${event.sequence}` })),
    complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const network = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(
    String(url).endsWith("/count_tokens") ? count : response,
  ), { status: 200 }));
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const counting = String(input).endsWith("/count_tokens");
    const bodyUtf8 = String(init?.body);
    return runReassessmentEffect({ kind: "provider", name: "native-messages",
      input: { operation: counting ? "count" : "generation", bodyUtf8,
        ...(!counting ? { tokenReservation: reassessmentTokenReservationFor(bodyUtf8) } : {}) } },
    () => network(input, init), async result => ({ status: result.status, body: await result.clone().text() }));
  }) as typeof fetch;
  const request: AdapterRequest = { providerId: "local", modelId: "model", plan,
    provider: { baseUrl: "http://dmr.invalid/engines/llama.cpp/v1", headers: {} }, tools: structuredClone(tools),
    messages: [{ role: "user", content: "Review the exact source." }], systemPrompt: "Use only the bound reader and writer.", fetchImpl };
  return { seed, hooks, request, network,
    execute: () => runWireFixture(seed, hooks, () => reassessmentMessagesAdapter.execute(request)) };
}

describe("restricted native Messages finite-token wire", () => {
  it("refuses a lossy UTF-8 count response before reserving or starting generation", async () => {
    const f = fixture();
    f.network.mockImplementationOnce(async () => new Response(Buffer.concat([
      Buffer.from('{"input_tokens":100,"extra":"'), Buffer.from([0xff]), Buffer.from('"}'),
    ])));
    await expect(f.execute()).rejects.toThrow(/count-invalid-json/);
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 0, held: true }));
  });
  it("refuses overlapping turn dispatch before the second count and preserves the first observed capture", async () => {
    const f = fixture();
    let release!: () => void;
    f.network.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200 });
    });
    await runWireFixture(f.seed, f.hooks, async () => {
      const first = reassessmentMessagesAdapter.execute(f.request);
      const observedFirst = first.then(value => ({ value }), error => ({ error }));
      while (!release) await Promise.resolve();
      try {
        await expect(reassessmentMessagesAdapter.execute(f.request)).rejects.toThrow(/dispatch|held|concurrent/i);
      } finally { release(); await observedFirst; }
      expect(await observedFirst).toMatchObject({ error: expect.objectContaining({ code: "reassessment-execution-held" }) });
    });
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.hooks.complete).toHaveBeenCalledTimes(2);
  });
  it("allows a new full-body count and reservation for a later semantic turn under the same task", async () => {
    const f = fixture();
    await runWireFixture(f.seed, f.hooks, async () => {
      await reassessmentMessagesAdapter.execute(f.request);
      f.request.messages.push({ role: "user", content: "The fully observed writer refused; correct the rationale." });
      await reassessmentMessagesAdapter.execute(f.request);
    });
    expect(f.network).toHaveBeenCalledTimes(4);
    const bodies = f.network.mock.calls.map(call => call[1]?.body);
    expect(bodies[0]).toBe(bodies[1]); expect(bodies[2]).toBe(bodies[3]); expect(bodies[2]).not.toBe(bodies[0]);
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 400, providerStarts: 5 }));
  });
  it("counts the exact text/tool body, reserves finite 50K allowance, and generates with identical bytes", async () => {
    const f = fixture();
    await expect(f.execute()).resolves.toMatchObject({ text: "Reading the bound design.",
      reasoning: "Inspect the immutable source.", finishReason: "tool_use", truncated: false,
      usage: { inputTokens: 100, outputTokens: 8, cacheReadInputTokens: 30 },
      toolCalls: [{ id: "call-reader", name: "read_source_at_version", arguments: { maxLines: 20 } }] });
    expect(f.network.mock.calls.map(call => String(call[0]))).toEqual([
      "http://dmr.invalid/engines/llama.cpp/v1/messages/count_tokens", "http://dmr.invalid/engines/llama.cpp/v1/messages",
    ]);
    const countBody = f.network.mock.calls[0]![1]?.body;
    expect(f.network.mock.calls[1]![1]?.body).toBe(countBody);
    expect(JSON.parse(String(countBody))).toMatchObject({ model: f.seed.qualification.finiteTokenProof!.modelDigest,
      max_tokens: 100, stream: false, tool_choice: { type: "any" },
      tools: [{ name: "read_source_at_version" }, { name: "record_initiative_design_review" }] });
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 200, providerStarts: 3 }));
  });

  it("accepts source-proven zero prospective input without treating count output as generation usage", async () => {
    const f = fixture({ input_tokens: 0 }, payload({ input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }));
    const result = await f.execute();
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 1, cacheReadInputTokens: 0 });
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 100 }));
  });

  it.each([{}, { input_tokens: -1 }, { input_tokens: 1.1 }, { input_tokens: "100" }, { input_tokens: Number.MAX_SAFE_INTEGER + 1 }])(
    "refuses malformed prospective count without starting generation: %j", async count => {
      const f = fixture(count); await expect(f.execute()).rejects.toThrow(/count/i); expect(f.network).toHaveBeenCalledOnce();
    });

  it("refuses input plus maximum completion beyond the finite limit before generation", async () => {
    const f = fixture({ input_tokens: 49_901 });
    await expect(f.execute()).rejects.toThrow(/token.*limit|allowance/i);
    expect(f.network).toHaveBeenCalledOnce();
  });

  it.each([
    undefined, {}, { input_tokens: 100, output_tokens: 8 },
    { input_tokens: 70, cache_read_input_tokens: 29, output_tokens: 8 },
    { input_tokens: 70, cache_read_input_tokens: 30, output_tokens: 101 },
    { input_tokens: -1, cache_read_input_tokens: 101, output_tokens: 8 },
    { input_tokens: 70, cache_read_input_tokens: 30, output_tokens: 8, cache_creation_input_tokens: 1 },
  ])("holds execution for missing or conflicting native generation usage: %j", async usage => {
    const response = payload(); response.usage = usage;
    const f = fixture({ input_tokens: 100 }, response);
    await expect(f.execute()).rejects.toThrow(/usage/i);
    expect(f.network).toHaveBeenCalledTimes(2);
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reservedTokens: 200, held: true }));
  });

  it.each(["media", "builtin", "thinking", "sampling", "previous-response", "stream", "parallel", "system-message", "invalid-choice"])("refuses unsupported %s before any HTTP", async kind => {
    const f = fixture();
    if (kind === "media") f.request.messages = [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://image.invalid" } }] }];
    if (kind === "builtin") f.request.plan.providerSettings = { providerTools: [{ type: "web_search" }] };
    if (kind === "thinking") f.request.plan.providerSettings = { thinking: { type: "enabled", budget_tokens: 20 } };
    if (kind === "sampling") f.request.plan.sampling = { values: { minP: 0.1 }, provenance: {}, mode: "default" };
    if (kind === "previous-response") f.request.previousResponseId = "previous-operation";
    if (kind === "stream") f.request.plan.responsePolicy.stream = true;
    if (kind === "parallel") f.request.plan.toolPolicy.allowParallelToolCalls = false;
    if (kind === "system-message") f.request.messages.push({ role: "system", content: "An unmerged system instruction." });
    if (kind === "invalid-choice") Object.assign(f.request.plan.toolPolicy, { toolChoice: "unknown" });
    f.seed.qualification.executionPlan = structuredClone(f.request.plan);
    await expect(f.execute()).rejects.toThrow(/reassessment|unsupported/i); expect(f.network).not.toHaveBeenCalled();
  });

  it("requires a qualified active finite execution, with no ordinary adapter fallback", async () => {
    const f = fixture(); await expect(reassessmentMessagesAdapter.execute(f.request)).rejects.toThrow(/reassessment|scope|qualified/i);
    expect(f.network).not.toHaveBeenCalled();
  });

  it("does not begin the count request when its capture reservation fails", async () => {
    const f = fixture(); f.hooks.reserve = vi.fn(async () => { throw new Error("capture unavailable"); });
    await expect(f.execute()).rejects.toThrow(/capture/i); expect(f.network).not.toHaveBeenCalled();
  });

  it.each([
    { type: "tool_use", id: "aux", name: "Task", input: {} },
    { type: "tool_use", id: "missing-args", name: "read_source_at_version" },
    { type: "tool_use", id: "array-args", name: "read_source_at_version", input: [] },
    { type: "tool_use", name: "read_source_at_version", input: {} },
    { type: "server_tool_use", id: "builtin", name: "web_search", input: {} },
  ])("holds rather than normalizing an undeclared or incomplete generated tool call: %j", async block => {
    const response = { ...payload(), content: [block] };
    const f = fixture({ input_tokens: 100 }, response);
    await expect(f.execute()).rejects.toThrow(/reassessment|exact.*surface/i);
    expect(f.network).toHaveBeenCalledTimes(2);
    expect(f.hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ held: true }));
  });

  it("preserves text and tool history through the shared message formatter", async () => {
    const f = fixture(); f.request.messages.push(
      { role: "assistant", content: "Read next.", toolCalls: [{ id: "old-reader", name: "read_source_at_version", arguments: { maxLines: 20 } }] },
      { role: "tool", toolCallId: "old-reader", content: "Immutable source page." },
    );
    await f.execute(); const body = JSON.parse(String(f.network.mock.calls[0]![1]?.body));
    expect(body.messages.slice(-2)).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Read next." }, { type: "tool_use", id: "old-reader", name: "read_source_at_version", input: { maxLines: 20 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "old-reader", content: "Immutable source page." }] },
    ]);
  });

  it("preserves only the sampling keys passed through by the pinned native converter", async () => {
    const f = fixture(); f.request.plan.temperature = 0.4;
    f.request.plan.sampling = { values: { temperature: 0.4, topP: 0.9, topK: 20 }, provenance: {}, mode: "default" };
    f.seed.qualification.executionPlan = structuredClone(f.request.plan);
    await f.execute();
    expect(JSON.parse(String(f.network.mock.calls[0]![1]?.body))).toMatchObject({ temperature: 0.4, top_p: 0.9, top_k: 20 });
  });

  it("reports maximum-token truncation and never rescues textual tool syntax", async () => {
    const response = { content: [{ type: "text", text: '<tool_call>{"name":"run_shell","arguments":{}}</tool_call>' }],
      stop_reason: "max_tokens", usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 100 } };
    const f = fixture({ input_tokens: 100 }, response);
    await expect(f.execute()).resolves.toMatchObject({ text: response.content[0]!.text, toolCalls: [], truncated: true, finishReason: "max_tokens" });
  });
});
