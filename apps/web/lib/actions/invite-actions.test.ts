import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateInviteCode, validateInviteCode } from "./invite-actions.js";

vi.mock("@dpf/db", () => ({
  prisma: {
    accountInvite: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    customerAccount: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";

describe("generateInviteCode", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("creates an invite with the account prefix format", async () => {
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a-1", name: "Acme Corp" });
    (prisma.accountInvite.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "inv-1", code: "ACME-AB12" });
    const result = await generateInviteCode("a-1", "c-1");
    expect(result.success).toBe(true);
    expect(prisma.accountInvite.create).toHaveBeenCalled();
  });
});

describe("validateInviteCode", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns account info for valid unused code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1", code: "ACME-AB12", accountId: "a-1", usedAt: null, expiresAt: null,
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });
    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(true);
    expect(result.account?.name).toBe("Acme Corp");
  });
  it("rejects already-used code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1", code: "ACME-AB12", usedAt: new Date(), expiresAt: null,
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });
    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already been used");
  });
  it("rejects expired code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1", code: "ACME-AB12", usedAt: null, expiresAt: new Date("2020-01-01"),
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });
    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });
  it("rejects unknown code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await validateInviteCode("NOPE-0000");
    expect(result.valid).toBe(false);
  });
});
