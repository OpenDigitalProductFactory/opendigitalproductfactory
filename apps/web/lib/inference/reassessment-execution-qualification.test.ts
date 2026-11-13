import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountExecutionVersion } from "../routing/provider-account-candidates";
import { deriveEffortWarrant } from "../tak/effort-warrant";
import modelMetadata from "./fixtures/reassessment-native-model.json";
import { captureReassessmentNativeRuntime, REASSESSMENT_NATIVE_COMPOSITION } from "./reassessment-native-runtime";
import { runReassessmentQualification } from "../routing/reassessment-execution-scope";

const mocks = vi.hoisted(() => ({ route: vi.fn(), staticRoute: vi.fn(), config: vi.fn(), budget: vi.fn(), auth: vi.fn(),
  provider: vi.fn(), account: vi.fn(), model: vi.fn(), localOnly: vi.fn(), agent: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: mocks.provider },
  aiProviderConnection: { findUnique: mocks.account }, modelProfile: { findUnique: mocks.model }, agent: { findUnique: mocks.agent } } }));
vi.mock("./routed-inference", () => ({ prepareReassessmentRoute: mocks.route, prepareReassessmentNativeStaticRoute: mocks.staticRoute }));
vi.mock("./budget-gate", () => ({ readReassessmentBudgetConfiguration: mocks.config, checkReassessmentBudget: mocks.budget }));
vi.mock("./provider-account-credentials", () => ({ readReassessmentProviderAuthHeaders: mocks.auth }));
vi.mock("./local-only", () => ({ getLocalOnlyInferenceFresh: mocks.localOnly }));
import { assertReassessmentQualificationCurrent, qualifyReassessmentExecution, precheckReassessmentNativeCandidate,
  prepareReassessmentNativeCandidateRoute } from "./reassessment-execution-qualification";
import { EMPTY_CAPABILITIES } from "../routing/model-card-types";
const actualBudget = await vi.importActual<typeof import("./budget-gate")>("./budget-gate");

// This positive fixture explicitly records per-task unlimited in BOTH owners.
// The actual reviewer's finite 50,000 policy is covered by the refusal case.
function budgetRegistry(perTask = 0) {
  return { agents: [{ agent_id: "AGT-WS-REVIEW", agent_name: "change-reviewer", config_profile: {
    token_budget: { daily_limit: 200000, per_task_limit: perTask }, execution_runtime: { type: "in_process", timeout_seconds: 300 },
    model_binding: { max_tokens: 8192 },
  } }] };
}
function executionRow(overrides: Record<string, unknown> = {}) {
  return { id: "canonical-reviewer-row", agentId: "AGT-WS-REVIEW", executionConfig: {
    id: "current-reviewer-config", agentId: "canonical-reviewer-row", executionType: "in_process",
    dailyTokenLimit: 200000, perTaskTokenLimit: 0, timeoutSeconds: 300, maxTokens: 8192, ...overrides,
  } };
}

function fixture() {
  const account = { connectionId: "provider-default-anthropic", providerId: "anthropic", status: "active", authMethod: "api-key",
    executionChannel: "direct-api", credentialEntryId: "key-1", credentialEntry: { status: "pending", updatedAt: new Date("2026-10-01") },
    accessibleModelIds: ["model-1"], modelsVerifiedAt: null, evidenceStatus: "operator-attested" };
  const plan = { providerId: account.providerId, providerConnectionId: account.connectionId,
    providerConnectionVersion: accountExecutionVersion(account), accountAuthMethod: "api_key", executionChannel: "direct-api",
    modelId: "model-1", recipeId: "recipe-1", contractFamily: "sync.reasoning", executionAdapter: "chat", maxTokens: 8192,
    completionAllowance: 8192, providerSettings: { effort: "high" }, toolPolicy: { toolChoice: "required" as const },
    responsePolicy: { terminalWriterToolName: "record_initiative_evidence" } };
  return { account, plan };
}
const input = () => ({ messages: [], systemPrompt: "Review", sensitivity: "development" as const,
  options: { agentId: "change-reviewer", maxDurationMs: 600000 },
  effortWarrant: deriveEffortWarrant({ reasoningDepth: "high" }), toolSurfaceDigest: "b".repeat(64) });

