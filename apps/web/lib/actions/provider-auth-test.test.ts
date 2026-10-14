import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRefreshOAuthToken, mockGetProviderBearerToken, mockActivateProvider, mockClearCapacity } = vi.hoisted(() => ({
  mockPrisma: {
    modelProvider: { findUnique: vi.fn() },
    modelProfile: { findFirst: vi.fn() },
    credentialEntry: { findUnique: vi.fn(), update: vi.fn() },
    aiProviderConnection: { findUnique: vi.fn(), updateMany: vi.fn() },
    providerCapacityStatus: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  mockRefreshOAuthToken: vi.fn(),
  mockGetProviderBearerToken: vi.fn(),
  mockActivateProvider: vi.fn(),
  mockClearCapacity: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: mockRefreshOAuthToken }));
vi.mock("@/lib/govern/activate-provider", () => ({ activateProvider: mockActivateProvider }));
vi.mock("@/lib/routing/provider-capacity/store", () => ({ clearProviderCapacityStatus: mockClearCapacity }));
vi.mock("@/lib/ai-provider-internals", () => ({
  getProviderBearerToken: mockGetProviderBearerToken,
  getDecryptedCredential: vi.fn(),
  getProviderExtraHeaders: () => ({}),
  isAnthropicProvider: () => false,
  ANTHROPIC_OAUTH_BETA_HEADERS: "",
}));
import { testProviderAuthInternal as testProviderAuth } from "./provider-auth-test";

describe("expired OAuth verification recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.providerCapacityStatus.findUnique.mockReset().mockResolvedValue(null);
    mockPrisma.providerCapacityStatus.updateMany.mockReset().mockResolvedValue({ count: 1 });
    mockPrisma.modelProfile.findFirst.mockResolvedValue({ modelId: "discovered-current-model" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n')));
  });
  afterEach(() => vi.unstubAllGlobals());
  function expiredSubscription() {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue(null);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "chatgpt", baseUrl: "https://chatgpt.com/backend-api", authMethod: "oauth2_authorization_code",
      category: "direct", families: [], enabledFamilies: [], supportedAuthMethods: [],
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "stale-token" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ status: "ok", cachedToken: "encrypted" });
    mockRefreshOAuthToken.mockReset().mockResolvedValue({ token: "renewed-token" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 }));
  }

  it("renews a rejected default ChatGPT token through Codex and verifies the retry", async () => {
    expiredSubscription();
    expect(await testProviderAuth("chatgpt", false)).toMatchObject({ ok: true });
    expect(mockRefreshOAuthToken).toHaveBeenCalledExactlyOnceWith("codex", undefined);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(call => (call[1]?.headers as Record<string, string>).Authorization))
      .toEqual(["Bearer stale-token", "Bearer renewed-token"]);
    expect(mockClearCapacity).toHaveBeenCalledTimes(1);
  });

  it("offers shared sign-in recovery when token renewal fails", async () => {
    expiredSubscription();
    mockRefreshOAuthToken.mockResolvedValue({ error: "Re-authentication required" });
    expect(await testProviderAuth("chatgpt", false)).toMatchObject({ ok: false, message: expect.stringContaining("Manage sign-in") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockActivateProvider).not.toHaveBeenCalled();
    expect(mockClearCapacity).not.toHaveBeenCalled();
  });

  it("stops after one renewal when OpenAI rejects the renewed token", async () => {
    expiredSubscription();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 }));
    expect(await testProviderAuth("chatgpt", false)).toMatchObject({ ok: false, message: expect.stringContaining("sign in again") });
    expect(mockRefreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockClearCapacity).not.toHaveBeenCalled();
  });

  it.each(["invalid_api_key", "insufficient_scope", "malformed"])("never refreshes an unrelated 401 (%s)", async (code) => {
    expiredSubscription();
    vi.mocked(fetch).mockReset().mockResolvedValue(new Response(code === "malformed" ? "token_expired" : JSON.stringify({ error: { code } }), { status: 401 }));
    expect(await testProviderAuth("chatgpt", false)).toMatchObject({ ok: false });
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit ChatGPT renewal on the selected account", async () => {
    expiredSubscription();
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "chatgpt", connectionId: "account-b", credentialEntryId: "credential-b", authMethod: "oauth",
      status: "active", updatedAt: new Date("2026-10-01"), credentialEntry: { id: "credential-b", status: "ok", cachedToken: "encrypted" },
    });
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    Object.assign(mockPrisma, { $transaction: async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma) });
    expect(await testProviderAuth("chatgpt", false, "account-b")).toMatchObject({ ok: true });
    expect(mockRefreshOAuthToken).toHaveBeenCalledExactlyOnceWith("chatgpt", "account-b");
    expect(mockPrisma.credentialEntry.update).toHaveBeenCalledWith({ where: { id: "credential-b" }, data: { status: "ok" } });
    expect(mockClearCapacity).not.toHaveBeenCalled();
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  function restoredDefaultAccount() {
    expiredSubscription();
    vi.mocked(fetch).mockReset().mockResolvedValue(new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n'));
    const version = new Date("2026-10-14T04:00:00Z");
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "chatgpt", connectionId: "provider-default-chatgpt", credentialEntryId: "credential-default", authMethod: "oauth",
      status: "active", updatedAt: version, credentialEntry: { id: "credential-default", status: "ok", cachedToken: "encrypted" },
    });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ id: "credential-default", status: "ok", cachedToken: "encrypted", providerConnection: { connectionId: "provider-default-chatgpt" } });
    mockPrisma.providerCapacityStatus.findUnique.mockResolvedValue({
      id: "old-capacity", providerId: "chatgpt", state: "quota_resets_at", updatedAt: version,
      providerConnection: null,
    });
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.providerCapacityStatus.updateMany.mockResolvedValue({ count: 1 });
    Object.assign(mockPrisma, { $transaction: async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma) });
    return version;
  }

  it("reconciles the selected default account's stale quota after completed verification", async () => {
    const version = restoredDefaultAccount();
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({ ok: true });
    expect(mockPrisma.providerCapacityStatus.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "old-capacity", providerId: "chatgpt", updatedAt: version }),
      data: expect.objectContaining({ state: "available", source: "oauth", retryAt: null }),
    }));
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 429, 500])("retains the selected account's quota after HTTP %s", async (status) => {
    restoredDefaultAccount();
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":{"code":"provider_rejected"}}', { status }));
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({ ok: false });
    expect(mockPrisma.providerCapacityStatus.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(mockRefreshOAuthToken).not.toHaveBeenCalled();
  });

  it.each(["network", "timeout", "incomplete"])("retains quota after %s verification failure", async (failure) => {
    restoredDefaultAccount();
    if (failure === "incomplete") vi.mocked(fetch).mockResolvedValue(new Response('data: {"type":"response.in_progress"}\n'));
    else vi.mocked(fetch).mockRejectedValue(new Error(failure));
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({ ok: false });
    expect(mockPrisma.providerCapacityStatus.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });

  it("retains quota when the selected connection changes during verification", async () => {
    restoredDefaultAccount();
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 0 });
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
    expect(mockPrisma.providerCapacityStatus.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.credentialEntry.update).not.toHaveBeenCalled();
  });

  it("reports local quota-reader failure before sending paid provider work", async () => {
    restoredDefaultAccount();
    mockPrisma.providerCapacityStatus.findUnique.mockRejectedValue(new Error("quota store unavailable"));
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({
      ok: false, message: expect.stringContaining("No provider verification request was sent"),
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mockPrisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.providerCapacityStatus.updateMany).not.toHaveBeenCalled();
  });

  it("reports successful authentication separately from a changed routing restriction", async () => {
    restoredDefaultAccount();
    mockPrisma.providerCapacityStatus.updateMany.mockResolvedValue({ count: 0 });
    expect(await testProviderAuth("chatgpt", false, "provider-default-chatgpt")).toMatchObject({
      ok: true, message: expect.stringContaining("Routing status changed during verification"),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

});

