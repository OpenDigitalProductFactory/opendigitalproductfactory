import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  credentialEntry: { findUnique: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { findProviderCredential } from "./provider-account-credentials";

describe("provider account credential boundary", () => {
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
    db.credentialEntry.findUnique.mockResolvedValue({ id: "zai-default" });
    await findProviderCredential("zai-coding");
    expect(db.credentialEntry.findUnique).toHaveBeenCalledWith({ where: { providerId: "zai" } });
  });

  it("rejects an explicitly empty account identity instead of using the default", async () => {
    await expect(findProviderCredential("anthropic", "")).rejects.toThrow(/connection/i);
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });
});
