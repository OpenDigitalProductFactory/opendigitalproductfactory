import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { aiProviderConnection: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, modelProvider: { findUnique: vi.fn() } },
  credential: vi.fn(), upsert: vi.fn(), profile: vi.fn(), bearer: vi.fn(), backend: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("./ai-provider-internals", () => ({ getDecryptedCredential: mocks.credential, getProviderBearerToken: mocks.bearer, upsertDiscoveredModels: mocks.upsert, profileModelsInternal: mocks.profile, getProviderExtraHeaders: () => ({}), discoverChatGptBackendModels: mocks.backend }));
import { discoverProviderAccountModels } from "./provider-account-discovery";

describe("account model discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", providerId: "openai", authMethod: "api-key", status: "active", updatedAt: new Date("2026-10-01") });
    mocks.db.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authHeader: "Authorization", baseUrl: "https://api.example.test/v1", families: [], enabledFamilies: [], supportedAuthMethods: ["api_key"] });
    mocks.credential.mockResolvedValue({ secretRef: "key-b" });
    mocks.upsert.mockResolvedValue(1);
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
