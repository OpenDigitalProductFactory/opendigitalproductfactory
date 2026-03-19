import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkSocialIdentity, completeProfileWithSocial } from "./social-auth-actions.js";

vi.mock("@dpf/db", () => ({
  prisma: {
    socialIdentity: { create: vi.fn() },
    customerContact: { findUnique: vi.fn(), update: vi.fn() },
    customerAccount: { create: vi.fn() },
    accountInvite: { update: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      customerAccount: { create: vi.fn().mockResolvedValue({ id: "a-new", accountId: "CUST-NEW", name: "NewCo" }) },
      customerContact: { create: vi.fn().mockResolvedValue({ id: "c-new" }) },
      socialIdentity: { create: vi.fn().mockResolvedValue({ id: "si-new" }) },
      accountInvite: { update: vi.fn() },
    })),
  },
}));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/social-auth", () => ({
  verifyTempToken: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { verifyPassword } from "@/lib/password";
import { verifyTempToken } from "@/lib/social-auth";

describe("linkSocialIdentity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links identity when password is correct", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-1", email: "user@test.com", name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1", email: "user@test.com", name: null, passwordHash: "$2a$12$hash",
      isActive: true, account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true, needsRehash: false });
    (prisma.socialIdentity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "si-1" });

    const result = await linkSocialIdentity("valid-token", "correctpassword");
    expect(result.success).toBe(true);
    expect(prisma.socialIdentity.create).toHaveBeenCalled();
  });

  it("rejects when password is wrong", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-1", email: "user@test.com", name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1", email: "user@test.com", name: null, passwordHash: "$2a$12$hash",
      isActive: true, account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: false, needsRehash: false });

    const result = await linkSocialIdentity("valid-token", "wrongpassword");
    expect(result.success).toBe(false);
    expect(result.error).toContain("password");
  });
});

describe("completeProfileWithSocial", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates account + contact + identity for new company", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-new", email: "new@test.com", name: "New User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await completeProfileWithSocial("valid-token", { mode: "create", companyName: "New Corp" });
    expect(result.success).toBe(true);
  });
});
