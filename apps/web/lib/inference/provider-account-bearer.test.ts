import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  modelProvider: { findUnique: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
  credentialEntry: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
const oauth = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: oauth.refresh }));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => `enc:${value}` }));
import { getProviderBearerToken } from "./ai-provider-internals";

const revision = new Date("2026-10-14T00:00:00Z");
const credential = { id: "owned", updatedAt: revision, status: "ok", clientId: "fixture-client", clientSecret: "fixture-secret", tokenEndpoint: "https://fixture.invalid/token", cachedToken: null, tokenExpiresAt: null, refreshToken: null, secretRef: null, scope: null };

describe("account workload token persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "workload", authMethod: "oauth2_client_credentials" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-a", providerId: "workload", authMethod: "workload-identity", credentialEntryId: "owned", credentialEntry: credential });
    db.credentialEntry.update.mockResolvedValue({});
    db.credentialEntry.updateMany.mockResolvedValue({ count: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "fixture-token", expires_in: 3600 }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to overwrite replacement credentials after the token exchange", async () => {
    await expect(getProviderBearerToken("workload", "account-a")).resolves.toMatchObject({ error: expect.stringContaining("changed") });
    expect(db.credentialEntry.update).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "owned", updatedAt: revision,
      providerConnection: { is: expect.objectContaining({ connectionId: "account-a", providerId: "workload", credentialEntryId: "owned" }) },
    }) }));
  });

  it("renews an expired credential even when its stored token expiry is in the future", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authMethod: "oauth2_authorization_code" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a",
      providerId: "openai", authMethod: "oauth", status: "active", organizationId: null,
      updatedAt: revision, credentialEntryId: "owned", credentialEntry: {
        ...credential, status: "expired", cachedToken: "rejected-cached-token",
        tokenExpiresAt: new Date(Date.now() + 86_400_000), refreshToken: "fixture-refresh",
      } });
    oauth.refresh.mockResolvedValue({ token: "renewed-owned-token" });
    await expect(getProviderBearerToken("openai", "account-a")).resolves.toEqual({ token: "renewed-owned-token" });
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it("allows explicit initial workload authentication without enabling the account before verification", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a",
      providerId: "workload", authMethod: "workload-identity", credentialEntryId: "owned",
      status: "unconfigured", updatedAt: revision, credentialEntry: { ...credential, status: "pending" } });
    db.credentialEntry.updateMany.mockImplementation(async ({ where }) => ({
      count: where.providerConnection.is.status === "unconfigured"
        && where.providerConnection.is.updatedAt === revision ? 1 : 0,
    }));
    await expect(getProviderBearerToken("workload", "account-a")).resolves.toEqual({ token: "fixture-token" });
    expect(db.credentialEntry.update).not.toHaveBeenCalled();
  });

  it("does not exchange a workload token for a disabled account", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-a", providerId: "workload",
      authMethod: "workload-identity", credentialEntryId: "owned", status: "disabled",
      updatedAt: revision, credentialEntry: credential });
    await expect(getProviderBearerToken("workload", "account-a")).resolves.toMatchObject({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });
});
