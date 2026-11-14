import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getProviderBearerToken: vi.fn(), discoverChatGptBackendModels: vi.fn(),
  upsertDiscoveredModels: vi.fn(), reconcileDiscoveredModelPresence: vi.fn(),
  readmitListedModels: vi.fn(), discoverCodexCliModels: vi.fn(),
}));
vi.mock("@/lib/inference/ai-provider-internals", () => mocks);
vi.mock("./codex-cli-catalog-auth", () => mocks);
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
    const agent = { providerId: "codex-like-agent", authMethod: input.authMethod };
    expect(await discoverViaChatGptBackend(agent)).toEqual({ discovered: 1, newCount: 1, modelIds: [models[0].modelId] });
    expect(mocks.upsertDiscoveredModels).toHaveBeenCalledWith(agent.providerId, models);
    expect(mocks.reconcileDiscoveredModelPresence).toHaveBeenCalledWith(agent.providerId, new Set([models[0].modelId]));
    expect(mocks.readmitListedModels).toHaveBeenCalledWith(agent.providerId, input.authMethod, [models[0].modelId]);
  });
  it("routes chatgpt on its own Codex catalog even when the consumer endpoint lists app-only models (BI-F0ECD797)", async () => {
    mocks.discoverChatGptBackendModels.mockResolvedValue({ models: [{ modelId: "gpt-6.1-sol-wm", rawMetadata: {} }] });
    mocks.discoverCodexCliModels.mockResolvedValue([{ modelId: "gpt-6.1-sol", rawMetadata: {} }]);
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ discovered: 1, modelIds: ["gpt-6.1-sol"] });
    expect(mocks.discoverChatGptBackendModels).not.toHaveBeenCalled();
    expect(mocks.discoverCodexCliModels).toHaveBeenCalledWith("chatgpt");
    expect(mocks.upsertDiscoveredModels).toHaveBeenCalledWith("chatgpt", [{ modelId: "gpt-6.1-sol", rawMetadata: {} }]);
    expect(mocks.reconcileDiscoveredModelPresence).toHaveBeenCalledWith("chatgpt", new Set(["gpt-6.1-sol"]));
  });
  it("preserves the catalog when the Codex catalog provides no inventory", async () => {
    mocks.discoverCodexCliModels.mockResolvedValue([]);
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ discovered: 0, newCount: 0, error: expect.stringContaining("no models") });
    expect(mocks.upsertDiscoveredModels).not.toHaveBeenCalled();
    expect(mocks.reconcileDiscoveredModelPresence).not.toHaveBeenCalled();
  });
  it("does not change inventory on an auth failure", async () => {
    mocks.discoverCodexCliModels.mockRejectedValue(new Error("Selected account authentication failed — reconnect this account"));
    expect(await discoverViaChatGptBackend(input)).toMatchObject({ error: expect.stringContaining("reconnect this account") });
    expect(mocks.upsertDiscoveredModels).not.toHaveBeenCalled();
    expect(mocks.reconcileDiscoveredModelPresence).not.toHaveBeenCalled();
  });
});
