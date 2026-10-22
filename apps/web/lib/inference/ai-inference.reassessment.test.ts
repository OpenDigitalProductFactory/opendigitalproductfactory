import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import type { RoutedExecutionPlan } from "../routing/recipe-types";

const mock = vi.hoisted(() => ({
  active: true, useActual: false, readProvider: vi.fn(), readAccount: vi.fn(), credential: vi.fn(), bearer: vi.fn(),
  readonlyAuth: vi.fn(), resolve: vi.fn(), getAdapter: vi.fn(), fetch: vi.fn(), acquire: vi.fn(), release: vi.fn(),
  assertPlan: vi.fn(), revalidate: vi.fn(), effect: vi.fn(), proposed: vi.fn(), context: {} as Record<string, unknown>,
}));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: mock.readProvider }, aiProviderConnection: { findUnique: mock.readAccount } } }));
vi.mock("@/lib/ai-provider-internals", () => ({ getDecryptedCredential: mock.credential, getProviderBearerToken: mock.bearer,
  getProviderExtraHeaders: () => ({}), isAnthropicProvider: () => false, ANTHROPIC_OAUTH_BETA_HEADERS: "oauth" }));
vi.mock("./provider-account-credentials", () => ({ readReassessmentProviderAuthHeaders: mock.readonlyAuth }));
vi.mock("./reassessment-execution-qualification", () => ({ assertReassessmentQualificationCurrent: mock.revalidate }));
vi.mock("../routing/reassessment-execution-scope", async () => {
  const actual = await vi.importActual<typeof import("../routing/reassessment-execution-scope")>("../routing/reassessment-execution-scope");
  return { ...actual, currentReassessmentExecution: () => mock.useActual ? actual.currentReassessmentExecution() : mock.active ? mock.context : null,
    assertReassessmentActive: () => mock.useActual ? actual.assertReassessmentActive() : mock.active ? mock.context : null,
    assertReassessmentPlan: mock.assertPlan, runReassessmentEffect: mock.effect,
    validateReassessmentToolCalls: mock.proposed };
});
vi.mock("@/lib/metrics", () => ({ aiInferenceDuration: { startTimer: () => () => {} }, aiInferenceTokens: { inc: vi.fn() },
  aiInferenceErrors: { inc: vi.fn() }, aiInferenceCostUsd: { inc: vi.fn() }, aiCacheCreationTokens: { inc: vi.fn() }, aiCacheReadTokens: { inc: vi.fn() } }));
vi.mock("./inference-admission", async load => ({ ...await load<typeof import("./inference-admission")>(), acquireInferenceSlot: mock.acquire }));
vi.mock("./host-gpu-admission", () => ({ assertLocalGpuFree: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertProviderDispatchCapacity: vi.fn() }));
vi.mock("../routing/execution-adapter-registry", () => ({ getExecutionAdapter: mock.getAdapter, registerExecutionAdapter: vi.fn() }));
vi.mock("../routing/resolve-execution-adapter", () => ({ resolveExecutionAdapter: mock.resolve }));
vi.mock("../routing/adapter-telemetry-writer", () => ({ writeAdapterTelemetry: vi.fn(async () => {}) }));
vi.mock("../routing/provider-capacity/store", () => ({ clearProviderCapacityStatus: vi.fn(async () => {}), recordProviderCapacityStatus: vi.fn(async () => {}), capacityAccountIdentity: vi.fn() }));
vi.mock("./provider-inference-transport", () => ({ providerInferenceFetch: mock.fetch, withInferenceCancellationFetch: (fetch: typeof globalThis.fetch) => fetch }));

import { callProvider } from "./ai-inference";
import { chatAdapter } from "../routing/chat-adapter";
import { responsesAdapter } from "../routing/responses-adapter";
import { accountExecutionVersion } from "../routing/provider-account-candidates";
import type { ReassessmentExecutionSeed, ReassessmentCaptureHooks } from "../routing/reassessment-execution-scope";

