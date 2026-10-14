import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    modelProvider: { findUnique: vi.fn() }, modelProfile: { findFirst: vi.fn() },
    aiProviderConnection: { findUnique: vi.fn(), updateMany: vi.fn() },
    credentialEntry: { findUnique: vi.fn(), update: vi.fn() }, $transaction: vi.fn(),
  }, activate: vi.fn(), bearer: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/govern/activate-provider", () => ({ activateProvider: mocks.activate }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: mocks.refresh }));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: (value: string) => value.replace("enc:", "") }));
vi.mock("@/lib/ai-provider-internals", () => ({ getProviderBearerToken: mocks.bearer, getDecryptedCredential: vi.fn(), getProviderExtraHeaders: () => ({}), isAnthropicProvider: () => false, ANTHROPIC_OAUTH_BETA_HEADERS: "" }));
import { testProviderAuthInternal } from "./provider-auth-test";

describe("verification-only subscription effects", () => {
  const credential = { id: "owned", status: "ok", cachedToken: "enc:token", tokenExpiresAt: new Date("2099-01-01") };
  const account = { connectionId: "provider-default-codex", providerId: "codex", organizationId: null, status: "active", authMethod: "oauth", credentialEntryId: "owned", updatedAt: new Date("2026-10-01"), credentialEntry: credential };
  const verify = () => testProviderAuthInternal("codex", false, account.connectionId, { verificationOnly: true });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.modelProvider.findUnique.mockResolvedValue({ providerId: "codex", category: "agent", baseUrl: "https://chatgpt.com/backend-api", authMethod: "oauth2_authorization_code", families: [], enabledFamilies: [], supportedAuthMethods: [] });
    mocks.prisma.aiProviderConnection.findUnique.mockResolvedValue(account);
    mocks.prisma.credentialEntry.findUnique.mockResolvedValue(credential);
    mocks.prisma.modelProfile.findFirst.mockResolvedValue({ modelId: "current-model" });
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.$transaction.mockImplementation(async fn => fn(mocks.prisma));
    mocks.bearer.mockResolvedValue({ token: "token" });
    mocks.refresh.mockReset().mockResolvedValue({ token: "renewed" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n')));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("checks a completed response without activation or authentication writes", async () => {
    expect(await verify()).toMatchObject({ ok: true });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.credentialEntry.update).not.toHaveBeenCalled();
  });
  it.each(["inactive", "disabled", "disconnected"])("cannot enable a %s account", async status => {
    mocks.prisma.aiProviderConnection.findUnique.mockResolvedValue({ ...account, status });
    expect(await verify()).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });
  it("rejects an account changed while its probe runs without writing either account", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      mocks.prisma.aiProviderConnection.findUnique.mockResolvedValue({ ...account, credentialEntryId: "replacement", updatedAt: new Date("2026-10-02") });
      return new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n');
    });
    expect(await verify()).toMatchObject({ ok: false, message: expect.stringContaining("changed") });
    expect(mocks.prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.credentialEntry.update).not.toHaveBeenCalled();
  });
  it("pins upstream-expiry renewal to the same active account snapshot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 }));
    expect(await verify()).toMatchObject({ ok: true });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("codex", account.connectionId, {
      connectionId: account.connectionId, providerId: "codex", credentialEntryId: "owned", updatedAt: account.updatedAt,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });
  it("stops after a rejected ownership guard without another probe", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 }));
    mocks.refresh.mockResolvedValue({ error: "Account changed during verification — retry with its current credentials" });
    expect(await verify()).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.credentialEntry.update).not.toHaveBeenCalled();
  });
});
