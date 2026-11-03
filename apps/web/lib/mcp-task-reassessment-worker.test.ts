import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReassessmentExecutionSealV2, ReassessmentQualificationSeedV2, ReassessmentCaptureEvent } from "./routing/reassessment-phase-contract";
import type { PresentReassessmentWorkerInput } from "./mcp-task-reassessment-worker";
import type { ReassessmentQualificationInput } from "./inference/reassessment-execution-qualification";
import modelMetadata from "./inference/fixtures/reassessment-native-model.json";
import { accountExecutionVersion } from "./routing/provider-account-candidates";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), scope: vi.fn(), prime: vi.fn(), compare: vi.fn(), prepare: vi.fn(), input: vi.fn(),
  policy: vi.fn(), originals: vi.fn(), authorityFactory: vi.fn(), authority: vi.fn(), seal: vi.fn(),
  staticRoute: vi.fn(), route: vi.fn(), config: vi.fn(), provider: vi.fn(), account: vi.fn(), model: vi.fn(),
  agent: vi.fn(), token: vi.fn(), aggregate: vi.fn(), auth: vi.fn(), localOnly: vi.fn(), fetch: vi.fn(),
  order: [] as string[], events: [] as ReassessmentCaptureEvent[],
  seed: null as unknown as ReassessmentQualificationSeedV2,
  storedSeal: null as ReassessmentExecutionSealV2 | null,
  captureFailure: false,
}));
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: mocks.provider }, aiProviderConnection: { findUnique: mocks.account },
  modelProfile: { findUnique: mocks.model }, agent: { findUnique: mocks.agent },
  mcpApiToken: { findUnique: mocks.token }, tokenUsage: { aggregate: mocks.aggregate },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ fixtureTransaction: true }),
} }));
vi.mock("./mcp-task-reassessment-capture", () => ({
  loadPersistedReassessmentQualificationRoot: mocks.load, withPersistedReassessmentQualification: mocks.scope,
}));
vi.mock("./mcp-task-reassessment-contract", () => ({
  readCurrentReassessmentContract: mocks.prime, assertCurrentReassessmentContract: mocks.compare,
}));
vi.mock("./mcp-task-reassessment-preparation", () => ({
  prepareRemoteReviewAttempt: mocks.prepare, preparePresentReassessmentInput: mocks.input,
}));
vi.mock("./mcp-task-review-reassessment", () => ({
  readApprovedReassessmentPolicy: mocks.policy, readAuthorizedReassessmentOriginals: mocks.originals,
}));
vi.mock("./mcp-task-reassessment-authority", () => ({ createPresentReassessmentAuthority: mocks.authorityFactory }));
vi.mock("./mcp-task-reassessment-admission", () => ({ sealPresentReassessmentExecution: mocks.seal }));
vi.mock("./inference/routed-inference", () => ({
  prepareReassessmentNativeStaticRoute: mocks.staticRoute, prepareReassessmentRoute: mocks.route,
}));
vi.mock("./inference/budget-gate", async load => ({
  ...await load<typeof import("./inference/budget-gate")>(), readReassessmentBudgetConfiguration: mocks.config,
}));
vi.mock("./inference/provider-account-credentials", () => ({ readReassessmentProviderAuthHeaders: mocks.auth }));
vi.mock("./inference/local-only", () => ({ getLocalOnlyInferenceFresh: mocks.localOnly }));
vi.mock("./inference/provider-inference-transport", () => ({ providerInferenceFetch: mocks.fetch }));

import { withPresentReassessmentWorker } from "./mcp-task-reassessment-worker";
import { precheckReassessmentNativeCandidate } from "./inference/reassessment-execution-qualification";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeRuntimeUrls } from "./inference/reassessment-native-runtime";
import { runReassessmentQualification, currentReassessmentQualification, currentFiniteReassessmentExecution,
  getReassessmentQualificationPrefix, runReassessmentEffect, matchesPersistedReassessmentScope } from "./routing/reassessment-execution-scope";

