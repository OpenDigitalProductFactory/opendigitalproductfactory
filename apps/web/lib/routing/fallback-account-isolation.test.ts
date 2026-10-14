import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDecision } from "./types";
const mocks = vi.hoisted(() => ({ call: vi.fn(), disable: vi.fn(), updateAccount: vi.fn(), updateProfile: vi.fn(), refresh: vi.fn(), learn: vi.fn().mockResolvedValue({ changed: true }), readAccount: vi.fn() }));
vi.mock("./model-auth-eligibility", async (importOriginal) => ({ ...await importOriginal<typeof import("./model-auth-eligibility")>(), recordAuthEligibility: mocks.learn }));
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: vi.fn(async () => ({ providerId: "openai", name: "OpenAI", authMethod: "api_key" })) },
  aiProviderConnection: { findUnique: mocks.readAccount, updateMany: mocks.updateAccount },
  modelProfile: { updateMany: mocks.updateProfile },
} }));
vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error { constructor(message: string, public code: string, public providerId: string) { super(message); } }
  return { callProvider: mocks.call, InferenceError };
});
vi.mock("./provider-auto-disable", () => ({ autoDisableProvider: mocks.disable }));
vi.mock("./rate-tracker", () => ({ recordRequest: vi.fn(), learnFromRateLimitResponse: vi.fn(), extractRetryAfterMs: vi.fn(), markEndpointUnavailable: vi.fn(), clearEndpointUnavailable: vi.fn() }));
vi.mock("./rate-recovery", () => ({ scheduleRecovery: vi.fn() }));
vi.mock("./loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: vi.fn(async () => {}) }));
vi.mock("@/lib/ai-provider-internals", () => ({ autoDiscoverAndProfile: vi.fn(async () => {}), requestProviderCatalogRefresh: vi.fn(async () => {}) }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: mocks.refresh }));
import { InferenceError } from "@/lib/ai-inference";
import { callWithFallbackChain } from "./fallback";
import { accountExecutionVersion, ProviderAccountSelectionChangedError } from "./provider-account-candidates";
import { NativeCliExecutionUncertainError } from "./cli-owned-runner";
function account(connectionId: string) {
  return { connectionId, providerId: "openai", status: "active", authMethod: "api-key", executionChannel: "direct-api", accessibleModelIds: ["model"], modelsVerifiedAt: new Date("2026-10-14T00:00:00Z"), credentialEntryId: "owned", credentialEntry: { status: "ok" }, evidenceStatus: "unreviewed" };
}
function decision(): RouteDecision {
  const candidates = ["account-a", "account-b"].map((providerConnectionId, i) => ({ endpointId: `endpoint-${i}`, providerId: "openai", modelId: "model", providerConnectionId, providerConnectionVersion: accountExecutionVersion(account(providerConnectionId)), accountAuthMethod: "api_key", executionChannel: "direct-api", endpointName: "Model", fitnessScore: 1, dimensionScores: {}, costPerOutputMToken: null, excluded: false }));
  return { selectedEndpoint: "endpoint-0", selectedModelId: "model", reason: "test", fitnessScore: 1, fallbackChain: ["endpoint-1"], candidates, excludedCount: 0, excludedReasons: [], policyRulesApplied: [], taskType: "test", sensitivity: "public", timestamp: new Date() };
}
beforeEach(() => { vi.clearAllMocks(); mocks.readAccount.mockImplementation(async ({ where }) => account(where.connectionId)); mocks.call.mockResolvedValue({ content: "Completed", inputTokens: 1, outputTokens: 1, inferenceMs: 1 }); mocks.updateAccount.mockResolvedValue({ count: 1 }); mocks.updateProfile.mockResolvedValue({ count: 1 }); mocks.disable.mockResolvedValue({ attempt: 0 }); });
describe("fallback account isolation", () => {
  it("replays full messages instead of transferring unbound provider response state to another account", async () => {
    const messages = [{ role: "user" as const, content: "Continue the saved task" }];
    await callWithFallbackChain(decision(), messages, "", undefined, undefined, "foreign-response");
    expect(mocks.call.mock.calls[0]![6]).toBeUndefined();
    expect(mocks.call.mock.calls[0]![2]).toEqual(messages);
  });
  it("reuses provider response state only with its proven originating account", async () => {
    await callWithFallbackChain(decision(), [], "", undefined, undefined, "owned-response", undefined, { previousResponseProviderConnectionId: "account-a" });
    expect(mocks.call.mock.calls[0]![6]).toBe("owned-response");
  });
  it("rebuilds after all account selections drift without recording an authentication failure", async () => {
    mocks.readAccount.mockImplementation(async ({ where }) => ({ ...account(where.connectionId), credentialEntryId: "replacement" }));
    await expect(callWithFallbackChain(decision(), [], "")).rejects.toBeInstanceOf(ProviderAccountSelectionChangedError);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });
  it("stops fallback after an uncertain native operation so tool effects cannot be replayed", async () => {
    mocks.call.mockRejectedValueOnce(new NativeCliExecutionUncertainError("codex"));
    await expect(callWithFallbackChain(decision(), [], "")).rejects.toBeInstanceOf(NativeCliExecutionUncertainError);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });
  it("refuses a stale account selection after credential replacement before calling the provider", async () => {
    mocks.readAccount.mockResolvedValueOnce({ ...account("account-a"), credentialEntryId: "replacement" });
    await callWithFallbackChain(decision(), [], "");
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call.mock.calls[0]![5]).toMatchObject({ providerConnectionId: "account-b" });
  });
  it("tries a healthy sibling after account authentication fails without disabling the provider", async () => {
    mocks.call.mockRejectedValueOnce(new InferenceError("Account authentication failed", "auth", "openai"));
    await callWithFallbackChain(decision(), [], "");
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.call.mock.calls[0]![5]).toMatchObject({ providerConnectionId: "account-a" });
    expect(mocks.call.mock.calls[1]![5]).toMatchObject({ providerConnectionId: "account-b" });
    expect(mocks.disable).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
  it("binds an authentication failure write to the credential that actually failed", async () => {
    mocks.call.mockRejectedValueOnce(new InferenceError("Expired authentication", "auth", "openai"));
    await callWithFallbackChain(decision(), [], "");
    expect(mocks.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: "account-a", credentialEntryId: "owned" }),
    }));
  });
  it("removes refused access only from the selected account and preserves the shared model", async () => {
    mocks.call.mockRejectedValueOnce(new InferenceError("Model is unavailable to this account", "model_not_found", "openai"));
    await callWithFallbackChain(decision(), [], "");
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: "account-a", providerId: "openai", credentialEntryId: "owned" }),
      data: { accessibleModelIds: [] },
    }));
  });
  it("does not turn an account-specific model refusal into a shared authentication rule", async () => {
    mocks.call.mockRejectedValueOnce(new InferenceError("Model is not supported when using this account", "model_not_found", "openai"));
    await callWithFallbackChain(decision(), [], "");
    expect(mocks.learn).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
});
