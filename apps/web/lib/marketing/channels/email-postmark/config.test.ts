import { describe, expect, it, vi } from "vitest";

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
});