const actualBudget = await vi.importActual<typeof import("./inference/budget-gate")>("./inference/budget-gate");
const modelRef = REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef;
const provider = { providerId: "local", baseUrl: "http://dmr.invalid/engines/v1", endpoint: null,
  endpointType: "ollama", authMethod: "none", authHeader: null, status: "active", retiredAt: null };
const compatibility = { schemaVersion: 1 as const, configDigest: "sha256:" + "1".repeat(64), sourceSha: "2".repeat(40),
  sourceContentHash: "3".repeat(64), contractSha256: "4".repeat(64), owners: {
    transport: { version: 2 as const, sourceSha256: "5".repeat(64) }, approval: { version: 2 as const, sourceSha256: "6".repeat(64) },
    worker: { version: 2 as const, sourceSha256: "7".repeat(64) }, writer: { version: 2 as const, sourceSha256: "8".repeat(64) },
  } };
const artifact = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "c".repeat(40),
  path: "docs/spec.md", providerBlobId: "d".repeat(40) };
const binding = { writerToolName: "record_initiative_design_review" as const, itemId: "BI-285EF102", gate: "design-spec" as const,
  expectedCurrentBaselineId: null, artifactRef: artifact,
  presentReassessment: { schemaVersion: 1 as const, authorizationItemId: "BI-7906C73E", baselineId: "baseline-current",
    policyDigest: "a".repeat(64), originalTaskRunId: "TR-MCP-original", originalRequestDigest: "a".repeat(64),
    predecessorTaskRunIds: ["TR-MCP-original"], authorityArtifact: artifact } };
const requestAuthority = { authorityDecisionId: "decision-original-actor", actingAgentId: "original-requester",
  tokenGrantScopes: ["backlog_read", "initiative_evidence_write", "tool:read_source_at_version", "tool:record_initiative_design_review"] };
const privatePolicy = Object.freeze({ policyDigest: binding.presentReassessment.policyDigest, authorizationItemId: "BI-7906C73E",
  baselineId: "baseline-current", artifactDigest: "a".repeat(64), authorityArtifact: artifact,
  authorizationRowId: "authorization-row", subjectRowId: "subject-row", policy: {
    schemaVersion: 1, subjectItemId: binding.itemId, maxAssessments: 2, historicalConsumption: "retain-unknown",
    currentLimits: "normal-recorded", originalReplay: false, operatorEvidenceActivityIds: ["evidence-original"],
    requirements: [{ gate: "design-spec", originalRequestDigest: "a".repeat(64), maxAssessments: 1 },
      { gate: "spec-approval", originalRequestDigest: "b".repeat(64), maxAssessments: 1 }],
  } });
const originals = [{ taskRunId: "TR-MCP-original", replayAllowed: false }];
const preparationPorts = { resolveAgent: vi.fn(), resolveTools: vi.fn(), resolveSensitivity: vi.fn() };
let workerInput: PresentReassessmentWorkerInput;
let candidateInput: ReassessmentQualificationInput;
let plan: Record<string, unknown>;
function registry() {
  return { agents: [{ agent_id: "AGT-WS-REVIEW", agent_name: "change-reviewer", config_profile: {
    token_budget: { daily_limit: 200000, per_task_limit: 50000 },
    execution_runtime: { type: "in_process", timeout_seconds: 300 }, model_binding: { max_tokens: 8192 },
  } }] };
}

