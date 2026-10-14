import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountExecutionVersion } from "../routing/provider-account-candidates";
import type { RoutedExecutionPlan } from "../routing/recipe-types";

const mock = vi.hoisted(() => ({ account: vi.fn(), credential: vi.fn(), execute: vi.fn(), acquire: vi.fn(), release: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: vi.fn(async () => ({ providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization", baseUrl: "https://api.openai.com/v1", endpoint: null })) },
  aiProviderConnection: { findUnique: mock.account },
} }));
vi.mock("@/lib/ai-provider-internals", () => ({ getDecryptedCredential: mock.credential, getProviderBearerToken: vi.fn(), getProviderExtraHeaders: () => ({}), isAnthropicProvider: () => false, ANTHROPIC_OAUTH_BETA_HEADERS: "oauth" }));
vi.mock("@/lib/metrics", () => ({ aiInferenceDuration: { startTimer: () => () => {} }, aiInferenceTokens: { inc: vi.fn() }, aiInferenceErrors: { inc: vi.fn() }, aiInferenceCostUsd: { inc: vi.fn() }, aiCacheCreationTokens: { inc: vi.fn() }, aiCacheReadTokens: { inc: vi.fn() } }));
vi.mock("./inference-admission", async (importOriginal) => ({ ...await importOriginal<typeof import("./inference-admission")>(), acquireInferenceSlot: mock.acquire, currentInferenceOrigin: () => "interactive", engineKeyForProvider: () => "remote" }));
vi.mock("./host-gpu-admission", () => ({ assertLocalGpuFree: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertProviderDispatchCapacity: vi.fn() }));
vi.mock("@/lib/queue/resource-lane", () => ({ withLocalInferenceLock: async (run: () => Promise<unknown>) => run() }));
vi.mock("../routing/execution-adapter-registry", () => ({ getExecutionAdapter: () => ({ execute: mock.execute }), registerExecutionAdapter: vi.fn() }));
vi.mock("../routing/adapter-telemetry-writer", () => ({ writeAdapterTelemetry: vi.fn(async () => {}) }));
vi.mock("../routing/provider-capacity/store", async importOriginal => ({ ...await importOriginal<typeof import("../routing/provider-capacity/store")>(), clearProviderCapacityStatus: vi.fn(async () => {}), recordProviderCapacityStatus: vi.fn(async () => {}) }));
import { callProvider } from "./ai-inference";
import { prisma } from "@dpf/db";
import { clearProviderCapacityStatus } from "../routing/provider-capacity/store";

function account(connectionId: string) {
  return { id: `immutable-${connectionId}`, connectionId, providerId: "openai", status: "active", authMethod: "api-key", executionChannel: "direct-api", credentialEntryId: `credential-${connectionId}`, credentialEntry: { id: `credential-${connectionId}`, status: "ok", updatedAt: new Date("2026-10-14T00:00:00Z"), secretRef: "encrypted-fixture", cachedToken: null, refreshToken: null }, accessibleModelIds: ["model"], modelsVerifiedAt: new Date("2026-10-14T00:00:00Z"), evidenceStatus: "unreviewed" };
}
function plan(connectionId: string): RoutedExecutionPlan {
  return { providerId: "openai", modelId: "model", providerConnectionId: connectionId, providerConnectionVersion: accountExecutionVersion(account(connectionId)), accountAuthMethod: "api_key", executionChannel: "direct-api", executionAdapter: "chat", recipeId: null, contractFamily: "summarization", maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.account.mockReset();
  mock.credential.mockReset();
  mock.acquire.mockReset();
  vi.mocked(prisma.modelProvider.findUnique).mockReset().mockResolvedValue({ providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization", baseUrl: "https://api.openai.com/v1", endpoint: null } as never);
  mock.account.mockImplementation(async ({ where }) => account(where.connectionId));
  mock.credential.mockImplementation(async (_provider, connectionId) => ({ id: `credential-${connectionId}`, secretRef: `fake-${connectionId ?? "default"}` }));
  mock.acquire.mockResolvedValue(mock.release);
  mock.execute.mockResolvedValue({ text: "done", toolCalls: [], inferenceMs: 1, usage: { inputTokens: 1, outputTokens: 1 } });
});
describe("selected account dispatch", () => {
  it("retains shared local capacity recovery for its no-credential default", async () => {
    const local = { ...account("provider-default-local"), providerId: "local", authMethod: "local", executionChannel: "local-runtime", credentialEntryId: null, credentialEntry: null };
    mock.account.mockResolvedValue(local);
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ providerId: "local", status: "active", authMethod: "none", baseUrl: "http://fixture.invalid/v1" } as never);
    const localPlan = { ...plan(local.connectionId), providerId: "local", providerConnectionVersion: accountExecutionVersion(local), accountAuthMethod: "none" };
    await callProvider("local", "model", [], "public fixture", undefined, localPlan);
    expect(clearProviderCapacityStatus).toHaveBeenCalledWith({ providerId: "local", source: "api" });
    expect(mock.credential).not.toHaveBeenCalled();
  });
  it("refuses an explicitly empty account instead of selecting the default", async () => {
    await expect(callProvider("openai", "model", [], "public fixture", undefined, plan(""))).rejects.toThrow(/account/i);
    expect(mock.credential).not.toHaveBeenCalled();
  });
  it("uses distinct selected credentials for simultaneous requests to one provider", async () => {
    await Promise.all(["a", "b"].map(id => callProvider("openai", "model", [], "public fixture", undefined, plan(id))));
    expect(mock.credential).toHaveBeenCalledWith("openai", "a", plan("a").providerConnectionVersion);
    expect(mock.credential).toHaveBeenCalledWith("openai", "b", plan("b").providerConnectionVersion);
    expect(mock.execute.mock.calls.map(([request]) => request.provider.headers.Authorization).sort()).toEqual(["Bearer fake-a", "Bearer fake-b"]);
  });
  it("refuses a missing explicit account without reading the default credential", async () => {
    mock.account.mockResolvedValue(null);
    await expect(callProvider("openai", "model", [], "public fixture", undefined, plan("missing"))).rejects.toThrow(/account/i);
    expect(mock.credential).not.toHaveBeenCalled();
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it("rechecks the selected account after admission and releases the slot on replacement", async () => {
    mock.acquire.mockImplementationOnce(async () => {
      mock.account.mockImplementation(async ({ where }) => ({ ...account(where.connectionId), credentialEntryId: "replacement" }));
      return mock.release;
    });
    await expect(callProvider("openai", "model", [], "public fixture", undefined, plan("a"))).rejects.toThrow(/account.*changed/i);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(mock.release).toHaveBeenCalledOnce();
  });
});
