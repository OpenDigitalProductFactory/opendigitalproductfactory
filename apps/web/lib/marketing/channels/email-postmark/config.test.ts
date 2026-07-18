import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(), transaction: vi.fn(), upsert: vi.fn(), update: vi.fn(), remove: vi.fn(), audit: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  integrationCredential: { findUnique: db.findUnique, upsert: db.upsert, update: db.update, delete: db.remove },
  integrationToolCallLog: { create: db.audit },
  $transaction: db.transaction,
} }));

import { saveEmailPostmarkCredential } from "./config";

describe("Postmark config kernel boundary", () => {
  beforeEach(() => {
    for (const mock of Object.values(db)) mock.mockReset();
    db.findUnique.mockResolvedValue(null);
    db.upsert.mockResolvedValue({});
    db.audit.mockResolvedValue({});
    db.transaction.mockImplementation((operation) => operation({
      integrationCredential: { findUnique: db.findUnique, upsert: db.upsert, update: db.update, delete: db.remove },
      integrationToolCallLog: { create: db.audit },
    }));
  });
  it("preserves the exact legacy missing-required-fields error", async () => {
    await expect(saveEmailPostmarkCredential({ serverToken: "", signingSecret: "", fromAddress: "" }))
      .resolves.toEqual({ ok: false, error: "Missing server token, signing secret, or From address." });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("does not replace a connected credential when replacement input is invalid", async () => {
    const result = await saveEmailPostmarkCredential({
      serverToken: "replacement-token",
      signingSecret: "replacement-secret",
      fromAddress: "not-an-email",
    });
    expect(result).toEqual({ ok: false, error: "From address must be a valid email." });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("never exposes a provider or persistence exception containing connector secrets", async () => {
    db.upsert.mockRejectedValueOnce(new Error("provider leaked replacement-token"));
    const result = await saveEmailPostmarkCredential({
      serverToken: "replacement-token",
      signingSecret: "replacement-secret",
      fromAddress: "sender@example.com",
    });
    expect(result).toEqual({ ok: false, error: "Connector operation failed." });
    expect(JSON.stringify(db.audit.mock.calls)).not.toContain("replacement-token");
    expect(JSON.stringify(db.audit.mock.calls)).not.toContain("replacement-secret");
  });
});
