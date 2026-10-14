import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  credentialEntry: { findUnique: vi.fn(), updateMany: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: (value: string) => value === "enc:bad" ? null : value }));
import { findProviderCredential, getDecryptedCredential } from "./provider-account-credentials";
import { accountExecutionVersion, ProviderAccountSelectionChangedError } from "../routing/provider-account-candidates";

describe("provider account credential boundary", () => {
  it("marks a failed decrypt only against the captured credential ciphertext revision", async () => {
    const captured = { id: "selected", updatedAt: new Date("2026-10-14T00:00:00Z"), status: "ok", secretRef: "enc:bad", clientSecret: null, cachedToken: null, refreshToken: null };
    db.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "anthropic", credentialEntry: captured });
    db.credentialEntry.updateMany.mockResolvedValue({ count: 0 });
    await expect(getDecryptedCredential("anthropic", "account-a")).resolves.toBeNull();
    expect(db.credentialEntry.updateMany).toHaveBeenCalledWith({ where: { id: captured.id, updatedAt: captured.updatedAt, secretRef: captured.secretRef, clientSecret: null, cachedToken: null, refreshToken: null }, data: { status: "key_rotated" } });
  });
  it("refuses credential replacement between routing and the single credential read", async () => {
    const selected = { connectionId: "account-a", providerId: "anthropic", status: "active", authMethod: "api-key", executionChannel: "direct-api", credentialEntryId: "selected", credentialEntry: { status: "ok", updatedAt: new Date("2026-10-14T00:00:00Z") }, accessibleModelIds: ["model"], modelsVerifiedAt: new Date("2026-10-14T00:00:00Z"), evidenceStatus: "unreviewed" };
    db.aiProviderConnection.findUnique.mockResolvedValue({ ...selected, credentialEntryId: "replacement" });
    await expect(findProviderCredential("anthropic", "account-a", accountExecutionVersion(selected))).rejects.toBeInstanceOf(ProviderAccountSelectionChangedError);
    db.aiProviderConnection.findUnique.mockResolvedValue(selected);
    await expect(findProviderCredential("anthropic", "account-a", accountExecutionVersion(selected))).resolves.toEqual(selected.credentialEntry);
  });
  beforeEach(() => vi.resetAllMocks());

  it("keeps a provider-only caller on its legacy default credential", async () => {
    db.credentialEntry.findUnique.mockResolvedValue({ id: "default", providerId: "anthropic" });
    expect(await findProviderCredential("anthropic")).toMatchObject({ id: "default" });
    expect(db.credentialEntry.findUnique).toHaveBeenCalledWith({ where: { providerId: "anthropic" } });
    expect(db.aiProviderConnection.findUnique).not.toHaveBeenCalled();
  });

  it("resolves two same-provider connections independently", async () => {
    db.aiProviderConnection.findUnique.mockImplementation(async ({ where }) => ({
      providerId: "anthropic", credentialEntry: { id: where.connectionId, providerId: null },
    }));
    expect(await findProviderCredential("anthropic", "account-a")).toMatchObject({ id: "account-a" });
    expect(await findProviderCredential("anthropic", "account-b")).toMatchObject({ id: "account-b" });
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a connection belonging to a different provider", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "openai", credentialEntry: { id: "wrong" } });
    await expect(findProviderCredential("anthropic", "wrong")).rejects.toThrow(/provider/i);
  });

  it("never falls back to the default when an explicit account is missing", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue(null);
    await expect(findProviderCredential("anthropic", "missing")).rejects.toThrow(/connection/i);
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });

  it("retains the documented zai default alias", async () => {
    db.credentialEntry.findUnique.mockImplementation(async ({ where }) => where.providerId === "zai" ? { id: "zai-default" } : null);
    await findProviderCredential("zai-coding");
    expect(db.credentialEntry.findUnique).toHaveBeenCalledWith({ where: { providerId: "zai" } });
  });
  it("prefers a configured coding-key override for a legacy default caller", async () => {
    db.credentialEntry.findUnique.mockImplementation(async ({ where }) => ({ id: where.providerId, secretRef: "encrypted-fixture" }));
    expect(await findProviderCredential("zai-coding")).toMatchObject({ id: "zai-coding" });
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalledWith({ where: { providerId: "zai" } });
  });

  it("rejects an explicitly empty account identity instead of using the default", async () => {
    await expect(findProviderCredential("anthropic", "")).rejects.toThrow(/connection/i);
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });
});