// Wiring coverage: preparation, private policy, authority, storage and the normal
// selector are synthetic. Q/E ALS, budget checks, native response capture,
// observation branding, qualification and promotion execute their real code.
beforeEach(async () => {
  vi.resetAllMocks(); mocks.order.length = 0; mocks.events.length = 0; mocks.storedSeal = null; mocks.captureFailure = false;
  const account = { connectionId: "provider-default-local", providerId: "local", status: "active", authMethod: "local",
    executionChannel: "local-runtime", credentialEntryId: null, credentialEntry: null,
    accessibleModelIds: [modelRef], modelsVerifiedAt: null, evidenceStatus: "operator-attested" };
  plan = { providerId: "local", providerConnectionId: account.connectionId, providerConnectionVersion: accountExecutionVersion(account),
    accountAuthMethod: "none", executionChannel: "local-runtime", modelId: modelRef, recipeId: "recipe-1",
    contractFamily: "sync.reasoning", executionAdapter: "chat", maxTokens: 8192, completionAllowance: 8192,
    providerSettings: {}, toolPolicy: { toolChoice: "required" }, responsePolicy: { terminalWriterToolName: binding.writerToolName } };
  mocks.agent.mockResolvedValue({ id: "canonical-reviewer-row", agentId: "AGT-WS-REVIEW", executionConfig: {
    id: "current-reviewer-config", agentId: "canonical-reviewer-row", executionType: "in_process",
    dailyTokenLimit: 200000, perTaskTokenLimit: 50000, timeoutSeconds: 300, maxTokens: 8192,
  } });
  mocks.config.mockImplementation((agentId: string) => actualBudget.readReassessmentBudgetConfiguration(agentId, registry));
  mocks.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } });
  mocks.provider.mockResolvedValue(provider); mocks.account.mockResolvedValue(account);
  mocks.model.mockResolvedValue({ providerId: "local", modelId: modelRef, modelStatus: "active", retiredAt: null, maxOutputTokens: 16384 });
  mocks.auth.mockResolvedValue({}); mocks.localOnly.mockResolvedValue(false);
  mocks.token.mockResolvedValue({ userId: "human", agentId: requestAuthority.actingAgentId, capability: "write",
    scopes: [...requestAuthority.tokenGrantScopes, "newly-added-scope"] });
  candidateInput = { messages: [{ role: "user", content: "Review immutable source" }], systemPrompt: "Canonical review criteria",
    sensitivity: "development", options: { agentId: "change-reviewer", maxDurationMs: 300000, budgetClass: "balanced" },
    effortWarrant: { maxIterations: 200, maxDurationMs: 300000 }, toolSurfaceDigest: "b".repeat(64) };
  const precheck = await precheckReassessmentNativeCandidate(candidateInput, plan as never);
  const requestDigest = "f".repeat(64), startedAt = new Date(Date.now() - 5000).toISOString();
  mocks.seed = { schemaVersion: 2, phase: "qualification", taskRunId: "TR-MCP-present", userId: "human", agentId: "change-reviewer",
    requestDigest, executionFence: { schemaVersion: 1, reservation: "admitted-reservation", dispatchClaim: "claimed-dispatch",
      authorityDigest: "e".repeat(64), requestDigest }, binding, compatibility, budgetConfiguration: precheck.budgetConfiguration,
    bounds: precheck.bounds, nativeObservationUrls: precheck.nativeObservationUrls, startedAt,
    deadlineAt: new Date(Date.parse(startedAt) + 300000).toISOString(), manifest: { artifactId: "qualification-root", digest: "9".repeat(64) } };
  const metadata = { requestDigest, initiativeReviewBinding: binding, presentReviewAuthority: requestAuthority,
    reassessmentExecution: { schemaVersion: 2, manifestArtifactId: mocks.seed.manifest.artifactId, manifestDigest: mocks.seed.manifest.digest } };
  workerInput = { persistedInput: { taskRunRecordId: "task-row", taskRunId: mocks.seed.taskRunId, userId: "human", agentId: "change-reviewer",
    requestDigest, executionFence: mocks.seed.executionFence, binding, a2aMetadata: metadata, progressPayload: {} },
    parsed: { agentId: "change-reviewer", prompt: "Review immutable source", riskClass: "write", initiativeReviewBinding: binding } as never,
    token: { tokenId: "oauth-original-token", userId: "human", capability: "write", source: "oauth" }, userContext: { userId: "human" } as never,
    threadId: "existing-thread" };
  candidateInput.options.mcpSession = { userId: "human", agentId: "change-reviewer", threadId: "existing-thread",
    taskRunId: mocks.seed.taskRunId, taskExecutionFence: { schemaVersion: 1, reservation: null, dispatchClaim: null,
      authorityDigest: null, requestDigest } };
  mocks.load.mockImplementation(async () => { mocks.order.push("authenticated-root"); return { seed: mocks.seed, requestAuthority }; });
  mocks.prime.mockImplementation(async () => { expect(currentReassessmentQualification()).toBeNull(); mocks.order.push("current-image"); return compatibility; });
  mocks.compare.mockImplementation(() => { mocks.order.push("compare-image"); });
  mocks.prepare.mockImplementation(async (input: { restricted: boolean; validateResolvedAgent?: (id: string) => void }) => {
    expect(currentReassessmentQualification()).toBeNull(); expect(input.restricted).toBe(true);
    input.validateResolvedAgent?.("change-reviewer"); mocks.order.push("restricted-turn");
    return { resolvedAgentId: "change-reviewer", effortWarrant: candidateInput.effortWarrant };
  });
  mocks.input.mockImplementation(async () => { mocks.order.push("restricted-input"); return structuredClone(candidateInput); });
  mocks.staticRoute.mockImplementation(async () => {
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(currentReassessmentQualification()).toBeNull(); mocks.order.push("static-route");
    return { manifests: [{ id: "local:model", ...plan }], decision: { selectedEndpoint: "local:model", executionPlan: plan, candidates: [] },
      contract: { interactionMode: "sync", budgetClass: "balanced" }, posture: null };
  });
  mocks.policy.mockImplementation(async () => { expect(currentReassessmentQualification()).toBeNull(); mocks.order.push("private-policy"); return privatePolicy; });
  mocks.originals.mockImplementation(async () => { mocks.order.push("authorized-originals"); return originals; });
  mocks.authorityFactory.mockImplementation(() => { mocks.order.push("authority-factory"); return mocks.authority; });
  mocks.authority.mockImplementation(async () => { mocks.order.push("current-authority"); });
  mocks.scope.mockImplementation(async (_input, execute, dependencies) => {
    mocks.order.push("open-Q");
    return runReassessmentQualification(mocks.seed, {
      open: async () => {},
      reserve: async (_context, event) => { mocks.events.push(event); return { reservationId: `capture-${event.sequence}` }; },
      complete: async () => { if (mocks.captureFailure) throw new Error("synthetic durable capture failure"); },
      readExecutionSeal: async (root, _prefix) => {
        mocks.order.push("trusted-seal-read");
        if (mocks.storedSeal && dependencies?.validateExecutionAuthority) await dependencies.validateExecutionAuthority({}, root, mocks.storedSeal);
        return mocks.storedSeal;
      },
    }, execute);
  });
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    expect(currentReassessmentQualification()?.taskRunId).toBe(mocks.seed.taskRunId); expect(init.method).toBe("GET");
    expect(mocks.order).toContain("current-authority"); mocks.order.push(`GET:${url}`);
    const catalog = REASSESSMENT_NATIVE_COMPOSITION;
    return new Response(JSON.stringify(url.endsWith("/version") ? { version: catalog.runtimeVersion }
      : url.endsWith("/status") ? { "llama.cpp": `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}` }
      : url.includes("/_configure") ? [{ Backend: "llama.cpp", Model: modelRef, ModelID: catalog.modelDigest, Mode: "completion", Config: { "context-size": 131072 } }]
      : url.endsWith("/models") ? { data: [{ id: modelRef, dmr: { context_window: 4096 } }] } : modelMetadata));
  });
  mocks.route.mockImplementation(async (_messages, _system, _sensitivity, _options, facts) => {
    expect(currentReassessmentQualification()).not.toBeNull(); expect(mocks.fetch).toHaveBeenCalledTimes(5);
    expect(_options.mcpSession.taskExecutionFence).toEqual(mocks.seed.executionFence);
    expect(await facts.reader(undefined, { provider, modelId: modelRef })).toMatchObject({ contextTokens: 131072 });
    mocks.order.push("normal-selection");
    return { executionPlan: plan, contract: { interactionMode: "sync", budgetClass: "balanced" }, requestedBudgetClass: "balanced" };
  });
  mocks.seal.mockImplementation(async (input, dependencies) => {
    expect(currentReassessmentQualification()).not.toBeNull(); mocks.order.push("atomic-seal");
    await dependencies.validateAuthority({}, { ...input, root: mocks.seed });
    mocks.storedSeal = { schemaVersion: 2, root: { schemaVersion: 2, manifestArtifactId: mocks.seed.manifest.artifactId, manifestDigest: mocks.seed.manifest.digest },
      taskRunId: mocks.seed.taskRunId, userId: mocks.seed.userId, agentId: mocks.seed.agentId, requestDigest: mocks.seed.requestDigest,
      executionFence: mocks.seed.executionFence, binding: mocks.seed.binding, qualificationPrefix: getReassessmentQualificationPrefix(),
      qualification: input.qualification, authorityDecisionId: requestAuthority.authorityDecisionId, sealedAt: new Date().toISOString() };
    return mocks.storedSeal;
  });
  // Fixture construction uses real current budget/precheck; observations begin only in the worker.
  mocks.config.mockClear(); mocks.aggregate.mockClear(); mocks.auth.mockClear();
});

