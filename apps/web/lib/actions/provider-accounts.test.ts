import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  db: {
    modelProvider: { findUnique: vi.fn() },
    aiProviderConnection: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    credentialEntry: { create: vi.fn(), update: vi.fn() },
    complianceEvidence: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.guard }));
vi.mock("@/lib/credential-crypto", () => ({ encryptSecret: (value: string) => `encrypted:${value}` }));
import { addProviderAccount, configureProviderAccount, setProviderAccountEnabled } from "./provider-accounts";

describe("provider account lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({ userId: "operator" });
    mocks.db.$transaction.mockImplementation((fn) => fn(mocks.db));
    mocks.db.modelProvider.findUnique.mockResolvedValue({ providerId: "anthropic", endpointType: "llm", supportedAuthMethods: ["api_key", "oauth2_authorization_code"] });
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue(null);
    mocks.db.credentialEntry.create.mockResolvedValue({ id: "new-credential" });
    mocks.db.aiProviderConnection.create.mockImplementation(async ({ data }) => data);
  });

  it("creates separate credentials and conservative posture for each added account", async () => {
    const a = await addProviderAccount({ providerId: "anthropic", label: "Personal", authMethod: "api_key" });
    const b = await addProviderAccount({ providerId: "anthropic", label: "Work", authMethod: "api_key" });
    expect(a.ok && b.ok && a.data.connectionId !== b.data.connectionId).toBe(true);
    expect(mocks.db.credentialEntry.create).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.db.aiProviderConnection.create.mock.calls) {
      expect(args.data).toMatchObject({ status: "unconfigured", evidenceStatus: "unreviewed", accountClass: "unknown", credentialEntryId: "new-credential" });
      expect(args.data).not.toHaveProperty("supplierContractId");
    }
  });

  it("denies access before creating credentials", async () => {
    mocks.guard.mockRejectedValue(new Error("Unauthorized"));
    await expect(addProviderAccount({ providerId: "anthropic", label: "Work", authMethod: "api_key" })).rejects.toThrow("Unauthorized");
    expect(mocks.db.credentialEntry.create).not.toHaveBeenCalled();
  });

  it("rejects unsupported authentication and blank labels", async () => {
    expect((await addProviderAccount({ providerId: "anthropic", label: " ", authMethod: "api_key" })).ok).toBe(false);
    expect((await addProviderAccount({ providerId: "anthropic", label: "Work", authMethod: "bogus" })).ok).toBe(false);
    expect(mocks.db.credentialEntry.create).not.toHaveBeenCalled();
  });

  it("configures only the selected account and encrypts its secret", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ id: "connection-b", connectionId: "account-b", providerId: "anthropic", credentialEntryId: "credential-b", authMethod: "api-key" });
    expect((await configureProviderAccount({ connectionId: "account-b", secretRef: "secret-b" })).ok).toBe(true);
    expect(mocks.db.credentialEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "credential-b" }, data: expect.objectContaining({ secretRef: "encrypted:secret-b", status: "pending" }) }));
    expect(mocks.db.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accessibleModelIds: [], modelsVerifiedAt: null, evidenceStatus: "unreviewed", accountClass: "unknown" }) }));
    expect(mocks.db.complianceEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerConnectionId: "connection-b", status: "active" }), data: { status: "superseded" } }));
  });

  it("disables an account without clearing credentials or changing another account", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "account-b", credentialEntryId: "credential-b" });
    expect((await setProviderAccountEnabled("account-b", false)).ok).toBe(true);
    expect(mocks.db.aiProviderConnection.update).toHaveBeenCalledWith({ where: { connectionId: "account-b" }, data: { status: "disabled" } });
    expect(mocks.db.credentialEntry.update).not.toHaveBeenCalled();
  });

  it("replaces credentials without enabling a disabled account", async () => {
    mocks.db.aiProviderConnection.findUnique.mockResolvedValue({ id: "connection-b", connectionId: "account-b", credentialEntryId: "credential-b", status: "disabled" });
    await configureProviderAccount({ connectionId: "account-b", secretRef: "replacement" });
    expect(mocks.db.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }));
    expect(mocks.db.aiProviderConnection.updateMany).toHaveBeenCalledWith({ where: { connectionId: "account-b", status: { not: "disabled" } }, data: { status: "unconfigured" } });
  });
});