async function withNativeObservation<T>(execute: (observed: Awaited<ReturnType<typeof captureReassessmentNativeRuntime>>) => Promise<T>) {
  const catalog = REASSESSMENT_NATIVE_COMPOSITION, startedAt = new Date().toISOString();
  const account = { ...fixture().account, providerId: "local", connectionId: "provider-default-local", authMethod: "local",
    executionChannel: "local-runtime", credentialEntryId: null, credentialEntry: null };
  const provider = { providerId: "local", status: "active", authMethod: "none", authHeader: null,
    baseUrl: "http://dmr.invalid/engines/v1", endpoint: null, endpointType: "ollama", retiredAt: null };
  const plan = { ...fixture().plan, providerId: "local", providerConnectionId: account.connectionId,
    providerConnectionVersion: accountExecutionVersion(account), accountAuthMethod: "none", executionChannel: "local-runtime",
    modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M", providerSettings: {} };
  mocks.account.mockResolvedValue(account); mocks.provider.mockResolvedValue(provider);
  mocks.model.mockResolvedValue({ providerId: "local", modelId: plan.modelId, modelStatus: "active", retiredAt: null, maxOutputTokens: 16384 });
  mocks.agent.mockResolvedValue(executionRow({ perTaskTokenLimit: 50000 }));
  mocks.config.mockImplementation(() => actualBudget.readReassessmentBudgetConfiguration("change-reviewer", () => budgetRegistry(50000)));
  mocks.route.mockResolvedValue({ executionPlan: plan, selectedManifest: { ...plan, id: "local:model" },
    contract: { interactionMode: "sync", budgetClass: "balanced" }, requestedBudgetClass: "balanced" });
  const precheck = await precheckReassessmentNativeCandidate(input(), plan);
  const requestDigest = "a".repeat(64);
  const seed = { schemaVersion: 2 as const, phase: "qualification" as const, taskRunId: "TR-NATIVE", userId: "human", agentId: "change-reviewer", requestDigest,
    compatibility: { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40), sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64),
      owners: { transport: { version: 2, sourceSha256: "5".repeat(64) }, approval: { version: 2, sourceSha256: "6".repeat(64) },
        worker: { version: 2, sourceSha256: "7".repeat(64) }, writer: { version: 2, sourceSha256: "8".repeat(64) } } },
    executionFence: { schemaVersion: 1 as const, reservation: "reservation", dispatchClaim: "dispatch", authorityDigest: "b".repeat(64), requestDigest },
    binding: { writerToolName: "record_initiative_design_review" as const, itemId: "BI-FIXTURE", gate: "design-spec" as const,
      expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo",
        commitSha: "c".repeat(40), path: "design.md", providerBlobId: "d".repeat(40) } },
    budgetConfiguration: precheck.budgetConfiguration, bounds: precheck.bounds, nativeObservationUrls: precheck.nativeObservationUrls,
    startedAt, deadlineAt: new Date(Date.parse(startedAt) + 300000).toISOString(), manifest: { artifactId: "root", digest: "e".repeat(64) } };
  const hooks = { open: vi.fn(async () => {}), reserve: vi.fn(async () => ({ reservationId: "capture" })), complete: vi.fn(async () => {}),
    readExecutionSeal: vi.fn(async () => null) };
  const fetchImpl: typeof fetch = vi.fn(async url => new Response(JSON.stringify(String(url).endsWith("/version") ? { version: "v1.2.8" }
    : String(url).endsWith("/status") ? { "llama.cpp": `Running: llama.cpp b9879-metal (sha256:${catalog.engineArchiveDigest}) 72874f5` }
    : String(url).includes("/_configure") ? [{ Backend: "llama.cpp", Model: plan.modelId, ModelID: catalog.modelDigest, Mode: "completion", Config: { "context-size": 131072 } }]
    : String(url).endsWith("/models") ? { data: [{ id: plan.modelId, dmr: { context_window: 4096 } }] } : modelMetadata)));
  return runReassessmentQualification(seed, hooks, async () => execute(await captureReassessmentNativeRuntime({
    provider, modelRef: plan.modelId, fetchImpl, assertCurrent: async () => {},
  })));
}

