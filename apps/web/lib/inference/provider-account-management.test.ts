import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  credentialEntry: { create: vi.fn(), update: vi.fn() },
  complianceEvidence: { updateMany: vi.fn() },
  modelProvider: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  aiProviderConnection: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@dpf/db")>(), prisma: db,
  setProviderStatusWithDefaultConnection: (await import("../../../../packages/db/src/provider-connection")).setProviderStatusWithDefaultConnection,
}));
import { ACCOUNT_ACCESS_RESET, addProviderAccount, configureProviderAccount, setProviderAccountEnabled } from "./provider-account-management";
import { reconcileProviderConnectionState } from "./provider-connection-reconcile";
const pause = vi.hoisted(() => ({ resumeLocalProvider: vi.fn() }));
vi.mock("./provider-operator-pause", () => pause);

describe("explicit Anthropic workspace configuration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (run) => run(db));
    db.aiProviderConnection.findUnique.mockResolvedValue({ id: "account-b", providerId: "anthropic", authMethod: "api-key", credentialEntryId: "credential-b" });
  });

  it.each([" wrkspc_accountB ", ""])("writes only the selected credential and resets its proofs (%s)", async (workspace) => {
    expect(await configureProviderAccount({ connectionId: "account-b", providerWorkspaceId: workspace })).toEqual({ ok: true });
    expect(db.credentialEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "credential-b" }, data: expect.objectContaining({ providerWorkspaceId: workspace.trim() || null }) }));
    expect(db.complianceEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerConnectionId: "account-b" }) }));
    expect(db.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: "account-b" }, data: expect.objectContaining({ accessibleModelIds: [], modelsVerifiedAt: null, evidenceStatus: "unreviewed" }) }));
  });

  it("preserves credentials and proofs when workspace is omitted", async () => {
    await configureProviderAccount({ connectionId: "account-b", label: "Renamed" });
    expect(db.credentialEntry.update).not.toHaveBeenCalled();
    expect(db.complianceEvidence.updateMany).not.toHaveBeenCalled();
  });
});

describe("local account operator intent", () => {
  it("clears capacity ownership when replacement credentials invalidate account proof", () => {
    expect(ACCOUNT_ACCESS_RESET).toMatchObject({ capacityStatusId: null, quotaStatusId: null });
  });
  let providerId: string;
  let connectionId: string;
  let providerStatus: string;
  let connectionStatus: string;

  beforeEach(() => {
    vi.resetAllMocks();
    providerId = "local";
    connectionId = "provider-default-local";
    providerStatus = connectionStatus = "active";
    db.aiProviderConnection.findUnique.mockImplementation(async () => ({ connectionId, providerId, status: connectionStatus, credentialEntry: null }));
    db.modelProvider.update.mockImplementation(async ({ data }) => { providerStatus = data.status; });
    db.aiProviderConnection.update.mockImplementation(async ({ data }) => { connectionStatus = data.status; });
    db.aiProviderConnection.updateMany.mockImplementation(async ({ where, data }) => {
      const matches = connectionStatus === where.status && connectionId.startsWith(where.connectionId.startsWith)
        && providerStatus === where.provider.status;
      if (matches) connectionStatus = data.status;
      return { count: matches ? 1 : 0 };
    });
    db.$transaction.mockImplementation(async (run) => run(db));
  });

  it.each(["local", "ollama"])("keeps an operator-disabled %s default account stopped through boot reconciliation", async (id) => {
    providerId = id;
    connectionId = `provider-default-${id}`;
    expect(await setProviderAccountEnabled(connectionId, false)).toEqual({ ok: true });
    await reconcileProviderConnectionState();
    expect(providerStatus).toBe("inactive");
    expect(connectionStatus).toBe("inactive");
  });

  it("allows explicit resumption of a default local runtime without a credential", async () => {
    providerStatus = connectionStatus = "inactive";
    expect(await setProviderAccountEnabled(connectionId, true)).toEqual({ ok: true });
    expect(providerStatus).toBe("active");
    expect(connectionStatus).toBe("active");
  });

  it("does not bypass the pause health check when the native account control resumes", async () => {
    providerStatus = "inactive";
    connectionStatus = "paused";
    pause.resumeLocalProvider.mockResolvedValue({ outcome: "resumed", status: "inactive" });
    expect(await setProviderAccountEnabled(connectionId, true)).toEqual({ ok: true });
    expect(pause.resumeLocalProvider).toHaveBeenCalledWith({ providerId: "local" });
    expect(providerStatus).toBe("inactive");
  });

  it("disables a separate account without disabling its whole provider", async () => {
    connectionId = "provider-account-secondary";
    expect(await setProviderAccountEnabled(connectionId, false)).toEqual({ ok: true });
    await reconcileProviderConnectionState();
    expect(connectionStatus).toBe("disabled");
    expect(providerStatus).toBe("active");
  });
  it("activates a first configured account only across the provider's unconfigured boundary", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-a", providerId: "openai", status: "unconfigured", credentialEntry: { status: "ok" } });
    db.modelProvider.updateMany.mockResolvedValue({ count: 1 });
    await setProviderAccountEnabled("account-a", true);
    expect(db.modelProvider.updateMany).toHaveBeenCalledWith({ where: { providerId: "openai", status: "unconfigured" }, data: { status: "active" } });
  });
  it.each([
    ["chatgpt", "oauth2_authorization_code", "direct-api", "direct-api"],
    ["codex", "api_key", "subscription-cli", "subscription-cli"],
    ["anthropic-sub", "api_key", "subscription-cli", "direct-api"],
  ])("uses the supported execution channel for %s %s rather than inferring it from OAuth", async (id, method, defaultChannel, expectedChannel) => {
    db.modelProvider.findUnique.mockResolvedValue({ providerId: id, supportedAuthMethods: [method] });
    db.aiProviderConnection.findUnique.mockResolvedValue({ executionChannel: defaultChannel });
    db.credentialEntry.create.mockResolvedValue({ id: "private-credential" });
    await addProviderAccount({ providerId: id, label: "Second account", authMethod: method });
    expect(db.aiProviderConnection.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionChannel: expectedChannel }) }));
  });
});
