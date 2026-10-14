import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  modelProvider: { findUnique: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
  credentialEntry: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(), $queryRaw: vi.fn(),
}));
const oauth = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/provider-oauth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/provider-oauth")>(), refreshOAuthToken: oauth.refresh,
}));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => `enc:${value}` }));
import { getProviderBearerToken } from "./ai-provider-internals";
import { withInferenceCancellation } from "../routing/governed-inference-deadline";
import { ProviderAccountSelectionChangedError } from "../routing/provider-account-candidates";

const revision = new Date("2026-10-14T00:00:00Z");
const credential = { id: "owned", updatedAt: revision, status: "ok", clientId: "fixture-client", clientSecret: "fixture-secret", tokenEndpoint: "https://fixture.invalid/token", cachedToken: null, tokenExpiresAt: null, refreshToken: null, secretRef: null, scope: null };

describe("account workload token persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "workload", authMethod: "oauth2_client_credentials" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a", providerId: "workload", authMethod: "workload-identity",
      status: "active", organizationId: null, updatedAt: revision, credentialEntryId: "owned", credentialEntry: credential });
    db.$transaction.mockImplementation(async run => run(db));
    db.$queryRaw.mockResolvedValue([{ id: "immutable-a" }]);
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

  it("passes encrypted account snapshots to guarded renewal and bypasses cache after upstream rejection", async () => {
    const raw = { ...credential, cachedToken: "enc:cached-fixture", refreshToken: "enc:refresh-fixture",
      tokenExpiresAt: new Date(Date.now() + 86_400_000) };
    const owner = { id: "immutable-a", connectionId: "account-a", providerId: "openai", authMethod: "oauth",
      status: "active", updatedAt: revision, organizationId: null, credentialEntryId: raw.id, credentialEntry: raw };
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authMethod: "oauth2_authorization_code" });
    db.aiProviderConnection.findUnique.mockResolvedValue(owner);
    oauth.refresh.mockResolvedValue({ token: "renewed-owned-token" });
    await expect(getProviderBearerToken("openai", "account-a", undefined, { forceRefresh: true })).resolves.toEqual({ token: "renewed-owned-token" });
    expect(oauth.refresh).toHaveBeenCalledWith("openai", "account-a", undefined, expect.objectContaining({
      signal: expect.any(AbortSignal), connection: expect.objectContaining({ organizationId: null }),
      credential: expect.objectContaining({ cachedToken: "enc:cached-fixture", refreshToken: "enc:refresh-fixture" }),
    }));
  });

  it("renews a JWT whose decoded expiry is past despite an ok credential and future stored date", async () => {
    const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}.fixture`;
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authMethod: "oauth2_authorization_code" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a",
      providerId: "openai", authMethod: "oauth", status: "active", organizationId: null, updatedAt: revision,
      credentialEntryId: credential.id, credentialEntry: { ...credential, cachedToken: token,
        tokenExpiresAt: new Date(Date.now() + 86_400_000), refreshToken: "fixture-refresh" } });
    oauth.refresh.mockResolvedValue({ token: "renewed-owned-token" });
    await expect(getProviderBearerToken("openai", "account-a")).resolves.toEqual({ token: "renewed-owned-token" });
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops cancelled account renewal before any provider or credential call", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Task cancelled"));
    await expect(withInferenceCancellation(controller.signal, () => getProviderBearerToken("openai", "account-a"))).rejects.toThrow("Task cancelled");
    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(db.modelProvider.findUnique).not.toHaveBeenCalled();
  });

  it("never uses the unguarded path when an explicit account's credential owner is inconsistent", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authMethod: "oauth2_authorization_code" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a",
      providerId: "openai", authMethod: "oauth", status: "active", organizationId: null,
      updatedAt: revision, credentialEntryId: "replacement", credentialEntry: { ...credential, status: "expired" } });
    oauth.refresh.mockResolvedValue({ token: "wrong-owner-token" });
    await expect(getProviderBearerToken("openai", "account-a")).rejects.toBeInstanceOf(ProviderAccountSelectionChangedError);
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it.each(["Selected account credential changed", "Selected default changed during renewal"])("rebuilds a selection after %s without treating it as bad credentials", async error => {
    db.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", authMethod: "oauth2_authorization_code" });
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "immutable-a", connectionId: "account-a",
      providerId: "openai", authMethod: "oauth", status: "active", organizationId: null, updatedAt: revision,
      credentialEntryId: credential.id, credentialEntry: { ...credential, status: "expired" } });
    oauth.refresh.mockResolvedValue({ error });
    await expect(getProviderBearerToken("openai", "account-a")).rejects.toBeInstanceOf(ProviderAccountSelectionChangedError);
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("checks the locked workload owner before accepting a token when Disable races the exchange", async () => {
    let reads = 0;
    db.aiProviderConnection.findUnique.mockImplementation(async () => ({ id: "immutable-a", connectionId: "account-a",
      providerId: "workload", authMethod: "workload-identity", credentialEntryId: credential.id,
      status: ++reads >= 3 ? "disabled" : "unconfigured", organizationId: null, updatedAt: revision, credentialEntry: credential }));
    db.credentialEntry.updateMany.mockResolvedValue({ count: 1 });
    await expect(getProviderBearerToken("workload", "account-a")).resolves.toMatchObject({ error: expect.stringContaining("changed") });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });
});
