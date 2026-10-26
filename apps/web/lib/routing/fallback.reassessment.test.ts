import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDecision } from "./types";
import type { RoutedExecutionPlan } from "./recipe-types";
const mock = vi.hoisted(() => ({ active: true, call: vi.fn(), read: vi.fn(), write: vi.fn(), discover: vi.fn(), bearer: vi.fn(), refresh: vi.fn(), assertPlan: vi.fn() }));
vi.mock("./reassessment-execution-scope", () => ({ assertReassessmentActive: () => mock.active ? {} : null,
  assertReassessmentPlan: mock.assertPlan, refuseReassessmentExecution: (code: string) => { throw new Error(code); } }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: mock.read }, aiProviderConnection: { findUnique: vi.fn(), updateMany: mock.write }, modelProfile: { updateMany: mock.write } } }));
vi.mock("@/lib/ai-inference", async () => ({ ...await vi.importActual<typeof import("./inference-error")>("./inference-error"), callProvider: mock.call }));
vi.mock("./rate-tracker", () => ({ recordRequest: vi.fn(), learnFromRateLimitResponse: vi.fn(), extractRetryAfterMs: vi.fn(), markEndpointUnavailable: mock.write, clearEndpointUnavailable: vi.fn() }));
vi.mock("./rate-recovery", () => ({ scheduleRecovery: mock.write }));
vi.mock("./provider-auto-disable", () => ({ autoDisableProvider: mock.write }));
vi.mock("./loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: vi.fn(async () => {}) }));
vi.mock("./model-auth-eligibility", () => ({ isModelRefusalError: () => false, recordAuthEligibility: mock.write }));
vi.mock("@/lib/ai-provider-internals", () => ({ autoDiscoverAndProfile: mock.discover, requestProviderCatalogRefresh: mock.discover, getProviderBearerToken: mock.bearer }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: mock.refresh }));
import { callWithFallbackChain } from "./fallback";
import { InferenceError } from "./inference-error";
function decision(): RouteDecision {
  return { selectedEndpoint: "openai", selectedModelId: "model", reason: "selected", fitnessScore: 1, fallbackChain: ["other"],
    candidates: ["openai", "other"].map(providerId => ({ endpointId: providerId, providerId, modelId: "model", endpointName: providerId,
      fitnessScore: 1, dimensionScores: {}, costPerOutputMToken: null, excluded: false })), excludedCount: 0, excludedReasons: [],
    policyRulesApplied: [], taskType: "review", sensitivity: "public", timestamp: new Date() };
}
const plan: RoutedExecutionPlan = { providerId: "openai", modelId: "model", recipeId: null, contractFamily: "sync.review", executionAdapter: "chat",
  maxTokens: 128, providerSettings: {}, toolPolicy: {}, responsePolicy: {} };
beforeEach(() => {
  vi.clearAllMocks(); mock.active = true; mock.write.mockResolvedValue({ count: 1 }); mock.discover.mockResolvedValue(undefined); mock.assertPlan.mockImplementation(() => mock.active ? {} : null);
  mock.read.mockImplementation(async ({ where }: { where: { providerId: string } }) => ({ providerId: where.providerId, name: where.providerId, authMethod: "oauth2_authorization_code" }));
  mock.call.mockResolvedValue({ content: "reviewed", inputTokens: 1, outputTokens: 1, inferenceMs: 1 });
});
describe("restricted selected composition", () => {
  it.each(["auth", "model_not_found", "network"] as const)("stops after %s without renewal, discovery, account writes or another provider", async code => {
    const failure = new InferenceError("selected provider failed", code, "openai"); mock.call.mockRejectedValueOnce(failure);
    await expect(callWithFallbackChain(decision(), [], "review", [], plan)).rejects.toBe(failure);
    expect(mock.call).toHaveBeenCalledOnce(); expect(mock.discover).not.toHaveBeenCalled(); expect(mock.bearer).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
  });
  it("validates the exact selected plan before any provider lookup", async () => {
    mock.assertPlan.mockImplementationOnce(() => { throw new Error("frozen selected plan changed"); });
    await expect(callWithFallbackChain(decision(), [], "review", [], plan)).rejects.toThrow("frozen selected plan changed");
    expect(mock.read).not.toHaveBeenCalled(); expect(mock.call).not.toHaveBeenCalled();
  });
  it("does not hide a missing selected provider by trying a sibling", async () => {
    mock.read.mockResolvedValueOnce(null);
    await expect(callWithFallbackChain(decision(), [], "review", [], plan)).rejects.toThrow();
    expect(mock.call).not.toHaveBeenCalled(); expect(mock.read).toHaveBeenCalledOnce();
  });
  it("allows the qualified selected provider to finish normally", async () => {
    await expect(callWithFallbackChain(decision(), [], "review", [], plan)).resolves.toMatchObject({ providerId: "openai", content: "reviewed" });
    expect(mock.call).toHaveBeenCalledOnce();
  });
});