describe("present reassessment worker qualification handoff", () => {
  it("captures all native GETs, seals actual qualification and executes once under the original full fence/window", async () => {
    const execute = vi.fn(async () => {
      mocks.order.push("execute-E");
      expect(currentReassessmentQualification()).toBeNull();
      const active = currentFiniteReassessmentExecution();
      expect(active).toMatchObject({ taskRunId: mocks.seed.taskRunId, executionFence: mocks.seed.executionFence,
        startedAt: mocks.seed.startedAt, deadlineAt: mocks.seed.deadlineAt, manifest: mocks.seed.manifest,
        qualification: { budgetConfiguration: mocks.seed.budgetConfiguration, bounds: mocks.seed.bounds, nativeRuntime: { schemaVersion: 2 } } });
      expect(matchesPersistedReassessmentScope(workerInput.persistedInput.a2aMetadata, mocks.seed.taskRunId)).toBe(true);
      await runReassessmentEffect({ kind: "provider", name: "post-promotion-configuration", input: { operation: "configuration" } }, async () => ({ observed: true }));
      return "executed-present-review";
    });
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).resolves.toBe("executed-present-review");
    expect(execute).toHaveBeenCalledOnce(); expect(mocks.scope).toHaveBeenCalledOnce(); expect(mocks.seal).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(reassessmentNativeRuntimeUrls(provider, modelRef));
    expect(mocks.events.map(event => [event.sequence, event.providerReservationOrdinal])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
    expect(mocks.storedSeal?.qualificationPrefix).toMatchObject({ eventCount: 5, providerReservations: 5, providerStarts: 5 });
    expect(mocks.order.indexOf("authenticated-root")).toBeLessThan(mocks.order.indexOf("current-image"));
    expect(mocks.order.indexOf("current-image")).toBeLessThan(mocks.order.indexOf("restricted-turn"));
    expect(mocks.order.indexOf("static-route")).toBeLessThan(mocks.order.indexOf("private-policy"));
    expect(mocks.order.indexOf("current-authority")).toBeLessThan(mocks.order.indexOf("open-Q"));
    expect(mocks.order.indexOf("normal-selection")).toBeLessThan(mocks.order.indexOf("atomic-seal"));
    expect(mocks.order.indexOf("atomic-seal")).toBeLessThan(mocks.order.indexOf("trusted-seal-read"));
    expect(mocks.order.indexOf("trusted-seal-read")).toBeLessThan(mocks.order.indexOf("execute-E"));
    expect(mocks.originals).toHaveBeenCalledWith(expect.objectContaining({ proof: privatePolicy, actingAgentId: requestAuthority.actingAgentId,
      tokenGrantScopes: requestAuthority.tokenGrantScopes }));
    expect(mocks.seal.mock.calls[0]![0].proof).toBe(privatePolicy);
    expect(mocks.authorityFactory).toHaveBeenCalledWith(expect.objectContaining({ token: workerInput.token, requestAuthority,
      budgetConfiguration: mocks.seed.budgetConfiguration, compatibility }));
    expect(mocks.aggregate).toHaveBeenCalled(); expect(currentFiniteReassessmentExecution()).toBeNull();
  });

  it("refuses an unauthenticated/malformed persisted root before preparing a turn or starting a GET", async () => {
    mocks.load.mockRejectedValueOnce(new Error("reassessment-manifest-invalid")); const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/manifest-invalid/);
    expect(mocks.load).toHaveBeenCalledWith(workerInput.persistedInput); expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.scope).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it.each(["budget", "bounds", "urls"])("refuses changed current %s before opening Q or starting any GET", async changed => {
    if (changed === "budget") {
      mocks.agent.mockResolvedValue({ id: "canonical-reviewer-row", agentId: "AGT-WS-REVIEW", executionConfig: {
        id: "changed-current-config", agentId: "canonical-reviewer-row", executionType: "in_process", dailyTokenLimit: 200000,
        perTaskTokenLimit: 40000, timeoutSeconds: 300, maxTokens: 8192,
      } });
    } else if (changed === "bounds") candidateInput.effortWarrant.maxIterations = 199;
    else mocks.provider.mockResolvedValue({ ...provider, baseUrl: "http://changed.invalid/engines/v1" });
    const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/changed|unproven|mismatch/);
    expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("refuses current authority denial before any native GET", async () => {
    mocks.authority.mockRejectedValueOnce(new Error("reassessment-authority-unproven")); const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/authority-unproven/);
    expect(mocks.authority).toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("intersects captured grants with current credential grants before protected original reads", async () => {
    const retained = requestAuthority.tokenGrantScopes.filter(scope => scope !== "backlog_read");
    mocks.token.mockResolvedValue({ userId: "human", agentId: requestAuthority.actingAgentId, capability: "write",
      scopes: [...retained, "newly-added-scope"] });
    mocks.originals.mockImplementationOnce(async input => {
      expect(input.tokenGrantScopes).toEqual(retained);
      throw new Error("reassessment-source-access-required");
    });
    const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/source-access-required/);
    expect(mocks.originals).toHaveBeenCalledOnce(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a current credential for another actor before protected original reads", async () => {
    mocks.token.mockResolvedValue({ userId: "human", agentId: "another-actor", capability: "write", scopes: requestAuthority.tokenGrantScopes });
    const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/authority|credential/);
    expect(mocks.token).toHaveBeenCalled(); expect(mocks.originals).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("holds an incompletely captured actual native GET without sealing or executing", async () => {
    mocks.captureFailure = true; const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/capture-incomplete/);
    expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.events).toHaveLength(1);
    expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an unsupported normal winner after captured facts without a seal or E callback", async () => {
    mocks.route.mockImplementationOnce(async () => ({ executionPlan: { ...plan, providerId: "anthropic", modelId: "cloud-model" },
      contract: { budgetClass: "balanced" }, requestedBudgetClass: "balanced" }));
    const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/normal-selection-unsupported/);
    expect(mocks.fetch).toHaveBeenCalledTimes(5); expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("does not open qualification when the actual current daily usage exhausts its recorded budget", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { inputTokens: 199000, outputTokens: 1000 } }); const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/daily budget is exhausted/);
    expect(mocks.aggregate).toHaveBeenCalled(); expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.seal).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("requires persisted trusted seal readback instead of executing from the seal callback's return value", async () => {
    const persist = mocks.seal.getMockImplementation()!;
    mocks.seal.mockImplementationOnce(async (...args) => {
      const result = await persist(...args); mocks.storedSeal = null; return result;
    });
    const execute = vi.fn();
    await expect(withPresentReassessmentWorker(workerInput, preparationPorts, execute)).rejects.toThrow(/execution-seal-unproven/);
    expect(mocks.fetch).toHaveBeenCalledTimes(5); expect(mocks.seal).toHaveBeenCalledOnce();
    expect(mocks.order).toContain("trusted-seal-read"); expect(execute).not.toHaveBeenCalled();
  });
});
