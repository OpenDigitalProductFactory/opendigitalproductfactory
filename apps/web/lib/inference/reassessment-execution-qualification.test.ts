import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountExecutionVersion } from "../routing/provider-account-candidates";
import { deriveEffortWarrant } from "../tak/effort-warrant";

const mocks = vi.hoisted(() => ({ route: vi.fn(), config: vi.fn(), budget: vi.fn(), auth: vi.fn(),
  provider: vi.fn(), account: vi.fn(), model: vi.fn(), localOnly: vi.fn(), agent: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: mocks.provider },
  aiProviderConnection: { findUnique: mocks.account }, modelProfile: { findUnique: mocks.model }, agent: { findUnique: mocks.agent } } }));
vi.mock("./routed-inference", () => ({ prepareReassessmentRoute: mocks.route }));
vi.mock("./budget-gate", () => ({ readReassessmentBudgetConfiguration: mocks.config, checkReassessmentBudget: mocks.budget }));
vi.mock("./provider-account-credentials", () => ({ readReassessmentProviderAuthHeaders: mocks.auth }));
vi.mock("./local-only", () => ({ getLocalOnlyInferenceFresh: mocks.localOnly }));
import { assertReassessmentQualificationCurrent, qualifyReassessmentExecution } from "./reassessment-execution-qualification";
const actualBudget = await vi.importActual<typeof import("./budget-gate")>("./budget-gate");

// This positive fixture explicitly records per-task unlimited in BOTH owners.
// The actual reviewer's finite 50,000 policy is covered by the refusal case.
function budgetRegistry() {
  return { agents: [{ agent_id: "AGT-WS-REVIEW", agent_name: "change-reviewer", config_profile: {
    token_budget: { daily_limit: 200000, per_task_limit: 0 }, execution_runtime: { type: "in_process", timeout_seconds: 300 },
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
    completionAllowance: 8192, providerSettings: { effort: "high" }, toolPolicy: { toolChoice: "required" },
    responsePolicy: { terminalWriterToolName: "record_initiative_evidence" } };
  return { account, plan };
}
const input = () => ({ messages: [], systemPrompt: "Review", sensitivity: "development" as const,
  options: { agentId: "change-reviewer", maxDurationMs: 600000 },
  effortWarrant: deriveEffortWarrant({ reasoningDepth: "high" }), toolSurfaceDigest: "b".repeat(64) });

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