const tools = ["read_initiative_artifact", "record_initiative_design_review"].map(name => ({
  type: "function", function: { name, parameters: { type: "object", properties: {} } },
}));
function plan(adapter: RoutedExecutionPlan["executionAdapter"] = "chat"): RoutedExecutionPlan {
  return { providerId: "openai", modelId: "model", recipeId: null, contractFamily: "sync.review", executionAdapter: adapter,
    maxTokens: 128, providerSettings: {}, toolPolicy: { toolChoice: "required" }, responsePolicy: {} };
}
function payload(toolName?: string) {
  return { choices: [{ message: toolName ? { tool_calls: [{ id: "call-1", type: "function", function: { name: toolName, arguments: "{}" } }] } : { content: "Reviewed" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2 } };
}
beforeEach(() => {
  vi.clearAllMocks(); mock.active = true; mock.useActual = false;
  mock.context = { qualification: { executionPlan: plan(), bounds: { maxOutputTokens: 128 } }, deadlineAt: new Date(Date.now() + 30_000).toISOString() };
  mock.assertPlan.mockImplementation(() => mock.active ? mock.context : null);
  mock.effect.mockImplementation(async (_event: unknown, execute: () => Promise<unknown>, capture?: (value: unknown) => Promise<unknown>) => {
    const value = await execute(); await capture?.(value); return value;
  });
  mock.readProvider.mockResolvedValue({ providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization", baseUrl: "https://provider.invalid/v1" });
  mock.readAccount.mockResolvedValue({ status: "active" });
  mock.readonlyAuth.mockResolvedValue({ Authorization: "Bearer fixture-secret" });
  mock.credential.mockResolvedValue({ secretRef: "ordinary-key" });
  mock.acquire.mockResolvedValue(mock.release);
  mock.getAdapter.mockImplementation((type: string) => type === "responses" ? responsesAdapter : chatAdapter);
  mock.resolve.mockImplementation(async () => chatAdapter);
  mock.fetch.mockImplementation(async () => new Response(JSON.stringify(payload()), { status: 200 }));
});
describe("restricted reassessment provider boundary", () => {
  it("refuses a native adapter before account lookup, credential preparation or capability probing", async () => {
    await expect(callProvider("openai", "model", [], "review", tools, { ...plan("claude-cli"), toolPolicy: { toolChoice: "auto" } })).rejects.toThrow(/reassessment|restricted|HTTP/i);
    expect(mock.readProvider).not.toHaveBeenCalled(); expect(mock.readAccount).not.toHaveBeenCalled();
    expect(mock.credential).not.toHaveBeenCalled(); expect(mock.bearer).not.toHaveBeenCalled(); expect(mock.resolve).not.toHaveBeenCalled();
  });
  it("uses the static HTTP adapter and read-only authentication without a probe", async () => {
    mock.getAdapter.mockImplementation(() => { throw new Error("mutable registry must not select restricted execution"); });
    await expect(callProvider("openai", "model", [], "review", tools, plan())).resolves.toMatchObject({ content: "Reviewed" });
    expect(mock.resolve).not.toHaveBeenCalled(); expect(mock.getAdapter).not.toHaveBeenCalled();
    expect(mock.readonlyAuth).toHaveBeenCalledOnce(); expect(mock.credential).not.toHaveBeenCalled();
    expect(mock.effect).toHaveBeenCalledOnce(); expect(mock.revalidate).toHaveBeenCalled();
  });
  it("forbids automatic redirect requests at the actual transport boundary", async () => {
    await callProvider("openai", "model", [], "review", tools, plan());
    expect(mock.fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("preserves typed capture uncertainty through the Responses adapter", async () => {
    const { ReassessmentExecutionError } = await import("../routing/reassessment-execution-scope");
    const uncertain = new ReassessmentExecutionError("reassessment-effect-outcome-uncertain", "Captured request outcome is unknown.");
    mock.effect.mockRejectedValueOnce(uncertain);
    await expect(callProvider("openai", "model", [], "review", tools, plan("responses"))).rejects.toBe(uncertain);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("refuses hidden provider tools before credential lookup or provider I/O", async () => {
    const hidden = { ...plan(), providerSettings: { providerTools: [{ type: "web_search" }] } };
    await expect(callProvider("openai", "model", [], "review", tools, hidden)).rejects.toThrow(/tool|restricted|reassessment/i);
    expect(mock.readonlyAuth).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("refuses an Anthropic thinking expansion above the frozen output allowance before HTTP starts", async () => {
    const expanded = { ...plan(), providerId: "anthropic", providerSettings: { effort: "high" } };
    await expect(callProvider("anthropic", "model", [], "review", tools, expanded)).rejects.toThrow(/output|allowance|bound/i);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("counts each real Responses POST and refuses a retry that removes the output limit", async () => {
    mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unsupported parameter: max_output_tokens" }), { status: 400 }));
    await expect(callProvider("openai", "model", [], "review", tools, plan("responses"))).rejects.toThrow(/output|bound/i);
    expect(mock.fetch).toHaveBeenCalledOnce(); expect(mock.effect).toHaveBeenCalledOnce();
  });
  it("captures a permitted transport retry separately", async () => {
    mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unsupported parameter: temperature" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "Reviewed", usage: { input_tokens: 5, output_tokens: 2 } }), { status: 200 }));
    await callProvider("openai", "model", [], "review", tools, { ...plan("responses"), temperature: 0.2 });
    expect(mock.fetch).toHaveBeenCalledTimes(2); expect(mock.effect).toHaveBeenCalledTimes(2);
  });
  it("withholds a provider-proposed meta tool before the loop receives it", async () => {
    mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload("Task")), { status: 200 }));
    mock.proposed.mockImplementationOnce(() => { throw new Error("restricted unexpected tool Task"); });
    await expect(callProvider("openai", "model", [], "review", tools, plan())).rejects.toThrow(/unexpected tool Task/);
    expect(mock.proposed).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: "Task" })]));
  });
  it("stops before provider I/O when durable capture reservation fails", async () => {
    mock.effect.mockRejectedValueOnce(new Error("capture reservation unavailable"));
    await expect(callProvider("openai", "model", [], "review", tools, plan())).rejects.toThrow(/capture reservation unavailable/);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("withholds output after capture failure and attaches an absolute abort signal to the actual POST", async () => {
    mock.effect.mockImplementationOnce(async (_event: unknown, execute: () => Promise<unknown>) => { await execute(); throw new Error("capture result unavailable"); });
    await expect(callProvider("openai", "model", [], "review", tools, plan())).rejects.toThrow(/capture result unavailable/);
    expect(mock.fetch).toHaveBeenCalledOnce(); expect(mock.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("charges capture reservation time to the original HTTP deadline", async () => {
    const now = Date.now(); const delays: number[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(delay => { delays.push(delay); return new AbortController().signal; });
    mock.effect.mockImplementationOnce(async (_event: unknown, execute: () => Promise<unknown>, capture?: (value: unknown) => Promise<unknown>) => {
      vi.setSystemTime(now + 20_000); const value = await execute(); await capture?.(value); return value;
    });
    try {
      mock.context.deadlineAt = new Date(now + 30_000).toISOString();
      await callProvider("openai", "model", [], "review", tools, plan());
      expect(delays).toContain(10_000); expect(delays).not.toContain(30_000);
    } finally { timeout.mockRestore(); vi.useRealTimers(); }
  });
});

describe("real restricted scope through the actual HTTP adapter", () => {
  async function fixture() {
    const actual = await vi.importActual<typeof import("../routing/reassessment-execution-scope")>("../routing/reassessment-execution-scope");
    mock.useActual = true; mock.assertPlan.mockImplementation(actual.assertReassessmentPlan);
    mock.effect.mockImplementation(actual.runReassessmentEffect); mock.proposed.mockImplementation(actual.validateReassessmentToolCalls);
    const account = { connectionId: "provider-default-openai", providerId: "openai", status: "active", authMethod: "api-key", executionChannel: "direct-api",
      credentialEntryId: "credential", credentialEntry: { status: "ok" }, accessibleModelIds: ["model"], modelsVerifiedAt: null, evidenceStatus: "unreviewed" };
    mock.readAccount.mockResolvedValue(account);
    const frozenPlan = { ...plan(), providerConnectionId: account.connectionId, providerConnectionVersion: accountExecutionVersion(account) };
    const startedAt = new Date().toISOString();
    const seed: ReassessmentExecutionSeed = {
      schemaVersion: 1, taskRunId: "TR-FIXTURE", userId: "user", agentId: "reviewer", requestDigest: "a".repeat(64),
      executionFence: { schemaVersion: 1, reservation: "r", dispatchClaim: "d", authorityDigest: "b".repeat(64), requestDigest: "a".repeat(64) },
      binding: { writerToolName: "record_initiative_design_review", itemId: "BI-FIXTURE", gate: "design-spec", expectedCurrentBaselineId: null,
        artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "c".repeat(40), path: "design.md", providerBlobId: "d".repeat(40) } },
      qualification: { schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "openai", modelId: "model",
        providerConnectionId: account.connectionId, providerConnectionVersion: frozenPlan.providerConnectionVersion, executionPlan: frozenPlan,
        providerConfigurationDigest: "e".repeat(64), toolSurfaceDigest: "f".repeat(64), qualificationDigest: "1".repeat(64),
        budgetConfiguration: reassessmentBudgetFixture({ configuredDailyLimit: 100_000, configuredMaxOutputTokens: 128 }),
        bounds: { maxProviderStarts: 1, maxDurationMs: 30_000, maxOutputTokens: 128 } },
      startedAt, deadlineAt: new Date(Date.parse(startedAt) + 30_000).toISOString(), manifest: { artifactId: "manifest", digest: "3".repeat(64) },
    };
    const hooks: ReassessmentCaptureHooks = { open: vi.fn(async () => {}), reserve: vi.fn(async () => ({ reservationId: "reserved" })),
      complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const exactTools = tools.map((tool, index) => index ? tool : { ...tool, function: { ...tool.function, name: "read_source_at_version" } });
    seed.qualification.toolSurfaceDigest = actual.reassessmentToolSurfaceDigest(exactTools);
    return { actual, seed, hooks, frozenPlan, exactTools };
  }
  it("does not follow a real HTTP 307 with another uncaptured POST", async () => {
    const { actual, seed, hooks, frozenPlan, exactTools } = await fixture();
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1; request.resume();
      response.writeHead(307, { Location: "/unexpected-second-post" }); response.end("redirect");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture listener.");
    mock.readProvider.mockResolvedValue({ providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization",
      baseUrl: `http://127.0.0.1:${address.port}/v1` });
    mock.fetch.mockImplementation((input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => fetch(input, init));
    try {
      await expect(actual.runReassessmentExecution(seed, hooks,
        () => callProvider("openai", "model", [], "review", exactTools, frozenPlan))).rejects.toThrow(/uncertain|complete result/i);
      expect(requests).toBe(1); expect(hooks.reserve).toHaveBeenCalledOnce(); expect(hooks.uncertain).toHaveBeenCalledOnce();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("captures the complete request and returned structured reader call with no authentication material", async () => {
    const { actual, seed, hooks, frozenPlan, exactTools } = await fixture();
    mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload("read_source_at_version")), { status: 200, headers: { "x-request-id": "request-1" } }));
    const result = await actual.runReassessmentExecution(seed, hooks, () => callProvider("openai", "model", [], "full immutable review prompt", exactTools, frozenPlan));
    expect(result.toolCalls).toEqual([expect.objectContaining({ name: "read_source_at_version", arguments: {} })]);
    expect(hooks.reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "provider", input: expect.objectContaining({
      body: expect.objectContaining({ max_tokens: 128, messages: [{ role: "system", content: "full immutable review prompt" }] }),
    }) }));
    expect(hooks.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ status: 200,
      bodyEncoding: "base64", bodyBase64: Buffer.from(JSON.stringify(payload("read_source_at_version"))).toString("base64") }));
    expect(JSON.stringify(vi.mocked(hooks.reserve).mock.calls)).not.toContain("fixture-secret");
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 1, unknownEffects: 0 }));
  });
  it("rejects changed writer arguments before exposing them and holds further provider starts", async () => {
    const { actual, seed, hooks, frozenPlan, exactTools } = await fixture();
    const body = payload("record_initiative_design_review"); body.choices[0]!.message = { tool_calls: [{ id: "changed", type: "function", function: {
      name: "record_initiative_design_review", arguments: JSON.stringify({ itemId: "BI-OTHER", decision: "pass" }),
    } }] };
    mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
    await actual.runReassessmentExecution(seed, hooks, async () => {
      await expect(callProvider("openai", "model", [], "review", exactTools, frozenPlan)).rejects.toThrow(/conflict/i);
      await expect(callProvider("openai", "model", [], "review", exactTools, frozenPlan)).rejects.toThrow(/held/i);
    });
    expect(mock.fetch).toHaveBeenCalledOnce();
  });
  it("retains post-start capture uncertainty and refuses later I/O", async () => {
    const { actual, seed, hooks, frozenPlan, exactTools } = await fixture();
    hooks.complete = vi.fn(async () => { throw new Error("capture storage failed"); });
    await actual.runReassessmentExecution(seed, hooks, async () => {
      await expect(callProvider("openai", "model", [], "review", exactTools, frozenPlan)).rejects.toThrow(/capture/i);
      await expect(callProvider("openai", "model", [], "review", exactTools, frozenPlan)).rejects.toThrow(/held/i);
    });
    expect(mock.fetch).toHaveBeenCalledOnce(); expect(hooks.uncertain).toHaveBeenCalledOnce();
    expect(hooks.close).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerStarts: 1, unknownEffects: 1, held: true }));
  });
});