describe("server-owned restricted execution qualification", () => {
  beforeEach(() => {
    vi.resetAllMocks(); const { account, plan } = fixture();
    mocks.account.mockResolvedValue(account);
    mocks.provider.mockResolvedValue({ providerId: "anthropic", status: "active", authMethod: "api_key", authHeader: "x-api-key",
      baseUrl: "https://api.example.test/v1", endpoint: null, endpointType: "llm", retiredAt: null });
    mocks.model.mockResolvedValue({ providerId: "anthropic", modelId: "model-1", modelStatus: "active", retiredAt: null,
      supportsToolUse: true, maxOutputTokens: 16384, maxContextTokens: 200000 });
    mocks.route.mockResolvedValue({ executionPlan: plan, selectedManifest: { ...plan, id: "endpoint-1" }, contract: { interactionMode: "sync" } });
    mocks.agent.mockResolvedValue(executionRow());
    mocks.config.mockImplementation(() => actualBudget.readReassessmentBudgetConfiguration("change-reviewer", budgetRegistry));
    mocks.budget.mockResolvedValue({ status: "ok", actualTokens: 10 }); mocks.auth.mockResolvedValue({}); mocks.localOnly.mockResolvedValue(false);
  });
  it("qualifies an existing HTTP key composition and seals current finite warrant, output and deadline", async () => {
    const qualified = await qualifyReassessmentExecution(input());
    expect(qualified).toMatchObject({ schemaVersion: 1, compositionVersion: "restricted-review-http-v1", providerId: "anthropic",
      providerConnectionId: "provider-default-anthropic", bounds: { maxProviderStarts: 200, maxDurationMs: 300000, maxOutputTokens: 8192 } });
    expect(qualified.qualificationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(qualified.budgetConfiguration).toMatchObject({ source: "registry-and-execution-config",
      registryLimits: { perTaskTokenLimit: 0 }, executionConfigLimits: { perTaskTokenLimit: 0 } });
    expect(mocks.auth).toHaveBeenCalledWith(expect.objectContaining({ expectedExecutionVersion: qualified.providerConnectionVersion }));
    await expect(assertReassessmentQualificationCurrent(qualified)).resolves.toBeUndefined();
  });
  it("prechecks a finite native method without runtime HTTP, route selection or execution permission", async () => {
    const account = { ...fixture().account, providerId: "local", connectionId: "provider-default-local", authMethod: "local",
      executionChannel: "local-runtime", credentialEntryId: null, credentialEntry: null };
    const plan = { ...fixture().plan, providerId: "local", providerConnectionId: account.connectionId,
      providerConnectionVersion: accountExecutionVersion(account), accountAuthMethod: "none", executionChannel: "local-runtime",
      modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M", providerSettings: {} };
    mocks.account.mockResolvedValue(account); mocks.provider.mockResolvedValue({ providerId: "local", status: "active", authMethod: "none",
      authHeader: null, baseUrl: "http://dmr.invalid/engines/v1", endpoint: null, endpointType: "ollama", retiredAt: null });
    mocks.model.mockResolvedValue({ providerId: "local", modelId: plan.modelId, modelStatus: "active", retiredAt: null, maxOutputTokens: 16384 });
    mocks.agent.mockResolvedValue(executionRow({ perTaskTokenLimit: 50000 }));
    mocks.config.mockImplementation(() => actualBudget.readReassessmentBudgetConfiguration("change-reviewer", () => budgetRegistry(50000)));
    const snapshot = await precheckReassessmentNativeCandidate(input(), plan);
    expect(snapshot).toMatchObject({ kind: "supported-native-method", provider: { providerId: "local", baseUrl: "http://dmr.invalid/engines/v1" }, budgetConfiguration: { configuredPerTaskLimit: 50000,
      configuredDailyLimit: 200000 }, nativeObservationUrls: expect.any(Array) });
    expect(snapshot.nativeObservationUrls).toHaveLength(5); expect(mocks.route).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveProperty("qualificationDigest"); expect(snapshot).not.toHaveProperty("finiteTokenProof");
    await expect(precheckReassessmentNativeCandidate(input(), { ...plan, modelId: "ai/another-model:latest" })).rejects.toThrow(/catalog-model-unsupported/);
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/total-bound-unproven/);
  });
  it("qualifies only branded captured native facts under unchanged finite budgets and normal winning selection", async () => {
    const qualified = await withNativeObservation(observed => qualifyReassessmentExecution(input(), observed));
    expect(qualified).toMatchObject({ providerId: "local", executionPlan: { executionChannel: "local-runtime", accountAuthMethod: "none" },
      budgetConfiguration: { configuredPerTaskLimit: 50000, configuredDailyLimit: 200000 },
      nativeRuntime: { schemaVersion: 2, spendAwareBudgetClass: "balanced", requestedBudgetClass: "balanced" },
      finiteTokenProof: { modelDigest: modelMetadata.id } });
    await expect(assertReassessmentQualificationCurrent(qualified)).resolves.toBeUndefined();
    mocks.budget.mockResolvedValueOnce({ status: "warning_95", actualTokens: 195000 });
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/spend-policy-changed/);
  });
  it("refuses a normal cloud winner after captured qualification rather than rewriting selection", async () => {
    await withNativeObservation(async observed => {
      mocks.route.mockResolvedValue({ executionPlan: fixture().plan, contract: { budgetClass: "balanced" }, requestedBudgetClass: "balanced" });
      await expect(qualifyReassessmentExecution(input(), observed)).rejects.toThrow(/normal-selection-unsupported/);
    });
  });
  it("refuses normal quality relaxation for finite qualification and static candidates", async () => {
    await withNativeObservation(async observed => {
      const ordinary = await mocks.route(); mocks.route.mockResolvedValue({ ...ordinary, decision: { routingConfidence: { qualityFloorRelaxed: true } } });
      await expect(qualifyReassessmentExecution(input(), observed)).rejects.toThrow(/quality-floor-relaxed/);
    });
    mocks.staticRoute.mockResolvedValue({ decision: { routingConfidence: { qualityFloorRelaxed: true } }, manifests: [] });
    await expect(prepareReassessmentNativeCandidateRoute(input())).rejects.toThrow(/quality-floor-relaxed/);
  });
  it("keeps a known ordinary cloud winner unsupported before any candidate allocation", async () => {
    const native = { id: "native", providerId: "local", modelId: REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef,
      executionChannel: "local-runtime", accountAuthMethod: "none" };
    mocks.staticRoute.mockResolvedValue({ manifests: [native], decision: { selectedEndpoint: "cloud",
      candidates: [{ endpointId: native.id, excluded: false }] }, contract: { budgetClass: "balanced" } });
    const result = await prepareReassessmentNativeCandidateRoute(input());
    expect(result.status).toBe("unsupported-normal-winner"); expect(result.candidatePlan).toBeNull();
    const facts = mocks.staticRoute.mock.calls[0]![4]; expect(await facts.reader()).toBeNull();
    expect(mocks.route).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("builds only a support candidate for the exact normal unknown-context exclusion", async () => {
    const native = { id: "native", providerId: "local", modelId: REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef,
      providerConnectionId: "provider-default-local", providerConnectionVersion: "e".repeat(64),
      executionChannel: "local-runtime", accountAuthMethod: "none", modelFamily: null, modelClass: "chat", maxOutputTokens: null,
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true } };
    mocks.staticRoute.mockResolvedValue({ manifests: [native], decision: { selectedEndpoint: "cloud", candidates: [{ endpointId: native.id,
      excluded: true, excludedReason: "Activity context capacity is unknown; refresh endpoint capacity evidence" }] },
    contract: { budgetClass: "balanced", contractFamily: "review", requiresTools: true, reasoningDepth: "high", estimatedInputTokens: 1000,
      estimatedOutputTokens: 100 }, posture: null });
    const result = await prepareReassessmentNativeCandidateRoute(input());
    expect(result.status).toBe("runtime-facts-required");
    expect(result.candidatePlan).toMatchObject({ providerId: "local", accountAuthMethod: "none", executionChannel: "local-runtime" });
    expect(result.candidatePlan).not.toHaveProperty("qualificationDigest"); expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("refuses a recorded finite aggregate task limit whose input bound has no enforcement producer", async () => {
    mocks.agent.mockResolvedValue(executionRow({ perTaskTokenLimit: 50000 }));
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/total-bound-unproven/);
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it("rejects a changed account, provider configuration or budget before another effect", async () => {
    const qualified = await qualifyReassessmentExecution(input());
    mocks.account.mockResolvedValue({ ...fixture().account, credentialEntryId: "replacement" });
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/changed/);
    mocks.account.mockResolvedValue(fixture().account);
    mocks.provider.mockResolvedValue({ ...(await mocks.provider()), baseUrl: "https://changed.example.test" });
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/changed/);
    mocks.config.mockReturnValue({ ...await mocks.config(), configurationDigest: "d".repeat(64) });
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/budget|changed/);
  });
  it.each([
    { executionAdapter: "claude-cli" }, { accountAuthMethod: "oauth2_authorization_code" },
    { providerSettings: { providerTools: [] } }, { maxTokens: 9000 },
    { providerSettings: { effort: "high" }, completionAllowance: undefined },
    { providerSettings: { thinking_budget_tokens: 1024 } },
  ])("refuses unsupported or unbounded selected wire configuration %s", async override => {
    const original = await mocks.route(); mocks.route.mockResolvedValue({ ...original, executionPlan: { ...original.executionPlan, ...override } });
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/reassessment-/);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("propagates exhausted/unavailable normal budget instead of qualifying", async () => {
    mocks.budget.mockRejectedValue(new Error("budget owner unavailable"));
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/unavailable/);
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it("refuses missing current execution config before routing and rechecks it before every start", async () => {
    mocks.agent.mockResolvedValueOnce({ ...executionRow(), executionConfig: null });
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/configuration/);
    expect(mocks.route).not.toHaveBeenCalled();
    const qualified = await qualifyReassessmentExecution(input());
    mocks.agent.mockRejectedValueOnce(new Error("current execution config unavailable"));
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/unavailable/);
  });
  it("waits for the fresh current configuration and rejects a narrowed row during admission", async () => {
    const qualified = await qualifyReassessmentExecution(input());
    let release!: (row: ReturnType<typeof executionRow>) => void;
    mocks.agent.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let settled = false;
    const check = assertReassessmentQualificationCurrent(qualified);
    void check.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release(executionRow({ timeoutSeconds: 120 }));
    await expect(check).rejects.toThrow(/budget-configuration-changed/);
  });
  it("rejects changed live policy even if the registry still supplies the same effective maximum", async () => {
    const qualified = await qualifyReassessmentExecution(input());
    mocks.agent.mockResolvedValue(executionRow({ maxTokens: 16384 }));
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/budget-configuration-changed/);
  });
  it("seals optional plan fields with their actual JSON semantics and refuses non-JSON settings", async () => {
    const original = await mocks.route();
    mocks.route.mockResolvedValue({ ...original, executionPlan: { ...original.executionPlan, temperature: undefined } });
    const qualified = await qualifyReassessmentExecution(input());
    expect(Object.hasOwn(qualified.executionPlan, "temperature")).toBe(false);
    mocks.route.mockResolvedValue({ ...original, executionPlan: { ...original.executionPlan, providerSettings: { temperature: Infinity } } });
    await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/plan-invalid/);
  });
  it("rechecks the live sovereignty policy after capacity and refuses an unavailable policy read", async () => {
    const qualified = await qualifyReassessmentExecution(input());
    mocks.localOnly.mockResolvedValue(true);
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/residency-policy-changed/);
    mocks.localOnly.mockRejectedValue(new Error("policy read unavailable"));
    await expect(assertReassessmentQualificationCurrent(qualified)).rejects.toThrow(/unavailable/);
  });
  it.each(["https://user:secret@api.example.test/v1", "https://api.example.test/v1?key=secret", "https://api.example.test/v1#other"])(
    "refuses an endpoint with unrecorded routing or authentication data", async baseUrl => {
      mocks.provider.mockResolvedValue({ ...(await mocks.provider()), baseUrl });
      await expect(qualifyReassessmentExecution(input())).rejects.toThrow(/endpoint-unproven/);
      expect(mocks.auth).not.toHaveBeenCalled();
    });
});
