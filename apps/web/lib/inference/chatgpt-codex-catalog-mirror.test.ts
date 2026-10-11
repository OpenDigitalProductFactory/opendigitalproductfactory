import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getProviderBearerToken: vi.fn(), discoverChatGptBackendModels: vi.fn(),
  upsertDiscoveredModels: vi.fn(), reconcileDiscoveredModelPresence: vi.fn(),
  readmitListedModels: vi.fn(), discoverCodexCliModels: vi.fn(),
}));
vi.mock("@/lib/inference/ai-provider-internals", () => mocks);
vi.mock("@/lib/routing/codex-cli-model-catalog", () => mocks);
import { discoverViaChatGptBackend } from "./chatgpt-codex-catalog-mirror";
const input = { providerId: "chatgpt", authMethod: "oauth2_authorization_code" };
describe("subscription catalog lifecycle (BI-59E37E39)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getProviderBearerToken.mockResolvedValue({ token: "test-token" });
    mocks.upsertDiscoveredModels.mockResolvedValue(1);
    mocks.reconcileDiscoveredModelPresence.mockResolvedValue(undefined);
    mocks.readmitListedModels.mockResolvedValue(undefined);
  });
  it("admits a previously unknown returned model and reconciles HTTP inventory like CLI inventory", async () => {
    const models = [{ modelId: "future-model-without-code-change", rawMetadata: { source: "chatgpt_backend_discovery" } }];
    mocks.discoverChatGptBackendModels.mockResolvedValue({ models });
    expect(await discoverViaChatGptBackend(input)).toEqual({ discovered: 1, newCount: 1, modelIds: [models[0].modelId] });
    expect(mocks.upsertDiscoveredModels).toHaveBeenCalledWith("chatgpt", models);
    expect(mocks.reconcileDiscoveredModelPresence).toHaveBeenCalledWith("chatgpt", new Set([models[0].modelId]));
    expect(mocks.readmitListedModels).toHaveBeenCalledWith("chatgpt", input.authMethod, [models[0].modelId]);
  });
  it("falls back to execution-channel inventory on an empty consumer response", async () => {
    mocks.discoverChatGptBackendModels.mockResolvedValue({ models: [] });
    mocks.discoverCodexCliModels.mockResolvedValue([{ modelId: "cli-current", rawMetadata: {} }]);
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ discovered: 1, modelIds: ["cli-current"] });
    expect(mocks.upsertDiscoveredModels).toHaveBeenCalledWith("chatgpt", [{ modelId: "cli-current", rawMetadata: {} }]);
  });
  it("preserves the catalog when neither source provides an inventory", async () => {
    mocks.discoverChatGptBackendModels.mockResolvedValue({ models: [], error: "HTTP 403" });
    mocks.discoverCodexCliModels.mockResolvedValue([]);
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ discovered: 0, newCount: 0, error: expect.stringContaining("no models") });
    expect(mocks.upsertDiscoveredModels).not.toHaveBeenCalled();
    expect(mocks.reconcileDiscoveredModelPresence).not.toHaveBeenCalled();
  });
  it("does not change inventory on an auth failure", async () => {
    mocks.getProviderBearerToken.mockResolvedValue({ error: "Reconnect required" });
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ error: "Reconnect required" });
    expect(mocks.discoverChatGptBackendModels).not.toHaveBeenCalled();
    expect(mocks.upsertDiscoveredModels).not.toHaveBeenCalled();
  });
});
