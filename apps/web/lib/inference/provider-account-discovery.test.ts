import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { aiProviderConnection: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, modelProvider: { findUnique: vi.fn() } },
  credential: vi.fn(), upsert: vi.fn(), profile: vi.fn(), bearer: vi.fn(), backend: vi.fn(), cli: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("./ai-provider-internals", () => ({ getDecryptedCredential: mocks.credential, getProviderBearerToken: mocks.bearer, upsertDiscoveredModels: mocks.upsert, profileModelsInternal: mocks.profile, getProviderExtraHeaders: () => ({}), discoverChatGptBackendModels: mocks.backend }));
vi.mock("./codex-cli-catalog-auth", () => ({ discoverCodexCliModels: mocks.cli }));
import { discoverProviderAccountModels } from "./provider-account-discovery";

describe("account model discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", providerId: "openai", authMethod: "api-key", status: "active", updatedAt: new Date("2026-10-01") });
    mocks.db.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authHeader: "Authorization", baseUrl: "https://api.example.test/v1", families: [], enabledFamilies: [], supportedAuthMethods: ["api_key"] });
    mocks.credential.mockResolvedValue({ secretRef: "key-b" });
    mocks.upsert.mockResolvedValue(1);
    mocks.backend.mockResolvedValue({ models: [{ modelId: "wrong-api-catalog", rawMetadata: {} }] });
    mocks.profile.mockResolvedValue({ profiled: 1, failed: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "model-b" }] }) }));
  });

  it("uses the selected credential and records availability on only that account", async () => {
    expect(await discoverProviderAccountModels("account-b")).toEqual({ ok: true, data: { modelIds: ["model-b"] } });
    expect(mocks.credential).toHaveBeenCalledWith("openai", "account-b");
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/v1/models", expect.objectContaining({ headers: { Authorization: "Bearer key-b" } }));
    expect(mocks.db.aiProviderConnection.updateMany).toHaveBeenCalledWith({ where: { connectionId: "account-b", updatedAt: new Date("2026-10-01"), status: { not: "disabled" } }, data: { accessibleModelIds: ["model-b"], modelsVerifiedAt: expect.any(Date) } });
    expect(mocks.profile).toHaveBeenCalledWith("openai", ["model-b"]);
  });

  it("sends the selected Anthropic account's workspace during discovery", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", providerId: "anthropic", authMethod: "api-key", status: "active", updatedAt: new Date("2026-10-01") });
    mocks.db.modelProvider.findUnique.mockResolvedValue({ providerId: "anthropic", authHeader: "x-api-key", baseUrl: "https://api.anthropic.com/v1" });
    mocks.credential.mockResolvedValue({ secretRef: "key-b", providerWorkspaceId: "wrkspc_accountB" });
    expect((await discoverProviderAccountModels("account-b")).ok).toBe(true);
    expect(mocks.credential).toHaveBeenCalledWith("anthropic", "account-b");
    expect(fetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", expect.objectContaining({ headers: { "x-api-key": "key-b", "anthropic-workspace-id": "wrkspc_accountB" } }));
  });

  it.each(["codex", "chatgpt"])("discovers %s subscription models through the selected account CLI context", async (providerId) => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", providerId, authMethod: "oauth", executionChannel: "subscription-cli", status: "active", updatedAt: new Date("2026-10-01") });
    mocks.bearer.mockResolvedValue({ token: "account-b-token" });
    mocks.cli.mockResolvedValue([{ modelId: "subscription-model", rawMetadata: { source: "codex_cli_model_list" } }]);
    expect(await discoverProviderAccountModels("account-b")).toEqual({ ok: true, data: { modelIds: ["subscription-model"] } });
    expect(mocks.cli).toHaveBeenCalledWith(providerId, "account-b");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.backend).not.toHaveBeenCalled();
  });

  it("preserves model-access proof when the selected subscription CLI fails", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", providerId: "codex", authMethod: "oauth", status: "active" });
    mocks.bearer.mockResolvedValue({ token: "account-b-token" });
    mocks.cli.mockRejectedValue(new Error("Selected account model discovery failed"));
    expect(await discoverProviderAccountModels("account-b")).toEqual({ ok: false, error: "Selected account model discovery failed" });
    expect(mocks.db.aiProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(["local", "ollama"])("discovers credentialless %s inventory without enabling an inactive account", async (providerId) => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({
      connectionId: "local-account", providerId, authMethod: "local", status: "inactive",
      updatedAt: new Date("2026-10-01"),
    });
    mocks.db.modelProvider.findUnique.mockResolvedValue({
      providerId, authMethod: "none", authHeader: null,
      baseUrl: providerId === "ollama" ? "http://ollama.example.test" : "http://model-runner.example.test/v1",
      families: [], enabledFamilies: [],
      supportedAuthMethods: ["none"],
    });
    mocks.bearer.mockResolvedValue({ error: "No credential configured" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => providerId === "ollama"
      ? { models: [{ name: "model-b" }] }
      : { data: [{ id: "model-b" }] } }));

    expect(await discoverProviderAccountModels("local-account")).toEqual({
      ok: true, data: { modelIds: ["model-b"] },
    });
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.bearer).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(providerId === "ollama"
      ? "http://ollama.example.test/api/tags" : "http://model-runner.example.test/v1/models",
    expect.objectContaining({ headers: {} }));
    expect(mocks.db.aiProviderConnection.updateMany).toHaveBeenCalledWith({
      where: { connectionId: "local-account", updatedAt: new Date("2026-10-01"), status: { not: "disabled" } },
      data: { accessibleModelIds: ["model-b"], modelsVerifiedAt: expect.any(Date) },
    });
  });

  it.each(["openai", "unknown-provider"])("does not trust %s account's local auth label to skip credentials", async (providerId) => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({
      connectionId: "cloud-account", providerId, authMethod: "local", status: "active",
    });
    mocks.bearer.mockResolvedValue({ error: "No credential configured" });
    expect(await discoverProviderAccountModels("cloud-account")).toEqual({ ok: false, error: "No credential configured" });
    expect(mocks.bearer).toHaveBeenCalledWith(providerId, "cloud-account");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.db.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });

  it("does not replace account entitlements with an unsuccessful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect((await discoverProviderAccountModels("account-b")).ok).toBe(false);
    expect(mocks.db.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });

  it("excludes disabled accounts from discovery", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "openai", status: "disabled" });
    expect((await discoverProviderAccountModels("account-b")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not record a stale discovery after an account is changed or disabled", async () => {
    mocks.db.aiProviderConnection.updateMany.mockResolvedValue({ count: 0 });
    expect(await discoverProviderAccountModels("account-b")).toEqual({ ok: false, error: "Account changed during discovery — retry with its current credentials" });
  });
});
